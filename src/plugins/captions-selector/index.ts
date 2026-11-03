import { APPLICATION_NAME, t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './back';
import renderer, {
  type CaptionsSelectorConfig,
  type LanguageOptions,
} from './renderer';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

export default createPlugin<
  unknown,
  unknown,
  {
    captionTrackList: LanguageOptions[] | null;
    api: MusicPlayer | null;
    config: CaptionsSelectorConfig | null;
    videoChangeListener: () => void;
    video: HTMLVideoElement | null;
    controls: HTMLElement | null;
    dispose: (() => void) | null;
    trackListTimer: ReturnType<typeof setTimeout> | null;
    captionSwitchTimer: ReturnType<typeof setTimeout> | null;
    unwatchPlayer: (() => void) | null;
    rafId: number;
    ipc: RendererContext<CaptionsSelectorConfig>['ipc'] | null;
    setConfig: RendererContext<CaptionsSelectorConfig>['setConfig'] | null;
    sync(): void;
    chooseCaptions(): Promise<void>;
  },
  CaptionsSelectorConfig
>({
  name: () => t('plugins.captions-selector.name'),
  description: () =>
    t('plugins.captions-selector.description', {
      applicationName: APPLICATION_NAME,
    }),
  config: {
    enabled: false,
    disableCaptions: false,
    autoload: false,
    lastCaptionsCode: '',
  },

  settings: [
    {
      type: 'switch',
      key: 'autoload',
      label: () => t('plugins.captions-selector.menu.autoload'),
    },
    {
      type: 'switch',
      key: 'disableCaptions',
      label: () => t('plugins.captions-selector.menu.disable-captions'),
    },
  ],

  async menu({ getConfig, setConfig }) {
    const config = await getConfig();
    return [
      {
        label: t('plugins.captions-selector.menu.autoload'),
        type: 'checkbox',
        checked: config.autoload,
        click(item) {
          setConfig({ autoload: item.checked });
        },
      },
      {
        label: t('plugins.captions-selector.menu.disable-captions'),
        type: 'checkbox',
        checked: config.disableCaptions,
        click(item) {
          setConfig({ disableCaptions: item.checked });
        },
      },
    ];
  },

  backend,
  renderer,
});
