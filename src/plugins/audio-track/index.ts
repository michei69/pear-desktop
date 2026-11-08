import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createBackend, createPlugin, createRenderer } from '@/utils';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer, PlayerAudioTrack } from '@/types/music-player';
import type { AppElement } from '@/types/queue';
import type { SettingOption } from '@/types/settings';

const SELECT_TRACK_CHANNEL = 'peard:audio-track-select';
const MENU_REQUEST_CHANNEL = 'peard:audio-track-menu';

/**
 * How many times one track selection is re-issued before giving up. A player
 * that accepts `setAudioTrack` but keeps the old track emits
 * `onPlaybackAudioChange` again, and without a cap that becomes a permanent
 * 100 ms renegotiation loop.
 */
const MAX_REAPPLY_ATTEMPTS = 3;

export type AudioTrackConfig = {
  enabled: boolean;
  preferOriginal: boolean;
  audioTrack: string;
};

let availableTracks: PlayerAudioTrack[] = [];

type RawAudioTrack = PlayerAudioTrack & {
  Pb?: {
    id?: string;
    name?: string;
    isDefault?: boolean;
    isAutoDubbed?: boolean;
  };
};

const rawTrack = (track: PlayerAudioTrack) => track as RawAudioTrack;

const trackId = (track: PlayerAudioTrack) =>
  track.getLanguageInfo?.()?.getId?.() ||
  rawTrack(track).Pb?.id ||
  track.id ||
  '';

const trackName = (track: PlayerAudioTrack) =>
  track.getLanguageInfo?.()?.getName?.() ||
  rawTrack(track).Pb?.name ||
  track.id;

const isAutoDubbed = (track: PlayerAudioTrack) =>
  track.getLanguageInfo?.()?.getIsAutoDubbed?.() ??
  rawTrack(track).Pb?.isAutoDubbed ??
  track.isAutoDubbed?.() ??
  false;

const isDefaultTrack = (track: PlayerAudioTrack) =>
  track.getLanguageInfo?.()?.getIsDefault?.() ??
  rawTrack(track).Pb?.isDefault ??
  false;

const isOriginalTrack = (track: PlayerAudioTrack) =>
  !isAutoDubbed(track) && isDefaultTrack(track);

const findOriginalTrack = (tracks: PlayerAudioTrack[]) =>
  tracks.find((track) => isOriginalTrack(track)) ??
  tracks.find((track) => !isAutoDubbed(track));

const getAudioTrackOptions = (): SettingOption[] => {
  const options = new Map<string, SettingOption>([
    [
      '',
      {
        value: '',
        label: () => t('plugins.audio-track.settings.automatic'),
      },
    ],
  ]);

  for (const track of availableTracks) {
    const id = trackId(track);
    if (id && !options.has(id)) {
      options.set(id, { value: id, label: () => trackName(track) });
    }
  }

  return [...options.values()];
};

const readTracks = (api: MusicPlayer): PlayerAudioTrack[] => {
  try {
    return api.getAvailableAudioTracks?.() ?? [];
  } catch {
    return [];
  }
};

const readCurrentTrackId = (api: MusicPlayer): string => {
  try {
    const track = api.getAudioTrack?.();
    return track ? trackId(track) : '';
  } catch {
    return '';
  }
};

const renderer = createRenderer<
  {
    api: MusicPlayer | null;
    config: AudioTrackConfig | null;
    ipc: RendererContext<AudioTrackConfig>['ipc'] | null;
    setConfig: RendererContext<AudioTrackConfig>['setConfig'] | null;
    reapplyTimer: ReturnType<typeof setTimeout> | null;
    /** Re-issues of the current desired track; reset on a track/config change. */
    reapplyAttempts: number;
    audioTrackHandler: (() => void) | null;
    videoDataHandler: ((event: Event) => void) | null;
    menuHandler: (() => void) | null;
    detachPlayerListeners(): void;
    scheduleApply(delay?: number): void;
    applyPreferredTrack(): void;
    refreshTracks(): void;
    audioTrackChangeListener(): void;
    videoDataChangeListener(event: Event): void;
    menuRequestListener(): void;
    chooseTrack(): Promise<void>;
  },
  AudioTrackConfig
