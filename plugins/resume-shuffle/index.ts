import { definePlugin } from "@pear/sdk";
import { resumeShuffleConfig } from "./config.ts";
import { startResumeShuffle } from "./page.ts";

// pear-desktop's resume-shuffle: remember whether the queue was shuffled, and
// shuffle the resumed queue again on the next launch (with resumeOnStart).

export default definePlugin({
  id: "resume-shuffle",
  name: "Resume shuffle",
  description: "Shuffles the queue again when the last song is resumed at startup.",
  config: resumeShuffleConfig,
  page: {
    async start(ctx) {
      return startResumeShuffle(ctx);
    },
    onConfigChange() {},
  },
});
