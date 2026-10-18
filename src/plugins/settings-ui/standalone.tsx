import { render } from 'solid-js/web';

import { loadI18n } from '@/i18n';
import { createRendererIpc } from '@/loader/renderer';

import { SettingsModal } from './components/SettingsModal';
import {
  listenStorePush,
  listenThemesPush,
  refreshNewUI,
  refreshStore,
  refreshThemes,
  setIpc,
} from './state';
import style from './styles.css?inline';

export const bootStandaloneSettings = async () => {
  await loadI18n(window.mainConfig.get('options.language') ?? 'en');

  // The plugin's stylesheet is normally injected by the plugin loader, which
  // does not run in standalone mode — inject it here.
  const styleEl = document.createElement('style');
  styleEl.textContent = style;
  document.head.appendChild(styleEl);

  setIpc(createRendererIpc());

  listenStorePush();
  listenThemesPush();

  await refreshStore();
  await refreshThemes();
  await refreshNewUI();

  const host = document.createElement('div');
  host.id = 'ytmd-sui-standalone-root';
  document.body.appendChild(host);

  render(
    () => <SettingsModal onClose={() => window.close()} standalone />,
    host,
  );
};
