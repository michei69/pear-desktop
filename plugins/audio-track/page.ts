import type { PageContextOf, YTPlayerAudioTrack } from "@pear/sdk";
import { audioTrackConfig } from "./config.ts";
import { desiredTrack, pickerIndex, readCurrentTrackId, readTracks, trackId, trackName } from "./tracks.ts";

type Ctx = PageContextOf<typeof audioTrackConfig>;

/** The player accepts `setAudioTrack` yet can keep the old track and re-emit; cap the retries. */
const MAX_REAPPLY_ATTEMPTS = 3;
const REAPPLY_MS = 200;
const AUDIO_CHANGE_MS = 100;

/** What the host's picker shows: the track names, and which button is the state now. */
interface TrackChoices {
  labels: string[];
  /** 0 is Automatic, n is the n-th track: a button index, not an array index. */
  current: number;
}

export function startAudioTrack(ctx: Ctx) {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The list the open picker was built from: the answer applies what it showed. */
  let shown: YTPlayerAudioTrack[] | undefined;

  const apply = () => {
    const api = ctx.player.api;
    if (!api) return;
    const tracks = readTracks(api);
    // One track is no choice at all.
    if (tracks.length < 2) return;

    const desired = desiredTrack(tracks, ctx.config.audioTrack, ctx.config.preferOriginal);
    if (!desired) return;

    const id = trackId(desired);
    if (!id || id === readCurrentTrackId(api)) {
      attempts = 0;
      return;
    }
    if (attempts >= MAX_REAPPLY_ATTEMPTS) return;
    attempts += 1;
    try {
      api.setAudioTrack?.(desired);
    } catch {
      // YTM throws when a track cannot be served for the current player type.
    }
  };

  const schedule = (delay = REAPPLY_MS) => {
    ctx.clearTimeout(timer);
    timer = ctx.setTimeout(apply, delay);
  };

  // The picker is answered by this side, so its handlers go in before anything
  // waits for the player: a click on Home must not fall through to nobody.
  ctx.host.handle("tracks", (): TrackChoices => {
    const api = ctx.player.api;
    const tracks = api ? readTracks(api) : [];
    // Kept, so an answer that lands after the track changed still applies a
    // track the user was actually shown.
    shown = tracks;
    return {
      labels: tracks.map(trackName),
      current: pickerIndex(tracks, api ? readCurrentTrackId(api) : ""),
    };
  });

  ctx.host.on("apply", (payload) => {
    const index = payload === null || payload === undefined ? null : Number(payload);
    if (index === null || Number.isNaN(index)) return;

    const api = ctx.player.api;
    const tracks = shown ?? (api ? readTracks(api) : []);
    shown = undefined;
    attempts = 0;

    if (index <= 0) {
      ctx.setConfig({ audioTrack: "" });
      apply();
      return;
    }

    const track = tracks[index - 1];
    const id = track ? trackId(track) : "";
    if (!track || !id) return;
    ctx.setConfig({ audioTrack: id });
    try {
      api?.setAudioTrack?.(track);
    } catch {
      // Same as above: YTM refuses tracks it cannot serve for this player.
    }
  });

  ctx.host.on("no-tracks", () =>
    ctx.toast(ctx.t("plugins.audio-track.toast.no-tracks", "This video has only one audio track.")),
  );

  ctx.player.on("trackChange", () => {
    attempts = 0;
    schedule();
  });

  // Settings changes apply to the track that is playing, as pear-desktop did.
  ctx.onConfigChange(() => {
    attempts = 0;
    apply();
  });

  // The player's own audio-change event is the second chance the cap exists for.
  void ctx.player
    .ready()
    .then((api) => {
      if (ctx.signal.aborted) return;
      const onChange = () => schedule(AUDIO_CHANGE_MS);
      api.addEventListener("onPlaybackAudioChange", onChange);
      ctx.onCleanup(() => api.removeEventListener("onPlaybackAudioChange", onChange));
      schedule(0);
    })
    .catch(() => {});

  return () => ctx.clearTimeout(timer);
}
