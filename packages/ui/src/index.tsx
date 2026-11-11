// The in-page settings overlay and its "Settings" entry in YTM's
// sidebar. Both render into shadow roots so YTM's styles can't leak in and
// ours can't leak out.

import { containScroll, shadowHost, type SidebarEntry, sidebarEntry } from "@pear/sdk/dom";
import { render } from "preact";
import { Settings, type SettingsModel } from "./settings.tsx";
import { keepFlagOverridesLive } from "./settings/debug-info.ts";
import { UI_STRINGS } from "./strings.ts";
import { overlayStyles } from "./styles.ts";

export { HostState, type SettingsModel, setMessage, settingsModel } from "./model.ts";

/** The exit animation's duration, mirroring the dialog's in styles/layout.ts. */
const CLOSE_ANIMATION_MS = 220;

export interface SettingsController {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  /** Applies a new settingsUi core config: shows or takes away the sidebar entry. */
  applySettingsUi(config: Record<string, unknown>): void;
}

export function mountSettings(model: SettingsModel): SettingsController {
  const dialogModel = keepFlagOverridesLive(model);
  let container: HTMLElement | undefined;
  let isOpen = false;
  let closing = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let returnFocus: Element | null = null;

  const renderDialog = (isClosing: boolean) => {
    // Built on first open: nothing to pay for at startup.
    container ??= createOverlay();
    render(<Settings closing={isClosing} model={dialogModel} onClose={close} />, container);
  };

  /** Plays the exit animation, then unmounts; a click while closing reopens at once. */
  const close = () => {
    if (!isOpen || closing) return;
    closing = true;
    renderDialog(true);
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      closing = false;
      isOpen = false;
      if (container) render(null, container);
      if (returnFocus instanceof HTMLElement) returnFocus.focus();
    }, CLOSE_ANIMATION_MS);
  };

  const open = () => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
      closing = false;
      renderDialog(false);
      return;
    }
    if (isOpen) return;
    isOpen = true;
    returnFocus = document.activeElement;
    renderDialog(false);
  };

  const toggle = () => (isOpen && !closing ? close() : open());

  // The dialog's own options, as the host last reported them.
  let uiConfig: Record<string, unknown> = { ...dialogModel.core("settingsUi")?.config };
  let entry: SidebarEntry | undefined;
  const entryOwner = { onCleanup() {} };

  /** Every entry point funnels through here, so the separate-window option is honoured. */
  const openSettings = () => {
    if (uiConfig.separateWindow === true) {
      void dialogModel.openSettingsWindow();
      return;
    }
    open();
  };

  const mountEntry = () => {
    if (entry || uiConfig.showButton === false) return;
    entry = sidebarEntry(entryOwner, {
      name: "settings",
      label: dialogModel.t("settings-ui.title", UI_STRINGS["settings-ui.title"]),
      iconType: "SETTINGS_MATERIAL",
      title: dialogModel.t("settings-ui.open-hint", UI_STRINGS["settings-ui.open-hint"]),
      ariaLabel: dialogModel.t("settings-ui.open", UI_STRINGS["settings-ui.open"]),
      onClick: openSettings,
    });
  };

  document.addEventListener(
    "keydown",
    (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        if (uiConfig.separateWindow === true) void dialogModel.openSettingsWindow();
        else toggle();
      }
    },
    true,
  );

  mountEntry();
  return {
    get isOpen() {
      return isOpen && !closing;
    },
    open,
    close,
    toggle,
    applySettingsUi(config) {
      uiConfig = { ...config };
      if (uiConfig.showButton === false) {
        entry?.remove();
        entry = undefined;
      } else {
        mountEntry();
      }
    },
  };
}

/** The overlay's shadow host, in <body>; returns the element the dialog renders into. */
function createOverlay() {
  const { host, root } = shadowHost("pear-settings", overlayStyles);
  const container = document.createElement("div");
  root.append(container);
  // Keep YTM's global shortcuts (space, j/k, …) from firing while typing here.
  for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (event) => event.stopPropagation());
  // The page behind doesn't scroll either: over the scrim, or past the end of the dialog's lists.
  containScroll(host);
  document.body.append(host);
  return container;
}
