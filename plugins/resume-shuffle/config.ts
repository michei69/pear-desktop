import { config } from "@pear/sdk";

/** The only setting is the state carried to the next launch, so it is not shown. */
export const resumeShuffleConfig = {
  /** Whether the queue was shuffled when the app was last closed. */
  shuffled: config.bool(false, { label: "Queue was shuffled", hidden: true }),
};
