// pear-desktop's Notifications menu: priority radios on Linux, the interactive
// switches and toast styles on Windows, and the resume-notification switch
// everywhere. The rewrite's app and tray menu items are flat, so this opens as
// one native popup (like Do Not Track's menu).

import { Menu, type MenuItemConstructorOptions } from "electron";
import { STYLE_LABELS, schema, type Ctx } from "./schema.ts";
import { TOAST_STYLES } from "./toast.ts";

/** Opens the menu next to the app/tray menu item that asks for it. */
export function showMenu(ctx: Ctx) {
  if (ctx.window.isDestroyed()) return;
  Menu.buildFromTemplate(menuTemplate(ctx, process.platform)).popup(ctx.window.isVisible() ? { window: ctx.window } : {});
}

/** The menu pear-desktop built, with its per-platform sections. */
export function menuTemplate(ctx: Ctx, platform: string): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  if (platform === "linux") {
    items.push({
      label: ctx.t("plugins.notifications.menu.priority", "Notification Priority"),
      submenu: schema.urgency.options.map((option) => ({
        label: ctx.t(`plugins.notifications.settings.urgency.options.${option.value}`, option.label),
        type: "radio",
        checked: ctx.config.urgency === option.value,
        click: () => ctx.setConfig({ urgency: option.value }),
      })),
    });
  } else if (platform === "win32") {
    const switchItem = (
      label: string,
      checked: boolean,
      patch: (checked: boolean) => Parameters<Ctx["setConfig"]>[0],
    ): MenuItemConstructorOptions => ({
      label,
      type: "checkbox",
      checked,
      click: (item) => ctx.setConfig(patch(item.checked)),
    });
    items.push(
      {
        label: ctx.t("plugins.notifications.menu.interactive", "Interactive Notifications"),
        type: "checkbox",
        checked: ctx.config.interactive,
        click: (item) => ctx.setConfig({ interactive: item.checked }),
      },
      {
        label: ctx.t("plugins.notifications.menu.interactive-settings.label", "Interactive Settings"),
        submenu: [
          switchItem(
            ctx.t("plugins.notifications.menu.interactive-settings.submenu.hide-button-text", "Hide button text"),
            ctx.config.hideButtonText,
            (hideButtonText) => ({ hideButtonText }),
          ),
          switchItem(
            ctx.t("plugins.notifications.menu.interactive-settings.submenu.refresh-on-play-pause", "Refresh on Play/Pause"),
            ctx.config.refreshOnPlayPause,
            (refreshOnPlayPause) => ({ refreshOnPlayPause }),
          ),
          switchItem(
            ctx.t("plugins.notifications.menu.interactive-settings.submenu.tray-controls", "Open/Close on tray click"),
            ctx.config.trayControls,
            (trayControls) => ({ trayControls }),
          ),
          switchItem(
            ctx.t("plugins.notifications.menu.interactive-settings.submenu.hover-controls", "Show mini-player on tray hover"),
            ctx.config.hoverControls,
            (hoverControls) => ({ hoverControls }),
          ),
        ],
      },
      {
        label: ctx.t("plugins.notifications.menu.toast-style", "Toast style"),
        submenu: TOAST_STYLES.map((style) => ({
          label: ctx.t(`plugins.notifications.settings.toastStyle.options.${style}`, STYLE_LABELS[style]),
          type: "radio",
          checked: ctx.config.toastStyle === style,
          click: () => ctx.setConfig({ toastStyle: style }),
        })),
      },
    );
  }
  items.push({
    label: ctx.t("plugins.notifications.menu.unpause-notification", "Show notification on unpause"),
    type: "checkbox",
    checked: ctx.config.unpauseNotification,
    click: (item) => ctx.setConfig({ unpauseNotification: item.checked }),
  });
  return items;
}
