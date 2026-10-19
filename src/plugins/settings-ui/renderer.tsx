import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { createRenderer } from '@/utils';
import {
  getGuideLists,
  SETTINGS_ENTRY_CLASS,
  watchGuides,
} from '@/utils/guide';

import { SettingsModal } from './components/SettingsModal';
import { ThemePaletteField } from './components/ThemePalette';
import { ThemePresetField } from './components/ThemePreset';
import {
  listenStorePush,
  listenThemesPush,
  refreshStore,
  refreshThemes,
  setIpc,
  unlistenStorePush,
  unlistenThemesPush,
} from './state';

import type { SettingsUIConfig } from './index';
import type { RendererContext } from '@/types/contexts';

const [open, setOpen] = createSignal(false);
const [closing, setClosing] = createSignal(false);

/**
 * Lets other plugins (the `/settings` search command) open the settings, and the
 * one place the separate-window option is honoured: every entry point funnels
 * through here.
 */
export const openSettings = () => {
  if (config.separateWindow) {
    ipc?.invoke(OPEN_WINDOW);
    return;
  }

  // Also cancels a close still animating, so asking again reopens instead of
  // landing on a modal already on its way out.
  setClosing(false);
  setOpen(true);
};

/**
 * YTM's own sidebar entry, driven by the inner `guideEntryRenderer` payload:
 * without a `navigationEndpoint` its built-in tap handler does nothing.
 */
type GuideEntryRendererElement = HTMLElement & {
  isCollapsed: boolean;
  data: {
    isPrimary: boolean;
    icon: { iconType: string };
    formattedTitle: { runs: { text: string }[] };
  };
};

let modalHost: HTMLElement | undefined;
let modalDispose: (() => void) | undefined;
let started = false;
let config: SettingsUIConfig = {
  enabled: true,
  showButton: true,
  separateWindow: false,
};
let ipc: RendererContext<SettingsUIConfig>['ipc'] | undefined;

/** The channel `src/menu.ts` uses to open the settings from the Navigation menu. */
const OPEN_FROM_MENU = 'ytmd-sui:open';
/** Asks the backend for the standalone settings window. */
const OPEN_WINDOW = 'ytmd-sui:open-window';

const injectButton = (guide: HTMLElement, items: HTMLElement) => {
  if (!started || !config.showButton) return;
  if (items.querySelector(`.${SETTINGS_ENTRY_CLASS}`)) return;

  const host = document.createElement(
    'ytmusic-guide-entry-renderer',
  ) as GuideEntryRendererElement;
  host.classList.add(SETTINGS_ENTRY_CLASS);
  host.isCollapsed = guide.id.startsWith('mini-');
  host.data = {
    isPrimary: true,
    icon: { iconType: 'SETTINGS_MATERIAL' },
    formattedTitle: { runs: [{ text: t('settings-ui.title') }] },
  };
  host.addEventListener('tap', () => openSettings());
  items.appendChild(host);
};

const removeButton = () => {
  document
    .querySelectorAll(`.${SETTINGS_ENTRY_CLASS}`)
    .forEach((host) => host.remove());
};

/**
 * Adds the sidebar entry to every mounted guide that lacks it. Both guides stay
 * in the DOM once the mini one has appeared, and YTM may rebuild either, so
 * this is the mutation-driven half of the sync.
 */
const injectMissing = () => {
  for (const { guide, items } of getGuideLists()) injectButton(guide, items);
};

/** Adds the sidebar entry, or takes it away when the option is switched off. */
const syncButton = () => {
  removeButton();
  injectMissing();
};

let stopGuideWatch: (() => void) | undefined;

/** Play the exit animation, then unmount. */
const closeModal = () => {
  setClosing(true);
  // ponytail: mirrors the .sui-modal exit animation duration in styles.css
  setTimeout(() => {
    setOpen(false);
    setClosing(false);
  }, 220);
};

const mountModal = () => {
  if (modalDispose) return;

  modalHost = document.createElement('div');
  modalHost.id = 'ytmd-sui-root';
  document.body.appendChild(modalHost);

  modalDispose = render(
    () => (
      <Show when={open()}>
        <SettingsModal closing={closing()} onClose={closeModal} />
      </Show>
    ),
    modalHost,
  );
};

const teardownUi = () => {
  started = false;

  stopGuideWatch?.();
  stopGuideWatch = undefined;

  unlistenStorePush();
  unlistenThemesPush();

  ipc?.off(OPEN_FROM_MENU, openSettings);
  ipc = undefined;

  modalDispose?.();
  modalDispose = undefined;
  modalHost?.remove();
  modalHost = undefined;

  removeButton();

  setOpen(false);
  setClosing(false);
};

export const renderer = createRenderer({
  components: {
    themePalette: ThemePaletteField,
    themePreset: ThemePresetField,
  },

  async start(ctx) {
    started = true;
    setIpc(ctx.ipc);
    ipc = ctx.ipc;
    config = await ctx.getConfig();

    // The Navigation menu lives in the main process, so it reaches the modal
    // through here.
    ctx.ipc.on(OPEN_FROM_MENU, openSettings);

    // Listen before the first load: a change landing mid-load is queued and
    // applied over the snapshot, which a delta would otherwise never heal.
    listenStorePush();
    listenThemesPush();

    await refreshStore();
    await refreshThemes();

    mountModal();

    stopGuideWatch = watchGuides(injectMissing);
  },

  onConfigChange(newConfig: SettingsUIConfig) {
    config = newConfig;
    syncButton();
  },

  stop: teardownUi,
});

const hot = (
  import.meta as ImportMeta & {
    hot?: { dispose: (cb: () => void) => void };
  }
).hot;
hot?.dispose(teardownUi);
