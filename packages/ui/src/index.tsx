// The in-page settings overlay and its "Settings" entry in YTM's
// sidebar. Both render into shadow roots so YTM's styles can't leak in and
// ours can't leak out.

import { containScroll, shadowHost, sidebarEntry } from "@pear/sdk/dom";
import type { Translate } from "@pear/sdk/i18n";
import { render } from "preact";
import { Settings, type SettingsModel } from "./settings.tsx";
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
}

export function mountSettings(model: SettingsModel): SettingsController {
  let container: HTMLElement | undefined;
  let isOpen = false;
  let closing = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let returnFocus: Element | null = null;

  const renderDialog = (isClosing: boolean) => {
    // Built on first open: nothing to pay for at startup.
    container ??= createOverlay();
    render(<Settings closing={isClosing} model={model} onClose={close} />, container);
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

  document.addEventListener(
    "keydown",
    (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        toggle();
      }
    },
    true,
  );

  mountSidebarEntries(open, model.t);
  return {
    get isOpen() {
      return isOpen && !closing;
    },
    open,
    close,
    toggle,
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

/** A "Settings" entry at the end of the sidebar's primary section, in both the full and the mini guide. */
function mountSidebarEntries(open: () => void, t: Translate) {
  // The core's entry lives as long as the page.
  const page = { onCleanup() {} };
  sidebarEntry(page, {
    name: "settings",
    label: t("settings-ui.title", UI_STRINGS["settings-ui.title"]),
    iconType: "SETTINGS_MATERIAL",
    title: t("settings-ui.open-hint", UI_STRINGS["settings-ui.open-hint"]),
    ariaLabel: t("settings-ui.open", UI_STRINGS["settings-ui.open"]),
    onClick: open,
  });
}