>({
  api: null,
  config: null,
  ipc: null,
  setConfig: null,
  reapplyTimer: null,
  reapplyAttempts: 0,
  audioTrackHandler: null,
  videoDataHandler: null,
  menuHandler: null,
  detachPlayerListeners() {
    if (this.audioTrackHandler) {
      this.api?.removeEventListener?.(
        'onPlaybackAudioChange',
        this.audioTrackHandler,
      );
    }
    if (this.videoDataHandler) {
      document.removeEventListener('videodatachange', this.videoDataHandler);
    }
  },
  scheduleApply(delay = 200) {
    if (this.reapplyTimer) clearTimeout(this.reapplyTimer);
    this.reapplyTimer = setTimeout(() => {
      this.reapplyTimer = null;
      this.applyPreferredTrack();
    }, delay);
  },
  applyPreferredTrack() {
    const api = this.api;
    const config = this.config;
    if (!api || !config) return;

    const tracks = readTracks(api);
    availableTracks = tracks;
    if (tracks.length < 2) return;

    const configuredTrack = config.audioTrack
      ? tracks.find((track) => trackId(track) === config.audioTrack)
      : undefined;
    const desiredTrack =
      configuredTrack ??
      (config.preferOriginal ? findOriginalTrack(tracks) : undefined);
    if (!desiredTrack) return;

    const desiredId = trackId(desiredTrack);
    if (!desiredId || desiredId === readCurrentTrackId(api)) {
      // Converged: the next mismatch starts a fresh attempt budget.
      this.reapplyAttempts = 0;
      return;
    }

    // A track the player refuses must not be re-issued forever: the audio
    // change event would schedule another apply every 100 ms. Stop until the
    // track or the configuration changes.
    if (this.reapplyAttempts >= MAX_REAPPLY_ATTEMPTS) return;
    this.reapplyAttempts += 1;

    try {
      api.setAudioTrack?.(desiredTrack);
    } catch {
      // HACK: YouTube throws when a track cannot be served for the current player type
    }
  },
  refreshTracks() {
    if (this.api) availableTracks = readTracks(this.api);
  },
  audioTrackChangeListener() {
    this.scheduleApply(100);
  },
  videoDataChangeListener(event: Event) {
    const name = (event as CustomEvent<{ name?: string }>).detail?.name;
    if (name !== 'dataloaded') return;
    this.reapplyAttempts = 0;
    this.refreshTracks();
    this.scheduleApply();
  },
  menuRequestListener() {
    this.chooseTrack().catch(() => {});
  },
  async chooseTrack() {
    const api = this.api;
    const ipc = this.ipc;
    const setConfig = this.setConfig;
    if (!api || !ipc || !setConfig) return;

    this.refreshTracks();
    const tracks = availableTracks;
    if (tracks.length < 2) {
      document
        .querySelector<AppElement>('ytmusic-app')
        ?.toastService?.show(t('plugins.audio-track.toast.no-tracks'));
      return;
    }

    const currentId = readCurrentTrackId(api);
    const currentIndex = Math.max(
      0,
      tracks.findIndex((track) => trackId(track) === currentId) + 1,
    );
    const labels = [
      t('plugins.audio-track.settings.automatic'),
      ...tracks.map(trackName),
    ];
    const selected = (await ipc.invoke(
      SELECT_TRACK_CHANNEL,
      labels,
      currentIndex,
    )) as string | number | null;
    if (selected === null || selected === undefined) return;

    const index = Number(selected);
    if (index === 0) {
      setConfig({ audioTrack: '' });
      if (this.config) this.config = { ...this.config, audioTrack: '' };
      this.reapplyAttempts = 0;
      this.applyPreferredTrack();
      return;
    }

    const track = tracks[index - 1];
    const id = track ? trackId(track) : '';
    if (!track || !id) return;

    setConfig({ audioTrack: id });
    if (this.config) this.config = { ...this.config, audioTrack: id };
    this.reapplyAttempts = 0;
    try {
      api.setAudioTrack?.(track);
    } catch {
      // HACK: YouTube throws when a track cannot be served for the current player type
    }
  },
  async start({ getConfig, ipc, setConfig }) {
    this.config = await getConfig();
    this.ipc = ipc;
    this.setConfig = setConfig;
    this.refreshTracks();
    this.menuHandler = () => this.menuRequestListener();
    ipc.on(MENU_REQUEST_CHANNEL, this.menuHandler);
  },
  stop() {
    if (this.reapplyTimer) {
      clearTimeout(this.reapplyTimer);
      this.reapplyTimer = null;
    }
    this.reapplyAttempts = 0;

    this.detachPlayerListeners();
    if (this.menuHandler) {
      this.ipc?.off(MENU_REQUEST_CHANNEL, this.menuHandler);
    }
    this.audioTrackHandler = null;
    this.videoDataHandler = null;
    this.menuHandler = null;
    this.api = null;
    this.ipc = null;
    this.setConfig = null;
  },
  onPlayerApiReady(playerApi) {
    this.detachPlayerListeners();
    this.api = playerApi;
    this.reapplyAttempts = 0;
    this.refreshTracks();
    this.audioTrackHandler = () => this.audioTrackChangeListener();
    this.videoDataHandler = (event) => this.videoDataChangeListener(event);
    playerApi.addEventListener?.(
      'onPlaybackAudioChange',
      this.audioTrackHandler,
    );
    document.addEventListener('videodatachange', this.videoDataHandler);
    this.scheduleApply(0);
  },
  onConfigChange(newConfig) {
    this.config = newConfig;
    // A new selection gets its own attempts, even if the previous one was
    // abandoned as unservable.
    this.reapplyAttempts = 0;
    this.applyPreferredTrack();
  },
});

