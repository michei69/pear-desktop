// Entry of the standalone settings window (pear://settings): the settings
// dialog full-window, over the bridge the preload exposes. No page runtime.

import { shadowHost } from "@pear/sdk/dom";
import { translator, type Translate } from "@pear/sdk/i18n";
import type { Bridge } from "@pear/sdk/protocol";
import { render } from "preact";
import { bridgeModel } from "./model.ts";
import { Settings } from "./settings.tsx";
import { UI_STRINGS } from "./strings.ts";
import { overlayStyles } from "./styles.ts";

const FAILURE_ID = "pear-settings-boot-failure";

const bridge = (window as Window & { __pear?: Bridge }).__pear;

/** The dialog's boot couldn't run: show why and offer a reload, instead of a blank window. */
function showBootFailure(error: unknown, t: Translate) {
  if (document.getElementById(FAILURE_ID)) return;
  const text = (key: keyof typeof UI_STRINGS, vars?: Record<string, unknown>) => t(key, UI_STRINGS[key], vars);
  const card = document.createElement("div");
  card.id = FAILURE_ID;
  card.setAttribute("role", "alert");
  card.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:12px",
    "box-sizing:border-box",
    "padding:32px",
    "text-align:center",
    "background:#1d1b20",
    "color:#e6e0e9",
    "font:16px/1.5 Roboto, Arial, sans-serif",
  ].join(";");
  const title = document.createElement("h1");
  title.textContent = text("settings-ui.boot-failed.title");
  title.style.cssText = "margin:0;font-size:22px;font-weight:500";
  const message = document.createElement("p");
  message.textContent = text("settings-ui.boot-failed.message", { error: error instanceof Error ? error.message : String(error) });
  message.style.cssText = "margin:0;max-width:40em;color:#cac4d0";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = text("settings-ui.boot-failed.reload");
  reload.style.cssText =
    "border:0;border-radius:20px;padding:10px 24px;background:#6750a4;color:#fff;font:inherit;font-weight:500;cursor:pointer";
  reload.addEventListener("click", () => window.location.reload());
  card.append(title, message, reload);
  (document.body ?? document.documentElement).append(card);
}

function boot() {
  if (!bridge) throw new Error("the preload did not expose the bridge");
  const { host, root } = shadowHost("pear-settings", overlayStyles);
  document.body.append(host);
  render(<Settings model={bridgeModel(bridge)} onClose={() => window.close()} standalone />, root);
}

const t = translator(bridge?.bootstrap.strings ?? {});
// Before the first paint, an error means the dialog will never render: replace it with the card.
let booted = false;
const report = (error: unknown) => {
  if (booted) console.error("[pear] settings window:", error);
  else showBootFailure(error, t);
};
window.addEventListener("error", (event) => report(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => report(event.reason));
try {
  boot();
  booted = true;
} catch (error) {
  report(error);
}
