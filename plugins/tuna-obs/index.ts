// Feeds OBS's Tuna plugin (its "web server" source) with the current song.

import { config, definePlugin } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { net } from "electron";
import { songData } from "./data.ts";
import { liteSender } from "./lite.ts";

export default definePlugin({
  id: "tuna-obs",
  name: "Tuna OBS",
  description: "Show the current song in OBS through the Tuna plugin.",
  config: {
    port: config.number(1608, {
      label: "Tuna port",
      min: 1,
      max: 65535,
      step: 1,
      description: "The port of Tuna's web server source in OBS.",
    }),
  },
  host: {
    start(ctx) {
      let details: SongDetails | undefined;
      const sender = liteSender({
        port: () => ctx.config.port,
        body: () => {
          const state = ctx.player.state;
          const track = state.track;
          if (!track) return;
          return JSON.stringify({ data: songData(state, track, details) });
        },
        fetch: (url, request) => net.fetch(url, request),
        setTimeout: (fn, ms) => ctx.setTimeout(fn, ms),
        clearTimeout: (timer) => ctx.clearTimeout(timer),
        log: ctx.log,
      });
      ctx.onCleanup(() => sender.stop());

      const fetchDetails = (videoId: string) => {
        void ctx.player.details().then((result) => {
          if (result?.videoId !== videoId) return;
          details = result;
          sender.post();
        });
      };

      ctx.player.on("change", (state, previous) => {
        if (state.track && state.track.videoId !== previous.track?.videoId) fetchDetails(state.track.videoId);
        sender.post();
      });
      sender.post();
    },
    // The port is read for every request.
    onConfigChange() {},
  },
});
