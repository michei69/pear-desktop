// Turns plays into Last.fm and ListenBrainz submissions.

import type { Track } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { credentials, netFetch, type Warn } from "./common.ts";
import { applyFilters } from "./filters.ts";
import { fetchMusicBrainzCorrection } from "./musicbrainz.ts";
import type { Ctx } from "./schema.ts";
import { LASTFM_REAUTH_CODES, LastFmError, lastFm, type Listen, listenBrainzSubmit } from "./services.ts";
import type { Play } from "./tracker.ts";

/** Submissions wait for the details, so give the page less time than the default. */
const DETAILS_TIMEOUT_MS = 3000;
/** MusicBrainz may be rate-limited or down; the submission goes out uncorrected rather than waiting forever. */
const MUSICBRAINZ_WAIT_MS = 6000;
const SONG_TYPES = new Set(["MUSIC_VIDEO_TYPE_ATV", "MUSIC_VIDEO_TYPE_OMV"]);

export function submitter(ctx: Ctx, warn: Warn) {
  // Details (alternative title, tags, exact video type) come from the page; the current track's are kept.
  const details = new Map<string, Promise<SongDetails | undefined>>();
  const detailsFor = (videoId: string) => {
    let pending = details.get(videoId);
    if (!pending) {
      pending = ctx.player.details({ timeout: DETAILS_TIMEOUT_MS }).then((result) => (result?.videoId === videoId ? result : undefined));
      details.clear();
      details.set(videoId, pending);
    }
    return pending;
  };

  /** The current play; a correction that finishes after a change is dropped. */
  let current: { videoId: string; startedAt: number } | undefined;
  let stopped = false;
  ctx.onCleanup(() => {
    stopped = true;
  });

  const toListen = async (track: Track, startedAt: number): Promise<Listen | null> => {
    const extra = await detailsFor(track.videoId);
    if (!ctx.config.scrobbleOtherMedia && !isSong(track, extra)) return null;
    const baseTitle = (ctx.config.alternativeTitles && extra?.alternativeTitle) || track.title;
    const baseArtist = (ctx.config.alternativeArtist && extra?.tags[0]) || track.artist;
    // pear-desktop's title/artist filters, including the user's own regexes.
    let { scrobbleTitle: title, scrobbleArtist: artist } = applyFilters(baseTitle, baseArtist, ctx.config.customRegexFilters);

    if (ctx.config.useMusicBrainz && ctx.config.musicBrainzEmail) {
      const isCancelled = () => stopped || !current || current.videoId !== track.videoId || current.startedAt !== startedAt;
      const correction = fetchMusicBrainzCorrection(title, artist, ctx.config.musicBrainzEmail, netFetch, isCancelled);
      const corrected = await within(correction, MUSICBRAINZ_WAIT_MS);
      // The scrobble itself still goes out; only the correction is skipped.
      if (corrected && !isCancelled()) {
        title = corrected.title;
        artist = corrected.artist;
      }
    }

    return {
      title,
      artist,
      ...(track.album ? { album: track.album } : {}),
      durationSeconds: track.durationSeconds,
      url: track.url,
      startedAt,
    };
  };

  const toLastFm = (kind: "nowPlaying" | "scrobble", listen: Listen, sessionKey: string) => {
    const call = kind === "nowPlaying" ? lastFm.updateNowPlaying : lastFm.scrobble;
    call(netFetch, credentials(ctx), sessionKey, listen).catch((error: unknown) => {
      if (error instanceof LastFmError && LASTFM_REAUTH_CODES.has(error.code)) {
        ctx.log.warn("Last.fm session is no longer valid; authorize again");
        ctx.setConfig({ lastfmSessionKey: "" });
      } else warn("Last.fm", error);
    });
  };

  const submit = async (kind: "nowPlaying" | "scrobble", play: Play) => {
    current = { videoId: play.track.videoId, startedAt: play.startedAt };
    const listen = await toListen(play.track, play.startedAt);
    if (!listen) return;
    // A differently-timed play started while we waited: don't report this one late.
    if (stopped || current.videoId !== play.track.videoId || current.startedAt !== play.startedAt) return;
    const { lastfmEnabled, lastfmSessionKey, listenbrainzEnabled, listenbrainzToken, listenbrainzApiRoot } = ctx.config;
    if (lastfmEnabled && lastfmSessionKey) toLastFm(kind, listen, lastfmSessionKey);
    if (listenbrainzEnabled && listenbrainzToken) {
      const type = kind === "nowPlaying" ? "playing_now" : "single";
      listenBrainzSubmit(netFetch, listenbrainzApiRoot, listenbrainzToken, type, listen).catch((error: unknown) =>
        warn("ListenBrainz", error),
      );
    }
  };

  return { submit, prefetchDetails: (videoId: string) => void detailsFor(videoId) };
}

/** Songs and official music videos; without YTM's exact type, audio-only tracks. */
function isSong(track: Track, details: SongDetails | undefined) {
  const type = details?.musicVideoType;
  return type ? SONG_TYPES.has(type) : track.mediaType === "audio";
}

/** Resolves with the value, or null once `ms` has passed; the pending work keeps running harmlessly. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const { promise: result, resolve } = Promise.withResolvers<T | null>();
  const timer = setTimeout(() => resolve(null), ms);
  promise.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    () => {
      clearTimeout(timer);
      resolve(null);
    },
  );
  return result;
}
