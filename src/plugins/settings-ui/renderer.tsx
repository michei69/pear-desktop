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

/** The pending unmount from the exit animation, so teardown can cancel it. */
let closeTimer: ReturnType<typeof setTimeout> | undefined;
/** A reopen asked for while the exit animation is still running. */
let reopenAfterClose = false;

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

  // The close latches live on the mounted SettingsModal instance, so an
  // in-flight exit has to finish (and unmount) first: reopening the same
  // instance would leave it with `isClosing`/`restartSessionClosed` stuck true.
  // Remount after the animation instead, which starts a fresh restart session.
  if (closing()) {
    reopenAfterClose = true;
    return;
  }

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

/** Play the exit animation, then unmount (and remount if a reopen waited). */
const closeModal = () => {
  setClosing(true);
  clearTimeout(closeTimer);
  // ponytail: mirrors the .sui-modal exit animation duration in styles.css
  closeTimer = setTimeout(() => {
    closeTimer = undefined;
    setOpen(false);
    setClosing(false);

    if (reopenAfterClose) {
      reopenAfterClose = false;
      // A new task, so the old instance is fully disposed (and its restart
      // session closed) before the fresh one mounts.
      queueMicrotask(() => {
        if (started) setOpen(true);
      });
    }
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

  clearTimeout(closeTimer);
  closeTimer = undefined;
  reopenAfterClose = false;

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
// Lifecycle teardown, not a reactive read: this is what HMR/stop() call.
// oxlint-disable-next-line solid/reactivity -- teardown callback, not a tracked scope
hot?.dispose(teardownUi);
