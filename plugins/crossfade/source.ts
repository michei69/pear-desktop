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
 * Past this length a track is never buffered into a Blob. The crossfade only
 * needs a few seconds at the end, and a full download of a hours-long video is
 * what drives the app out of memory. Such tracks use their stream URL instead.
 */
export const MAX_FULL_DOWNLOAD_SECONDS = 60 * 60;
/** Hard ceiling on one audio download, for tracks whose length isn't reported. */
export const MAX_AUDIO_BYTES = 256 * 1024 * 1024;

/** A player response's length, when it carries one. */
export function lengthSecondsOf(info: TrackInfo): number | undefined {
  const raw = (info as { video_details?: { lengthSeconds?: string } }).video_details?.lengthSeconds;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * Based on the account's premium state: premium accounts may stream audio-only
 * (smaller); for everyone else the CDN refuses those, so the muxed format goes
 * first and no track pays for a refused request.
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

/** One of the site's clients, in the order the crossfade asks them. */
export interface ClientLookup {
  /** For the log that says which one answered. */
  name: string;
  info(): Promise<TrackInfo>;
}

/**
 * The site's clients for a track, in order. The music client answers with the
 * session's account; age-restricted songs need the TV client (the music client
 * refuses them); the iOS client is the fallback, and the one whose stream URLs
 * play without a premium account.
 */
export function clientLookups(yt: Innertube, videoId: string, poToken?: string): readonly ClientLookup[] {
  return [
    { name: "music", info: () => yt.music.getInfo(videoId, poToken ? { po_token: poToken } : {}) },
    { name: "TV", info: () => yt.getBasicInfo(videoId, { client: "TV_EMBEDDED" }) },
    { name: "iOS", info: () => yt.getBasicInfo(videoId, { client: "IOS" }) },
  ];
}

/** The refusal a player response carries. */
export function playabilityError(info: TrackInfo) {
  const status = info.playability_status;
  return new Error(`[${status?.status ?? "unknown"}] ${status?.reason ?? ""}`.trim());
}

/** The first playable player response, in `clientLookups` order. */
export async function playableInfo(yt: Innertube, videoId: string, poToken?: string): Promise<TrackInfo> {
  let lastError: unknown;
  for (const client of clientLookups(yt, videoId, poToken)) {
    try {
      const info = await client.info();
      if (info.playability_status?.status === "OK") return info;
      lastError = playabilityError(info);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`no playable response for ${videoId}`);
}

/**
 * The stream a URL-backed tail is asked for, smallest first. Audio-only is all a
 * crossfade needs; a response without one falls back to muxed at its smallest
 * quality, whose video track an <audio> never decodes.
 */
export function streamAttempts(): readonly DownloadAttempt[] {
  return [
    { type: "audio", format: "any" },
    { type: "video+audio", format: "mp4" },
    { type: "video+audio", format: "any" },
  ];
}

/** The response's format for one streaming attempt. */
export function streamFormat(info: TrackInfo, attempt: DownloadAttempt) {
  return info.chooseFormat({ ...attempt, quality: attempt.type === "audio" ? "best" : "worst" });
}

/**
 * A track's audio as bytes for a Blob. A media element cannot play the site's
 * own stream URLs reliably (a raw URL is refused once a renderer streams it),
 * so the crossfade hands the element MP4/WebM bytes instead.
 */
export async function downloadAudio(info: TrackInfo, premium: boolean, maxBytes = MAX_AUDIO_BYTES): Promise<AudioBytes | undefined> {
  let lastError: unknown;
  for (const attempt of downloadAttempts(premium)) {
    try {
      const format = info.chooseFormat({ ...attempt, quality: "best" });
      const stream = await info.download({ ...attempt, quality: "best" });
      const bytes = await readStream(stream, maxBytes);
      // The stream grew past the budget: leave it to the caller's URL fallback.
      if (!bytes) return undefined;
      if (bytes.byteLength === 0) throw new Error("the audio stream was empty");
      return { bytes, mimeType: mimeTypeOf(format, bytes) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function readStream(stream: unknown, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    // Returning from a `for await` closes the iterator, stopping the download.
    if (total > maxBytes) return undefined;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
