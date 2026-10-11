import { Howl } from 'howler';

// Source node each media element is bound to: an element can only ever be handed
// to one and reconnecting throws, and Howler pools its elements so a recycled one
// is reused through the node it already has.
const mediaSources = new WeakMap<
  HTMLMediaElement,
  MediaElementAudioSourceNode
>();

/** Object URL backing each Howl, so `releaseAudio` can revoke it. */
const audioURLs = new WeakMap<Howl, string>();

/** Gain node carrying each Howl's audio in the player's graph. */
const audioGains = new WeakMap<Howl, GainNode>();

// Media element behind a Howl: Howler queues the `play` and `seek` calls made
// while a sound is loading and restarts a playing element on a seek, none of
// which the sync can live with, so the element is driven directly.
export const elementOf = (audio: Howl) => audio._sounds[0]._node;

/** Gain node the audio is played through, once it is routed. */
export const gainOf = (audio: Howl) => audioGains.get(audio);

// Hands a track's audio to the player's own audio graph with a gain node of its
// own in front: its level then sits on the clock the video's audio runs on, so the
// two are handed over by shaping the graph rather than stepping element volume.
export const routeAudio = (audio: Howl, context: AudioContext) => {
  if (audioGains.has(audio)) return;

  const element = elementOf(audio);
  let source = mediaSources.get(element);

  // A recycled element is reused as it is bound, not reconnected.
  if (!source) {
    source = context.createMediaElementSource(element);
    mediaSources.set(element, source);
  }

  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);
  source.connect(gain);

  audioGains.set(audio, gain);
};

// A media element cannot play YouTube's own stream URLs, so the backend hands the
// audio over as bytes and a Blob turns them back into something the element
// decodes. The audio is silent until a crossfade needs it.
export const createAudio = (
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  context?: AudioContext,
) => {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const audio = new Howl({
    src: url,
    html5: true,
    volume: 0,
    format: /webm/i.test(mimeType) ? 'webm' : 'mp4',
    onloaderror: (_id, error) =>
      console.error('[crossfade] stream failed to load', error),
  });

  audioURLs.set(audio, url);

  if (context) routeAudio(audio, context);

  return audio;
};

/** Stops a track once nothing will play it again. */
export const releaseAudio = (audio: Howl) => {
  // Howler only stops an element it started itself, and the sync started this one.
  elementOf(audio).pause();
  audioGains.get(audio)?.disconnect();
  audioGains.delete(audio);
  audio.unload();

  const url = audioURLs.get(audio);
  if (url) {
    URL.revokeObjectURL(url);
    audioURLs.delete(audio);
  }
};
