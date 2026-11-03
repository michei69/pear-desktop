import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { type MenuTemplate } from '@/menu';
import { createPlugin } from '@/utils';

import style from './style.css?inline';
import { type ClockPluginConfig } from './types';

const defaultConfig: ClockPluginConfig = {
  enabled: false,
  displaySeconds: false,
  hour12: false,
};

export default createPlugin({
  name: () => t('plugins.clock.name'),
  description: () => t('plugins.clock.description'),
  restartNeeded: false,
  config: defaultConfig,
  stylesheets: [style],
  settings: [
    {
      type: 'switch',
      key: 'displaySeconds',
      label: () => t('plugins.clock.menu.format.display-seconds'),
    },
    {
      type: 'switch',
      key: 'hour12',
      label: () => t('plugins.clock.settings.hour-12'),
    },
  ],
  menu: async ({ getConfig, setConfig }): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.clock.menu.format.label'),
        submenu: [
          {
            label: t('plugins.clock.menu.format.display-seconds'),
            type: 'checkbox',
            checked: config.displaySeconds,
            click(item) {
              setConfig({ displaySeconds: item.checked });
            },
          },
          {
            label: t('plugins.clock.menu.format.24-hour-format'),
            type: 'checkbox',
            checked: !config.hour12,
            click(item) {
              setConfig({ hour12: !item.checked });
            },
          },
        ],
      },
    ];
  },
  renderer: {
    displaySeconds: defaultConfig.displaySeconds,
    hour12: defaultConfig.hour12,

    interval: null as ReturnType<typeof setInterval> | null,
    clockContainer: null as HTMLElement | null,
    dispose: undefined as (() => void) | undefined,
    updateTime: null as (() => void) | null,

    async start({ getConfig }) {
      const config = await getConfig();
      this.displaySeconds = config.displaySeconds;
      this.hour12 = config.hour12;

      const [time, setTime] = createSignal('');

      this.updateTime = () => {
        const timeFormat: Intl.DateTimeFormatOptions = {
          hour12: this.hour12,
          hour: 'numeric',
          minute: 'numeric',
          ...(this.displaySeconds && { second: 'numeric' }),
        };
        const locale = window.mainConfig.get('options.language');
        setTime(new Date().toLocaleTimeString(locale, timeFormat));
      };
      this.updateTime();

      this.clockContainer = document.createElement('div');
      this.dispose = render(
        () => <h1 class="clock"> {time()} </h1>,
        this.clockContainer,
      );
      document.querySelector('.center-content')?.append(this.clockContainer);

      this.interval = setInterval(this.updateTime, 1000);
    },
    onConfigChange(newConfig) {
      this.displaySeconds = newConfig.displaySeconds;
      this.hour12 = newConfig.hour12;
      this.updateTime?.();
    },
    stop() {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      this.dispose?.();
      this.dispose = undefined;
      this.clockContainer?.remove();
      this.clockContainer = null;
      this.updateTime = null;
    },
  },
});
