// Serves the current song in the format of the Amuse now-playing widget (6K Labs).

import { createServer } from "node:http";
import { config, definePlugin, livePosition, type MediaType, type NowPlaying } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

/** Amuse's names for the media types the SDK reports. */
const MEDIA_TYPES: Record<MediaType, string> = { audio: "AUDIO", video: "VIDEO", podcast: "PODCAST", other: "OTHER" };
const LIKE_STATUS = { like: "LIKE", dislike: "DISLIKE", none: "INDIFFERENT" } as const;
const REPEAT_TYPE = { none: "NONE", all: "ALL", one: "ONE" } as const;

function toHumanTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, "0")}`;
}

// 6K Labs clients read every field of the query and treat a missing key as a
// malformed provider, so each one is always present with a neutral default.
// The host mirrors the page's player state, so the ad flag and the position
// come from it directly rather than from a watched DOM class and IPC.
function songInfo(state: NowPlaying) {
  const track = state.track;
  const position = Math.floor(livePosition(state));
  const duration = Math.floor(track?.durationSeconds ?? 0);
  return {
    apiVersion: 2,
    player: {
      hasSong: !!(track?.title && track.artist),
      isPaused: state.ad || !isPlaying(state),
      volumePercent: state.volume,
      seekbarCurrentPosition: position,
      seekbarCurrentPositionHuman: toHumanTime(position),
      statePercent: duration > 0 ? Math.round((position / duration) * 100) : 0,
      likeStatus: LIKE_STATUS[state.like],
      repeatType: REPEAT_TYPE[state.repeat],
      // Lets a client extrapolate between polls instead of freezing the seekbar.
      positionUpdatedAt: state.updatedAt,
    },
    track: {
      author: track?.artist ?? "",
      title: track?.title ?? "",
      album: track?.album ?? "",
      cover: track?.artworkUrl ?? "",
      duration,
      durationHuman: toHumanTime(duration),
      url: track?.url ?? "",
      id: track?.videoId ?? "",
      isVideo: !!track && track.mediaType !== "audio",
      // Carried even when the ad's metadata never arrives: hardcoding false here
      // collapsed the two modes into one on the wire.
      isAdvertisement: state.ad,
      inLibrary: false,
      mediaType: track ? MEDIA_TYPES[track.mediaType] : "AUDIO",
      playlistId: track?.playlistId || null,
    },
  };
}

export default definePlugin({
  id: "amuse",
  name: "Amuse",
  description: "Show the current song in the Amuse now-playing widget by 6K Labs.",
  config: {
    port: config.number(9863, {
      label: "Port",
      min: 1,
      max: 65535,
      step: 1,
      description: "Amuse expects 9863.",
    }),
    hostname: config.string("127.0.0.1", {
      label: "Address to listen on",
      description: "127.0.0.1 keeps it to this computer. Empty or 0.0.0.0 listens on every address, which is what pear-desktop did.",
      placeholder: "127.0.0.1",
    }),
  },
  host: {
    async start(ctx) {
      const server = createServer((req, res) => {
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        if (req.method === "OPTIONS") {
          res.writeHead(204, CORS).end();
        } else if (req.method === "GET" && (path === "/query" || path === "/api")) {
          res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify(songInfo(ctx.player.state)));
        } else if (req.method === "GET" && path === "/") {
          res.writeHead(200, { ...CORS, "Content-Type": "text/plain" }).end("Amuse API server is running. GET /query to get song info.");
        } else {
          res.writeHead(404, CORS).end();
        }
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(ctx.config.port, ctx.config.hostname || "0.0.0.0", () => {
          server.off("error", reject);
          resolve();
        });
      });
      server.on("error", (error) => ctx.log.error(error));
      return () => {
        server.close();
        server.closeAllConnections();
      };
    },
  },
});
