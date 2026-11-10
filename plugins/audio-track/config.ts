import { config } from "@pear/sdk";

/** Audio track picks, shared by both parts. */
export const audioTrackConfig = {
  /** What to play when nothing is picked: the original track, not an auto-dub. */
  preferOriginal: config.bool(true, {
    label: "Prefer the original audio",
    description: "When no track is picked, take the one that is not an auto-dub.",
  }),
  /** The chosen track's id, written by the picker (pear-desktop's audioTrack). */
  audioTrack: config.string("", { label: "Audio track", hidden: true }),
};
