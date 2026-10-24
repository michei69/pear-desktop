import { definePlugin } from "@pear/sdk";
import { net } from "electron";
import { Innertube, type YT } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";
import { startCrossfade } from "./page.ts";
import { schema, type AudioBytes } from "./schema.ts";

/** What the crossfade tries, in order: the small audio-only stream first, then the muxed one. */
const DOWNLOAD_ATTEMPTS = [
  { type: "audio", format: "any" },
  { type: "video+audio", format: "mp4" },
  { type: "video+audio", format: "any" },
] as const;

export default definePlugin({
  id: "crossfade",
  name: "Crossfade",
  description: "Fades out the end of a track while the next one fades in.",
  config: schema,
  host: {
    commands: {
      /**
       * A direct audio stream of a track, as pear-desktop fetched one to play the
       * end of the track while the next one starts. The page falls back to it when
       * the track's bytes don't arrive.
       */
      async audioUrl(videoId: string) {
        const yt = await innertube();
        let lastError: unknown;
        // The iOS client's streams play without extra tokens; the web client's as a fallback.
        for (const client of ["IOS", undefined] as const) {
          try {
            const info = await yt.getBasicInfo(videoId, client ? { client } : undefined);
            const format = info.chooseFormat({ type: "audio", quality: "best" });
            return await format.decipher(yt.session.player);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      },

      /**
       * A track's audio as bytes. A media element can't play the site's own stream
       * URLs reliably (the raw URL is refused once a renderer streams it), so the
       * crossfade decodes a Blob instead. Audio-only is preferred; the muxed format
       * is what the CDN still serves for tracks that refuse one.
       */
      async audioBytes(videoId: string) {
        const yt = await innertube();
        let lastError: unknown;
        for (const client of ["IOS", undefined] as const) {
          let info: YT.VideoInfo;
          try {
            info = await yt.getBasicInfo(videoId, client ? { client } : undefined);
          } catch (error) {
            lastError = error;
            continue;
          }
          for (const attempt of DOWNLOAD_ATTEMPTS) {
            try {
              return await downloadBytes(info, attempt);
            } catch (error) {
              lastError = error;
            }
          }
        }
        throw lastError;
      },
    },
  },
  page: startCrossfade,
});

async function downloadBytes(info: YT.VideoInfo, options: (typeof DOWNLOAD_ATTEMPTS)[number]): Promise<AudioBytes> {
  const format = info.chooseFormat({ ...options, quality: "best" });
  const stream = await info.download({ ...options, quality: "best" });
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  if (total === 0) throw new Error("the audio stream was empty");

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, mimeType: format.mime_type };
}

// Host: the InnerTube client, created on first use.
let client: Promise<Innertube> | undefined;

function innertube() {
  client ??= Innertube.create({
    retrieve_player: true,
    fetch: (input, init) => net.fetch(input as string, init),
  }).catch((error: unknown) => {
    client = undefined;
    throw error;
  });
  return client;
}
