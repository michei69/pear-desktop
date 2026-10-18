import { t } from '@/i18n';
import {
  clearAudioChain,
  rebindAudioGraphSource,
  setAudioChain,
} from '@/providers/audio-graph';
import { type MusicPlayer } from '@/types/music-player';
import { createPlugin } from '@/utils';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export type AudioCompressorPluginConfig = {
  enabled: boolean;
  autoTrackGain: boolean;
  maxTrackGainDb: number;
};

const MAX_TRACK_GAIN_CHOICES = [6, 9, 12, 15, 18, 24] as const;

const dbToLinear = (db: number) => Math.pow(10, db / 20);

const lazySafeTry = (...fns: (() => void)[]) => {
  for (const fn of fns) {
    try {
      fn();
    } catch {}
  }
};

const configureCompressor = (compressor: DynamicsCompressorNode) => {
  compressor.threshold.value = -50;
  compressor.ratio.value = 12;
  compressor.knee.value = 40;
  compressor.attack.value = 0;
  compressor.release.value = 0.25;
};

class Chain {
  source: MediaElementAudioSourceNode | null = null;
  context: AudioContext | null = null;
  compressor: DynamicsCompressorNode | null = null;
  trackGain: GainNode | null = null;

  build(source: MediaElementAudioSourceNode, context: AudioContext) {
    if (this.source === source && this.context === context && this.compressor) {
      return;
    }

    this.teardown();

    this.source = source;
    this.context = context;

    const compressor = context.createDynamicsCompressor();
    const trackGain = context.createGain();
    configureCompressor(compressor);
    trackGain.gain.value = 1;

    this.compressor = compressor;
    this.trackGain = trackGain;

    // The sub-chain's own edge (input → … → output); the shared owner wires
    // source → compressor and trackGain → destination around it. Dropping this
    // edge leaves the graph with no path to the audio device, which stalls the
    // media clock after a few quanta.
    compressor.connect(trackGain);
    setAudioChain('audio-compressor', compressor, trackGain);
  }

  applyTrackGain(gainDb: number) {
    if (!this.context || !this.trackGain) return;
    this.trackGain.gain.linearRampToValueAtTime(
      dbToLinear(gainDb),
      this.context.currentTime + 0.1,
    );
  }

  teardown() {
    clearAudioChain('audio-compressor');
    lazySafeTry(
      () => this.compressor?.disconnect(),
      () => this.trackGain?.disconnect(),
    );
    this.compressor = null;
    this.trackGain = null;
    // source/context are kept so a re-enable can rebuild without a new event.
  }
}

const chain = new Chain();

let currentConfig: AudioCompressorPluginConfig = {
  enabled: false,
  autoTrackGain: false,
  maxTrackGainDb: 12,
};

const getContentLoudnessDb = (): number | null => {
  try {
    const player = document.querySelector('#movie_player') as
      | (Element & { getPlayerResponse?: () => unknown })
      | null;
    const response = player?.getPlayerResponse?.() as
      | {
          playerConfig?: {
            audioConfig?: {
              loudnessDb?: number;
              perceptualLoudnessDb?: number;
            };
          };
        }
      | undefined;
    const loudnessDb =
      response?.playerConfig?.audioConfig?.loudnessDb ??
      response?.playerConfig?.audioConfig?.perceptualLoudnessDb;
    return typeof loudnessDb === 'number' ? loudnessDb : null;
  } catch {
    return null;
  }
};

let pendingRetry: ReturnType<typeof setTimeout> | null = null;

const cancelPendingRetry = () => {
  if (pendingRetry !== null) {
    clearTimeout(pendingRetry);
    pendingRetry = null;
  }
};

const updateTrackGain = (retriesLeft = 4) => {
  cancelPendingRetry();

  if (!currentConfig.autoTrackGain) {
    chain.applyTrackGain(0);
    return;
  }

  const loudnessDb = getContentLoudnessDb();
  if (loudnessDb === null) {
    if (retriesLeft > 0) {
      // YT may not have populated loudness yet.
      pendingRetry = setTimeout(() => updateTrackGain(retriesLeft - 1), 400);
    } else {
      chain.applyTrackGain(0);
    }
    return;
  }

  // loudnessDb is signed: only boost tracks quieter than the reference.
  const compensation = loudnessDb < 0 ? -loudnessDb : 0;
  const target = Math.min(compensation, currentConfig.maxTrackGainDb);
  chain.applyTrackGain(target);
};

