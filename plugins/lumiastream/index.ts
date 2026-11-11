// Sends song changes and play/pause (each with the current progress) to Lumia Stream's local media API.

import { definePlugin, livePosition, type NowPlaying, type Track } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { isPlaying } from "@pear/sdk/util";
import { net } from "electron";

const PORT = 39231;
/** Lumia Stream's public token for this integration. */
const TOKEN = "lsmedia_ytmsI7812";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Origin": "*",
};

const isPaused = (state: NowPlaying) => state.ad || !isPlaying(state);

type EventType = "switchSong" | "playPause";

/**
 * Views once the page mirrors them on the track (the shared Track type gains the
 * field with the page change). Older page runtimes answer `details` only.
 */
const viewsOf = (track: Track, details: SongDetails | undefined) =>
  (track as Track & { views?: number }).views ?? (details?.videoId === track.videoId ? details.views : undefined);

/** Lumia's media event, in pear-desktop's shape. */
function mediaEvent(eventType: EventType, state: NowPlaying, track: Track, details: SongDetails | undefined) {
  const paused = isPaused(state);
  const views = viewsOf(track, details);
  return {
    origin: "\u0079\u006f\u0075\u0074\u0075\u0062\u0065music",
    eventType,
    url: track.url,
    videoId: track.videoId,
    ...(track.playlistId ? { playlistId: track.playlistId } : {}),
    cover: track.artworkUrl ?? null,
    cover_url: track.artworkUrl ?? null,
    album_url: track.artworkUrl ?? null,
    title: track.title,
    artists: [track.artist],
    status: paused ? "stopped" : "playing",
    isPaused: paused,
    progress: Math.round(livePosition(state) * 1000),
    duration: Math.round(track.durationSeconds * 1000),
    album: track.album ?? null,
    ...(views !== undefined ? { views } : {}),
  };
}

export default definePlugin({
  id: "lumiastream",
  name: "Lumia Stream",
  description: "Let Lumia Stream react to the songs you play.",
  host: {
    start(ctx) {
      let details: SongDetails | undefined;
      let unreachable = false;
      let stopped = false;
      ctx.onCleanup(() => {
        stopped = true;
      });

      const post = (eventType: EventType) => {
        const state = ctx.player.state;
        const track = state.track;
        if (stopped || !track || (!track.title && !track.artist)) return;
        const data = mediaEvent(eventType, state, track, details);
        net
          .fetch(`http://127.0.0.1:${PORT}/api/media`, {
            method: "POST",
            headers: HEADERS,
            keepalive: true,
            body: JSON.stringify({ token: TOKEN, data }),
          })
          .then(() => {
            if (unreachable) ctx.log.info("Lumia Stream is reachable again");
            unreachable = false;
          })
          .catch((error: unknown) => {
            if (!unreachable) ctx.log.info(`Lumia Stream isn't reachable on port ${PORT}`, error);
            unreachable = true;
          });
      };

      // Only an older page runtime needs this; a mirrored track already carries the views.
      const fetchDetails = (videoId: string) => {
        void ctx.player.details().then((result) => {
          if (result?.videoId !== videoId || ctx.player.state.track?.videoId !== videoId) return;
          details = result;
        });
      };

      ctx.player.on("change", (state, previous) => {
        if (!state.track) return;
        // Master's events: a switch only on a real track change, a toggle only on pause/resume.
        if (state.track.videoId !== previous.track?.videoId) {
          details = undefined;
          post("switchSong");
          if (viewsOf(state.track, undefined) === undefined) fetchDetails(state.track.videoId);
        } else if (isPaused(state) !== isPaused(previous)) {
          post("playPause");
        }
      });
      if (ctx.player.state.track) post("switchSong");
    },
  },
});
