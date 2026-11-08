import type { SkipSilencesPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';

let config: SkipSilencesPluginConfig;

let isSilent = false;
let hasAudioStarted = false;

let loopTimer: number | undefined;
let analyser: AnalyserNode | null = null;
let analyserSource: MediaElementAudioSourceNode | null = null;
let video: HTMLVideoElement | null = null;

const smoothing = 0.1;
const threshold = -100; // DB (-100 = absolute silence, 0 = loudest)
const interval = 25; // Ms
const history = 10;
const speakingHistory = Array.from({ length: history }).fill(0) as number[];

let playOrSeekHandler: (() => void) | undefined;
let pauseOrEndedHandler: (() => void) | undefined;

const getMaxVolume = (
  node: AnalyserNode,
  fftBins: Float32Array<ArrayBuffer>,
) => {
  let maxVolume = Number.NEGATIVE_INFINITY;
  node.getFloatFrequencyData(fftBins);

  for (let i = 4, ii = fftBins.length; i < ii; i++) {
    if (fftBins[i] > maxVolume && fftBins[i] < 0) {
      maxVolume = fftBins[i];
    }
  }

  return maxVolume;
};

const stopLoop = () => {
  if (loopTimer !== undefined) {
    clearTimeout(loopTimer);
    loopTimer = undefined;
  }
};

const stopAnalyser = () => {
  try {
    if (analyserSource && analyser) {
      analyserSource.disconnect(analyser);
    }
  } catch {}

  analyser?.disconnect();
  analyser = null;
  analyserSource = null;
};

const detachVideoListeners = () => {
  if (!video) return;

  if (playOrSeekHandler) {
    video.removeEventListener('play', playOrSeekHandler);
    video.removeEventListener('seeked', playOrSeekHandler);
    playOrSeekHandler = undefined;
  }

  if (pauseOrEndedHandler) {
    video.removeEventListener('pause', pauseOrEndedHandler);
    video.removeEventListener('ended', pauseOrEndedHandler);
    pauseOrEndedHandler = undefined;
  }
};

const resetState = () => {
  isSilent = false;
  hasAudioStarted = false;
  speakingHistory.fill(0);
};

const audioCanPlayListener = (e: CustomEvent<Compressor>) => {
  const mediaElement = document.querySelector<HTMLVideoElement>('video');
  const { audioContext } = e.detail;
  const sourceNode = e.detail.audioSource;

  // One audio-can-play fires per track: replace the previous loop, analyser and
  // element listeners instead of stacking another set.
  stopLoop();
  detachVideoListeners();
  stopAnalyser();
  resetState();

  const trackAnalyser = audioContext.createAnalyser();
  trackAnalyser.fftSize = 512;
  trackAnalyser.smoothingTimeConstant = smoothing;
  const fftBins = new Float32Array(trackAnalyser.frequencyBinCount);

  sourceNode.connect(trackAnalyser);

  analyser = trackAnalyser;
  analyserSource = sourceNode;
  video = mediaElement;

  const skipSilence = () => {
    if (config.onlySkipBeginning && hasAudioStarted) {
      return;
    }

    if (isSilent && video && !video.paused) {
      video.currentTime += 0.2; // In s
    }
  };

  const looper = () => {
    loopTimer = window.setTimeout(() => {
      loopTimer = undefined;

      // Paused or ended playback has nothing to analyse; `play` restarts it.
      if (video && (video.paused || video.ended)) return;

      const currentVolume = getMaxVolume(trackAnalyser, fftBins);

      let speakingCount = 0;
      if (currentVolume > threshold && isSilent) {
        // Trigger quickly: only the last 3 samples decide.
        for (
          let i = speakingHistory.length - 3;
          i < speakingHistory.length;
          i++
        ) {
          speakingCount += speakingHistory[i];
        }

        if (speakingCount >= 2) {
          isSilent = false;
          hasAudioStarted = true;
        }
      } else if (currentVolume < threshold && !isSilent) {
        for (const element of speakingHistory) {
          speakingCount += element;
        }

        if (
          speakingCount == 0 && // Silent
          !(
            video &&
            (video.paused ||
              video.seeking ||
              video.ended ||
              video.muted ||
              video.volume === 0)
          )
        ) {
          isSilent = true;
          skipSilence();
        }
      }

      speakingHistory.shift();
      speakingHistory.push(Number(currentVolume > threshold));

      looper();
    }, interval);
  };

  // `seeked` fires again for every jump skipSilence() makes, so only arm one
  // timer per silence run instead of one per event.
  const startLoop = () => {
    if (loopTimer === undefined) looper();
  };

  playOrSeekHandler = () => {
    // A seek does not restart the track: `hasAudioStarted` ("real audio heard
    // since the track began") must survive it, or any seek — including the one
    // skipSilence() makes itself — re-arms beginning-only skipping mid-track.
    // The samples from before the jump would otherwise be counted after it.
    speakingHistory.fill(0);
    skipSilence();
    startLoop();
  };

  pauseOrEndedHandler = () => {
    stopLoop();
  };

  video?.addEventListener('play', playOrSeekHandler);
  video?.addEventListener('seeked', playOrSeekHandler);
  video?.addEventListener('pause', pauseOrEndedHandler);
  video?.addEventListener('ended', pauseOrEndedHandler);

  // Do not start analysing while the media is already paused.
  if (!video || !video.paused) startLoop();
};

export const onRendererLoad = async ({
  getConfig,
}: RendererContext<SkipSilencesPluginConfig>) => {
  config = await getConfig();
  resetState();

  document.addEventListener('peard:audio-can-play', audioCanPlayListener, {
    passive: true,
  });
};

export const onRendererConfigChange = (newConfig: SkipSilencesPluginConfig) => {
  config = newConfig;
};

export const onRendererUnload = () => {
  stopLoop();
  detachVideoListeners();
  stopAnalyser();
  video = null;
  resetState();

  document.removeEventListener('peard:audio-can-play', audioCanPlayListener);
};
