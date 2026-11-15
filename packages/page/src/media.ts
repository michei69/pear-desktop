// YTM's player <video> helpers shared by the page runtime.

/**
 * Puts the player's media element in CORS mode.
 *
 * A MediaElementAudioSourceNode outputs silence for cross-origin media that
 * was fetched without CORS (podcast/RSS audio), so this runs before any
 * sampling plugin can capture the element — and a source that was already
 * fetched no-cors is reloaded. The desktop app rewrites the media responses'
 * `access-control-allow-origin` header; the CORS request itself needs this
 * attribute. Blob sources (YTM's own MSE) are same-origin and must not reload.
 */
export function ensureCORSMedia(video: HTMLVideoElement) {
  if (video.crossOrigin === "anonymous") return;
  video.crossOrigin = "anonymous";
  if (video.src && !video.src.startsWith("blob:")) video.load();
}
