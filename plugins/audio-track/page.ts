import type { PageContextOf } from "@pear/sdk";
import { audioTrackConfig } from "./config.ts";
import { desiredTrack, readCurrentTrackId, readTracks, trackId, trackName } from "./tracks.ts";

type Ctx = PageContextOf<typeof audioTrackConfig>;

/** The player accepts `setAudioTrack` yet can keep the old track and re-emit; cap the retries. */
const MAX_REAPPLY_ATTEMPTS = 3;
const REAPPLY_MS = 200;
const AUDIO_CHANGE_MS = 100;

/** What the host's picker shows: the track names, and which one is playing. */
interface TrackChoices {
  labels: string[];
  current: number;
}

export async function startAudioTrack(ctx: Ctx) {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

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

  ctx.player.on("trackChange", () => {
    attempts = 0;
    schedule();
  });

  // The player re-emits this after a switch: that is the second chance the cap is for.
  const api = await ctx.player.ready().catch(() => null);
  if (api) {
    const onChange = () => schedule(AUDIO_CHANGE_MS);
    api.addEventListener("onPlaybackAudioChange", onChange);
    ctx.onCleanup(() => api.removeEventListener("onPlaybackAudioChange", onChange));
  }
  schedule(0);

  // The picker lives in the host (a native dialog); the page knows the tracks.
  ctx.host.handle("tracks", (): TrackChoices => {
    const player = ctx.player.api;
    const tracks = player ? readTracks(player) : [];
    const currentId = player ? readCurrentTrackId(player) : "";
    return {
      labels: tracks.map(trackName),
      current: Math.max(0, tracks.findIndex((track) => trackId(track) === currentId)),
    };
  });

  // The host answers with the chosen index (0 = automatic, null = cancelled).
  ctx.host.on("apply", (payload) => {
    const index = payload === null || payload === undefined ? null : Number(payload);
    if (index === null || Number.isNaN(index)) return;

    const player = ctx.player.api;
    const tracks = player ? readTracks(player) : [];
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
      player?.setAudioTrack?.(track);
    } catch {
      // Same as above: YTM refuses tracks it cannot serve for this player.
    }
  });

  ctx.host.on("no-tracks", () =>
    ctx.toast(ctx.t("plugins.audio-track.toast.no-tracks", "This video has only one audio track.")),
  );

  return () => ctx.clearTimeout(timer);
}
