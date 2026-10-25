import mduiStyle from 'mdui/mdui.css?inline';
import { render } from 'solid-js/web';

import { loadI18n, t } from '@/i18n';
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

  // The preload injects this bundle at document start, before the parser has
  // built `<head>`/`<body>`; mounting before then throws on a null node and
  // leaves the window blank.
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) =>
      document.addEventListener('DOMContentLoaded', () => resolve(), {
        once: true,
      }),
    );
  }

  // The plugin's stylesheet is normally injected by the plugin loader, which
  // does not run in standalone mode — inject it here, along with mdui's theme
  // tokens (the shell page links no stylesheet).
  for (const css of [mduiStyle, style]) {
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  document.title = t('settings-ui.title');

  setIpc(createRendererIpc());

  listenStorePush();
  listenThemesPush();

  await refreshStore();
  await refreshThemes();
  // The main window answers this one; if it is busy or gone, the probe never
  // settles, so let the UI mount and pick the answer up when (if) it arrives.
  refreshNewUI();

  const host = document.createElement('div');
  host.id = 'ytmd-sui-standalone-root';
  document.body.appendChild(host);

  render(
    () => <SettingsModal onClose={() => window.close()} standalone />,
    host,
  );
};
