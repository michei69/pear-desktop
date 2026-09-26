/**
 * How close the synced audio has to sit on the video's clock before it is left
 * alone, in seconds. Two copies of a track offset by that much cancel the half
 * period of the offset, so it is held as tightly as the two clocks can be read.
 */
export const ALIGNED_WITHIN = 0.0005;

/** Seconds a drift is closed over, once the audio runs at its own rate. */
export const ALIGN_WINDOW = 0.1;

/** How far the alignment may take the playback rate. */
export const ALIGN_RATE_LIMIT = 0.5;

/**
 * Drift past this is not a start that ran long but the audio sitting at another
 * position entirely, from a seek that got past the transport listeners; the
 * audio is moved rather than run back.
 */
export const REANCHOR_ABOVE = 0.1;

/**
 * Longest the audio may be started ahead of the video, in seconds. A start
 * costs a few milliseconds, so a measurement past this was taken across a seek
 * and is not carried into the next start.
 */
export const MAX_START_LEAD = 0.5;

/** Milliseconds between alignment checks. */
export const ALIGN_INTERVAL = 50;

/**
 * Milliseconds the outgoing track takes to move from the video's audio to its
 * own, over which the two copies of the track are both heard. Splice length,
 * not crossfade length: it is kept short enough that neither copy steps the
 * waveform and over before the offset between them is heard.
 */
export const HANDOVER_MS = 20;

/**
 * Video events that can change whether the synced audio should be running.
 * `timeupdate` carries the automatic transition as well, but that listener is
 * armed and released on its own: a pause must not take the crossfade off.
 */
export const FOLLOW_EVENTS = [
  'seeking',
  'seeked',
  'playing',
  'waiting',
  'pause',
  'timeupdate',
] as const;
