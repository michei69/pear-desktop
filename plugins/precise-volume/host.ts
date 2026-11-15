// The host half of precise-volume: pear-desktop's global volume shortcuts and
// the app-menu quick actions. Apart from the entry file so it can be tested
// without the page's style macro.

import type { HostContextOf } from "@pear/sdk";
import { globalShortcut } from "electron";
import type { schema } from "./config.ts";

type Ctx = HostContextOf<typeof schema>;

type AcceleratorKey = "volumeUp" | "volumeDown";

export function startHost(ctx: Ctx) {
  /** What this start actually registered: a saved-volume write mustn't restart it. */
  const registered: Record<AcceleratorKey, string> = { volumeUp: "", volumeDown: "" };
  const shortcuts: readonly (readonly [AcceleratorKey, number])[] = [
    ["volumeUp", 1],
    ["volumeDown", -1],
  ];

  const failed: string[] = [];
  for (const [key, direction] of shortcuts) {
    const accelerator = ctx.config[key];
    if (!accelerator) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, () => ctx.emit("step", direction));
    } catch (error) {
      ctx.log.warn(`invalid accelerator ${accelerator}`, error);
    }
    if (!ok) {
      failed.push(accelerator);
      continue;
    }
    registered[key] = accelerator;
    ctx.onCleanup(() => globalShortcut.unregister(accelerator));
  }

  // pear-desktop's menu had the arrows checkbox and a volume-steps prompt. The
  // app menu is flat (no checked state, no prompt), so the toggle switches the
  // option and the settings card stays the place for values.
  ctx.addMenuItem({
    label: ctx.t("plugins.precise-volume.menu.arrows-shortcuts", "Arrow keys change volume"),
    click: () => ctx.setConfig({ arrowsShortcut: !ctx.config.arrowsShortcut }),
  });
  ctx.addMenuItem({
    label: ctx.t("plugins.precise-volume.menu.open", "Volume settings…"),
    click: () => ctx.openSettings(),
  });

  // A volume change saves the volume through `setConfig`; restarting the host
  // part for that would release every accelerator and grab it again (dropping
  // presses in between, and reporting a failure when another app took it
  // meanwhile). Only a changed shortcut needs the restart.
  ctx.onConfigChange((config) => {
    if (config.volumeUp === registered.volumeUp && config.volumeDown === registered.volumeDown) return;
    return "restart";
  });

  if (failed.length > 0) throw new Error(`couldn't register ${failed.join(", ")} (invalid or used by another app)`);
}