export default createPlugin<
  unknown,
  unknown,
  typeof renderer,
  AudioTrackConfig
>({
  name: () => t('plugins.audio-track.name'),
  description: () => t('plugins.audio-track.description'),
  restartNeeded: false,

  config: {
    enabled: false,
    preferOriginal: true,
    audioTrack: '',
  },

  settings: [
    {
      type: 'switch',
      key: 'preferOriginal',
      label: () => t('plugins.audio-track.settings.prefer-original'),
      description: () =>
        t('plugins.audio-track.settings.prefer-original-description'),
    },
    {
      type: 'select',
      key: 'audioTrack',
      variant: 'dropdown',
      refreshable: true,
      label: () => t('plugins.audio-track.settings.audio-track'),
      description: () =>
        t('plugins.audio-track.settings.audio-track-description'),
      options: getAudioTrackOptions,
    },
  ],

  async menu({ getConfig, setConfig, window }) {
    const config = await getConfig();
    return [
      {
        label: t('plugins.audio-track.menu.prefer-original'),
        type: 'checkbox',
        checked: config.preferOriginal,
        click(item) {
          setConfig({ preferOriginal: item.checked });
        },
      },
      { type: 'separator' },
      {
        label: t('plugins.audio-track.menu.select-track'),
        click() {
          window.webContents.send(MENU_REQUEST_CHANNEL);
        },
      },
      {
        label: t('plugins.audio-track.menu.automatic'),
        type: 'radio',
        checked: config.audioTrack === '',
        click() {
          setConfig({ audioTrack: '' });
        },
      },
    ];
  },

  backend: createBackend({
    start({ ipc, window }) {
      ipc.handle(
        SELECT_TRACK_CHANNEL,
        async (labels: string[], currentIndex: number) =>
          await prompt(
            {
              title: t('plugins.audio-track.prompt.title'),
              label: t('plugins.audio-track.prompt.label'),
              type: 'select',
              value: currentIndex >= 0 ? String(currentIndex) : undefined,
              selectOptions: Object.fromEntries(
                labels.map((label, index) => [String(index), label]),
              ),
              resizable: true,
              ...promptOptions(),
            },
            window,
          ),
      );
    },
    stop({ ipc }) {
      ipc.removeHandler(SELECT_TRACK_CHANNEL);
    },
  }),

  renderer,
});
