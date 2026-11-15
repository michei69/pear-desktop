import { createServer } from "node:http";
import { config, definePlugin } from "@pear/sdk";
import { CORS, songInfo } from "./format.ts";

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
      description:
        "127.0.0.1 keeps it to this computer (the default). Empty listens on every IPv4 and IPv6 address, as pear-desktop did; 0.0.0.0 listens on every IPv4 address.",
      placeholder: "127.0.0.1",
    }),
  },
  host: {
    async start(ctx) {
      // The raw YTM type distinguishes an official music video from UGC; the
      // coarse Track.mediaType cannot. Keep it per track for the query shape.
      const videoTypes = new Map<string, string>();
      ctx.player.on("trackChange", (track) => {
        if (!track) return;
        void ctx.player
          .details()
          .then((details) => {
            if (details?.musicVideoType) videoTypes.set(track.videoId, details.musicVideoType);
          })
          .catch(() => {});
      });
      const current = (state: Parameters<typeof songInfo>[0]) =>
        songInfo(state, state.track ? videoTypes.get(state.track.videoId) : undefined);
      const server = createServer((req, res) => {
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        if (req.method === "OPTIONS") {
          res.writeHead(204, CORS).end();
        } else if (req.method === "GET" && (path === "/query" || path === "/api")) {
          res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify(current(ctx.player.state)));
        } else if (req.method === "GET" && path === "/") {
          res
            .writeHead(200, { ...CORS, "Content-Type": "text/plain" })
            .end(ctx.t("plugins.amuse.response.query", "Amuse API server is running. GET /query to get song info."));
        } else {
          res.writeHead(404, CORS).end();
        }
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(ctx.config.port, ctx.config.hostname.trim() || undefined, () => {
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
