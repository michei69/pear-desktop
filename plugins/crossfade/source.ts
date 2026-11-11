// The site's side of the crossfade: which stream to ask for, and how an answer
// becomes the second audio stream. Host-only; the InnerTube client itself stays
// in index.ts, so these choices can be tested without a session.

import type { Innertube, YT, YTMusic } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";
import type { AudioBytes } from "./schema.ts";

export type AudioType = "audio" | "video+audio";

/** One stream to try: audio-only when the account may stream it, else muxed. */
export interface DownloadAttempt {
  type: AudioType;
  format: "any" | "mp4";
}

export type TrackInfo = YTMusic.TrackInfo | YT.VideoInfo;

/**
 * pear-desktop's choice from the account's premium state: premium accounts may
 * stream audio-only (smaller); for everyone else the CDN refuses those, so the
 * muxed format goes first and no track pays for a refused request.
 */
export function downloadAttempts(premium: boolean): readonly DownloadAttempt[] {
  const muxed: DownloadAttempt[] = [
    { type: "video+audio", format: "mp4" },
    { type: "video+audio", format: "any" },
  ];
  return premium ? [{ type: "audio", format: "any" }, ...muxed] : muxed;
}

/** The container of audio bytes, from its first bytes: a WebM header, else MP4. */
export function sniffAudioMime(bytes: Uint8Array) {
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 ? "audio/webm" : "video/mp4";
}

export function mimeTypeOf(format: { mime_type?: string }, bytes: Uint8Array) {
  return format.mime_type || sniffAudioMime(bytes);
}

/**
 * A playable player response for a track, asked with its PO token. The music
 * client answers with the session's account; age-restricted songs need the TV
 * client (the music client refuses them); the iOS client is the last resort.
 */
export async function playableInfo(yt: Innertube, videoId: string, poToken?: string): Promise<TrackInfo> {
  let lastError: unknown;
  const attempt = async (lookup: () => Promise<TrackInfo>) => {
    try {
      const info = await lookup();
      if (info.playability_status?.status === "OK") return info;
      const status = info.playability_status;
      lastError = new Error(`[${status?.status ?? "unknown"}] ${status?.reason ?? ""}`.trim());
    } catch (error) {
      lastError = error;
    }
    return undefined;
  };

  const info =
    (await attempt(() => yt.music.getInfo(videoId, poToken ? { po_token: poToken } : {}))) ??
    (await attempt(() => yt.getBasicInfo(videoId, { client: "TV_EMBEDDED" }))) ??
    (await attempt(() => yt.getBasicInfo(videoId, { client: "IOS" })));
  if (!info) throw lastError instanceof Error ? lastError : new Error(`no playable response for ${videoId}`);
  return info;
}

/** The best stream of a playable response, in the order the premium state picked. */
export function chooseAudioFormat(info: TrackInfo, premium: boolean) {
  let lastError: unknown;
  for (const attempt of downloadAttempts(premium)) {
    try {
      return info.chooseFormat({ ...attempt, quality: "best" });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * A track's audio as bytes for a Blob. A media element cannot play the site's
 * own stream URLs reliably (a raw URL is refused once a renderer streams it),
 * so the crossfade hands the element MP4/WebM bytes instead.
 */
export async function downloadAudio(info: TrackInfo, premium: boolean): Promise<AudioBytes> {
  let lastError: unknown;
  for (const attempt of downloadAttempts(premium)) {
    try {
      const format = info.chooseFormat({ ...attempt, quality: "best" });
      const stream = await info.download({ ...attempt, quality: "best" });
      const bytes = await readStream(stream);
      if (bytes.byteLength === 0) throw new Error("the audio stream was empty");
      return { bytes, mimeType: mimeTypeOf(format, bytes) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function readStream(stream: unknown) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