const sourceMediaElement = (
  source: MediaElementAudioSourceNode | null,
): HTMLVideoElement | null =>
  ((
    source as
      | (MediaElementAudioSourceNode & { mediaElement?: HTMLMediaElement })
      | null
  )?.mediaElement as HTMLVideoElement | undefined) ?? null;

let videoSwapObserver: MutationObserver | null = null;

const stopWatchingForVideoSwap = () => {
  if (videoSwapObserver) {
    videoSwapObserver.disconnect();
    videoSwapObserver = null;
  }
};

const handleVideoSwap = (newEl: HTMLVideoElement) => {
  if (!chain.context) return;
  // The owner re-creates the source node for the swapped element and re-cuts
  // the path; the chain then rebuilds its own nodes on the new source.
  const source = rebindAudioGraphSource(newEl);
  if (!source) return;
  chain.build(source, chain.context);
  updateTrackGain();
  watchForVideoSwap();
};

const watchForVideoSwap = () => {
  stopWatchingForVideoSwap();
  const currentEl = sourceMediaElement(chain.source);
  if (!currentEl) return;
  // YT swaps the <video> element on some seeks (seek near end, then back).
  // The source stays bound to the old element, which would bypass the chain.
  const target = document.querySelector('#movie_player') ?? document.body;
  videoSwapObserver = new MutationObserver(() => {
    const newEl = document.querySelector<HTMLVideoElement>('video');
    if (!newEl || newEl === currentEl) return;
    handleVideoSwap(newEl);
  });
  videoSwapObserver.observe(target, { childList: true, subtree: true });
};

const audioCanPlayHandler = ({
  detail: { audioSource, audioContext },
}: CustomEvent<Compressor>) => {
  cancelPendingRetry();
  chain.build(audioSource, audioContext);
  updateTrackGain();
  watchForVideoSwap();
};

const ensureAudioContextLoad = (playerApi: MusicPlayer) => {
  if (playerApi.getPlayerState() !== 1 || chain.context) return;

  playerApi.loadVideoById(
    playerApi.getPlayerResponse().videoDetails.videoId,
    playerApi.getCurrentTime(),
    playerApi.getUserPlaybackQualityPreference(),
  );
};

export default createPlugin({
  name: () => t('plugins.audio-compressor.name'),
  description: () => t('plugins.audio-compressor.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    autoTrackGain: false,
    maxTrackGainDb: 12,
  } as AudioCompressorPluginConfig,

  menu: async ({
    getConfig,
    setConfig,
  }: MenuContext<AudioCompressorPluginConfig>): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.audio-compressor.menu.auto-track-gain'),
        type: 'checkbox',
        checked: config.autoTrackGain,
        click(item) {
          setConfig({ autoTrackGain: item.checked });
        },
      },
      {
        label: t('plugins.audio-compressor.menu.maximum-gain.label'),
        type: 'submenu',
        submenu: MAX_TRACK_GAIN_CHOICES.map((db) => ({
          label: `${db} dB`,
          type: 'radio' as const,
          checked: config.maxTrackGainDb === db,
          click() {
            setConfig({ maxTrackGainDb: db });
          },
        })),
      },
    ];
  },

  renderer: {
    async start({ getConfig }) {
      // Register synchronously so we never miss an event during the await.
      document.addEventListener('peard:audio-can-play', audioCanPlayHandler, {
        passive: true,
      });
      currentConfig = await getConfig();
      // Re-enabled with a chain already built: rebuild now, not on next track.
      if (chain.source && chain.context) {
        // The element may have been swapped while disabled (observer was off):
        // rebind to the live one rather than rebuild onto a dead source.
        const currentVideo = document.querySelector<HTMLVideoElement>('video');
        if (currentVideo && sourceMediaElement(chain.source) !== currentVideo) {
          handleVideoSwap(currentVideo);
        } else {
          chain.build(chain.source, chain.context);
          updateTrackGain();
          watchForVideoSwap();
        }
      }
    },

    onPlayerApiReady(playerApi) {
      ensureAudioContextLoad(playerApi);
    },

    onConfigChange(newConfig: AudioCompressorPluginConfig) {
      currentConfig = newConfig;
      updateTrackGain();
    },

    stop() {
      document.removeEventListener('peard:audio-can-play', audioCanPlayHandler);
      stopWatchingForVideoSwap();
      cancelPendingRetry();
      chain.teardown();
    },
  },
});
