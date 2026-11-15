// pear-desktop's Do Not Track menu: a radio per profile and a checkbox per local
// blocklist file. The rewrite's app-menu items are flat, so this is one native
// popup, opened from a menu item and the settings card's action button.

import { join } from "node:path";
import type { HostContextOf } from "@pear/sdk";
import { Menu, type MenuItemConstructorOptions, shell } from "electron";
import { listLocalLists } from "./lists.ts";
import { schema } from "./schema.ts";

type Context = HostContextOf<typeof schema>;

/** The folder local blocklist files are read from. */
export const blocklistsDir = (ctx: Context) => join(ctx.app.getPath("userData"), "blocklists");

/** Opens the whole menu: profiles, custom lists and the local files. */
export function showMenu(ctx: Context) {
  void popup(ctx, true).catch((error: unknown) => ctx.log.warn("could not show the Do Not Track menu", error));
}

/** Opens only the custom lists and local files, for the settings card's button. */
export function showLocalLists(ctx: Context) {
  void popup(ctx, false).catch((error: unknown) => ctx.log.warn("could not show the local blocklists", error));
}

async function popup(ctx: Context, profiles: boolean) {
  if (ctx.window.isDestroyed()) return;
  const names = await listLocalLists(blocklistsDir(ctx));
  const { customEnabled, disabledLocalBlockLists } = ctx.config;
  const items: MenuItemConstructorOptions[] = [];
  if (profiles) {
    items.push(
      ...schema.blocker.options.map((profile): MenuItemConstructorOptions => ({
        label: profile.label,
        type: "radio",
        checked: ctx.config.blocker === profile.value,
        click: () => ctx.setConfig({ blocker: profile.value }),
      })),
      { type: "separator" },
    );
  }
  items.push(
    {
      label: ctx.t("plugins.do-not-track.menu.custom-enabled", "Use custom lists and rules"),
      type: "checkbox",
      checked: customEnabled,
      click: (item) => ctx.setConfig({ customEnabled: item.checked }),
    },
    // Like pear-desktop's Custom submenu: the files only apply in custom mode.
    ...names.map((name): MenuItemConstructorOptions => ({
      label: name,
      type: "checkbox",
      enabled: customEnabled,
      checked: !disabledLocalBlockLists.includes(name),
      click: () => toggleFile(ctx, name),
    })),
    ...(names.length === 0
      ? [
          {
            label: ctx.t("plugins.do-not-track.menu.no-files", "No files in the blocklists folder yet"),
            enabled: false,
          },
        ]
      : []),
    { type: "separator" },
    {
      label: ctx.t("plugins.do-not-track.menu.open-folder", "Open the blocklists folder"),
      click: () => void shell.openPath(blocklistsDir(ctx)),
    },
  );
  // Opened from the tray while the window is hidden, the popup has to stand alone.
  Menu.buildFromTemplate(items).popup(ctx.window.isVisible() ? { window: ctx.window } : {});
}

function toggleFile(ctx: Context, name: string) {
  const disabled = new Set(ctx.config.disabledLocalBlockLists);
  if (disabled.has(name)) disabled.delete(name);
  else disabled.add(name);
  ctx.setConfig({ disabledLocalBlockLists: [...disabled] });
}
