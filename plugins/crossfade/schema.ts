import { config, type PageContextOf } from "@pear/sdk";

export const schema = {
  fadeInDuration: config.number(1500, { label: "Fade-in", min: 0, max: 10000, step: 100, unit: " ms" }),
  fadeOutDuration: config.number(5000, { label: "Fade-out", min: 0, max: 20000, step: 100, unit: " ms" }),
  secondsBeforeEnd: config.number(10, {
    label: "Skip to the next track",
    description: "Seconds before the end; the handover to the next track happens there.",
    min: 0,
    max: 30,
    step: 1,
    unit: " s before the end",
  }),
  fadeScaling: config.select(
    "equalPower",
    [
      { value: "equalPower", label: "Equal power (no dip between tracks)" },
      { value: "linear", label: "Linear" },
      { value: "logarithmic", label: "Logarithmic (sounds even)" },
    ],
    { label: "Fade curve" },
  ),
  dynamicRange: config.number(60, { label: "Logarithmic range", min: 10, max: 120, step: 5, unit: " dB" }),
};

/** A track's audio as bytes, which a Blob turns into something the page can decode. */
export interface AudioBytes {
  bytes: Uint8Array;
  mimeType: string;
}

export interface CrossfadeCommands {
  /** A direct audio stream of the track. */
  audioUrl(videoId: string): Promise<string>;
  /** The track's audio itself, which plays without the site's CORS and container limits. */
  audioBytes(videoId: string): Promise<AudioBytes | undefined>;
}

export type Ctx = PageContextOf<typeof schema, CrossfadeCommands>;
