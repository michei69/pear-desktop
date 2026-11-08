import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';
import type { VideoDataChanged } from '@/types/video-data-changed';

export type DisableAutoPlayPluginConfig = {
  enabled: boolean;
  applyOnce: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  {
    config: DisableAutoPlayPluginConfig | null;
    api: MusicPlayer | null;
    eventListener: (event: CustomEvent<VideoDataChanged>) => void;
    timeUpdateListener: (e: Event) => void;
  },
  DisableAutoPlayPluginConfig
>({
  name: () => t('plugins.disable-autoplay.name'),
  description: () => t('plugins.disable-autoplay.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    applyOnce: false,
  },
  settings: [
    {
      type: 'switch',
      key: 'applyOnce',
      label: () => t('plugins.disable-autoplay.menu.apply-once'),
    },
  ],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.disable-autoplay.menu.apply-once'),
        type: 'checkbox',
        checked: config.applyOnce,
        async click() {
          const nowConfig = await getConfig();
          setConfig({
            applyOnce: !nowConfig.applyOnce,
          });
        },
      },
    ];
  },
  renderer: {
    config: null,
    api: null,
    eventListener(event: CustomEvent<VideoDataChanged>) {
      // The one-shot may only be consumed by the event it acts on: the channel
      // also carries `newdata`/`dataupdated`, and removing the listener there
      // would disarm the plugin without ever pausing.
      if (event.detail.name !== 'dataloaded') return;

      if (this.config?.applyOnce) {
        document.removeEventListener('videodatachange', this.eventListener);
      }

      this.api?.pauseVideo();
      document
        .querySelector<HTMLVideoElement>('video')
        ?.addEventListener('timeupdate', this.timeUpdateListener, {
          once: true,
        });
    },
    timeUpdateListener(e: Event) {
      if (e.target instanceof HTMLVideoElement) {
        e.target.pause();
      }
    },
    async start({ getConfig }) {
      this.config = await getConfig();
    },
    onPlayerApiReady(api) {
      this.api = api;

      document.removeEventListener('videodatachange', this.eventListener);
      document.addEventListener('videodatachange', this.eventListener);
    },
    stop() {
      document.removeEventListener('videodatachange', this.eventListener);
      document
        .querySelector<HTMLVideoElement>('video')
        ?.removeEventListener('timeupdate', this.timeUpdateListener);
      this.api = null;
      this.config = null;
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
      // Turning "applies only on startup" off must revive a one-shot that was
      // already consumed: the user is asking for every track again, and there is
      // no other path that re-arms the listener.
      if (!newConfig.applyOnce) {
        document.addEventListener('videodatachange', this.eventListener);
      }
    },
  },
});
