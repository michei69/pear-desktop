import mduiStyle from 'mdui/mdui.css?inline';
import { ErrorBoundary } from 'solid-js';
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

const BootError = (props: { error: unknown }) => {
  const message = () =>
    props.error instanceof Error ? props.error.message : String(props.error);

  return (
    <div
      style={{
        'position': 'fixed',
        'inset': '0',
        'display': 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'padding': '32px',
        'background': '#1d1b20',
        'color': '#e6e1e5',
        'font-family': 'Roboto, system-ui, sans-serif',
      }}
    >
      <div style={{ 'max-width': '560px' }}>
        <div
          style={{
            'font-size': '20px',
            'font-weight': '600',
            'margin-bottom': '12px',
          }}
        >
          {t('settings-ui.boot-failed.title')}
        </div>
        <div
          style={{
            'margin-bottom': '20px',
            'color': '#cac4d0',
            'font-size': '13px',
            'line-height': '1.5',
            'white-space': 'pre-wrap',
            'word-break': 'break-word',
          }}
        >
          {t('settings-ui.boot-failed.message', { error: message() })}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            'padding': '9px 18px',
            'border': '1px solid #938f99',
            'border-radius': '20px',
            'background': 'transparent',
            'color': '#d0bcff',
            'cursor': 'pointer',
            'font-family': 'inherit',
            'font-size': '13px',
            'font-weight': '500',
          }}
          type="button"
        >
          {t('settings-ui.boot-failed.reload')}
        </button>
      </div>
    </div>
  );
};

const renderBootError = (error: unknown) => {
  const host = document.createElement('div');
  host.id = 'ytmd-sui-standalone-root';
  document.body.replaceChildren(host);
  render(() => <BootError error={error} />, host);
};

const boot = async () => {
  await loadI18n(window.mainConfig.get('options.language') ?? 'en');

  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) =>
      document.addEventListener('DOMContentLoaded', () => resolve(), {
        once: true,
      }),
    );
  }

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
  refreshNewUI();

  document.getElementById('sui-boot-fallback')?.remove();

  const host = document.createElement('div');
  host.id = 'ytmd-sui-standalone-root';
  document.body.appendChild(host);

  render(
    () => (
      <ErrorBoundary fallback={(error: unknown) => <BootError error={error} />}>
        <SettingsModal onClose={() => window.close()} standalone />
      </ErrorBoundary>
    ),
    host,
  );
};

export const bootStandaloneSettings = async () => {
  try {
    await boot();
  } catch (error) {
    console.error(
      '[settings-ui] the standalone settings window failed to start:',
      error,
    );
    renderBootError(error);
  }
};
