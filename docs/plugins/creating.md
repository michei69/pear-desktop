# Creating a plugin

This walkthrough builds `plugins/hello-world` from the scaffold to a configurable plugin with a host part, a page part, a style and a settings button. Read [Plugins overview](./index.md) first for the full field reference.

## Step 1: scaffold the plugin

```sh
pnpm exec node scripts/new-plugin.ts my-plugin
pnpm install
```

This creates `plugins/my-plugin/` with `package.json` (`@pear/plugin-my-plugin`), `tsconfig.json` and `index.ts`. Add npm dependencies after the id: `pnpm exec node scripts/new-plugin.ts my-plugin some-package@^1.0.0`.

Run `pnpm dev`, open Settings from YTM's sidebar or with `Ctrl/Cmd+,`, and the plugin is listed. It starts disabled because `enabledByDefault` is absent.

The smallest useful plugin needs only a page function:

```ts
import { definePlugin } from "@pear/sdk";

export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
  description: "Shown in the settings.",
  page(ctx) {
    ctx.toast("Hello from my plugin");
  },
});
```

`ctx.toast` is enough here; no cleanup is needed. For anything that must be undone, use the context members in the next steps.

## Step 2: add config and settings

Config fields both store values and generate the settings UI:

```ts
import { config, definePlugin } from "@pear/sdk";

export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
  description: "Shown in the settings.",
  config: {
    greeting: config.string("Hello", { label: "Greeting" }),
    size: config.number(14, { label: "Text size", min: 8, max: 32, unit: "px" }),
    showButton: config.bool(true, { label: "Show the button", group: "Interface" }),
  },
  page(ctx) {
    ctx.toast(ctx.config.greeting);
  },
});
```

Field metadata:

- `label` is required. `description` adds a second line.
- `group` puts consecutive fields under a heading.
- `restart: true` shows a restart pill. The plugin is still restarted normally; the pill only tells the user that the change fully applies after an app restart.
- `platforms` hides the field on other systems.
- Numbers take `min`, `max`, `step`, `unit` and `variant` (`slider` or `stepper`).
- Strings take `placeholder` and `secret` (a password input).
- Selects take an options array and `variant` (`chips` or `dropdown`).
- `config.multi` stores an array of option values. `config.list` stores free strings. `config.shortcut` stores an Electron accelerator.

Every text is a plain string here; the settings catalog translates it through `plugins.<id>.settings.<field>.*` keys. Run `pnpm i18n` after adding or renaming fields.

Read the current value from `ctx.config`, which is always current. Write a partial value with `ctx.setConfig({ size: 16 })`.

## Step 3: react to config changes

By default a config write restarts the running part, so `start` sees the new values. To apply changes without a restart, register a listener from `start`:

```ts
page: {
  start(ctx) {
    const toast = () => ctx.toast(`${ctx.config.greeting} (${ctx.config.size}px)`);
    ctx.onConfigChange((config) => {
      ctx.log.info("new size", config.size);
      toast();
    });
  },
},
```

Return `"restart"` from the listener when a particular change still needs a restart:

```ts
ctx.onConfigChange((config) => {
  if (config.apiURL !== oldURL) return "restart";
  // apply the rest live
});
```

The listener is not called while the plugin is disabled. A page part started with `restartRequired` does not receive live state changes after the page loads.

## Step 4: add a host part and a command

The host part runs in the main process. Put main-process work there and expose typed commands to the page:

```ts
import { config, definePlugin } from "@pear/sdk";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
  config: {
    greeting: config.string("Hello", { label: "Greeting" }),
  },
  host: {
    commands: {
      async save(text: string) {
        const path = join(this.app.getPath("downloads"), "my-plugin.txt");
        await writeFile(path, text);
        this.setStatus(`Saved to ${path}`);
        return path;
      },
    },
  },
  page: async (ctx) => {
    const saved = await ctx.host.invoke("save", ctx.config.greeting);
    ctx.log.info("saved", saved);
  },
});
```

`this` in a command is the host context, so `this.app`, `this.window`, `this.player`, `this.config` and `this.setStatus` are available. The command runs only while the plugin is enabled.

For main-process resources, use the context's cleanup-aware members:

```ts
host: {
  start(ctx) {
    const tray = new Tray(icon);
    ctx.onCleanup(() => tray.destroy());
    ctx.setInterval(() => tray.setToolTip(ctx.player.state.track?.title ?? "Nothing playing"), 5000);
    ctx.player.on("trackChange", (track) => ctx.log.info("now playing", track?.title));
    ctx.addMenuItem({ label: "Show my plugin status", click: () => ctx.focusWindow() });
  },
},
```

`ctx.onCleanup`, `ctx.setInterval`, `ctx.player.on`, `ctx.addMenuItem` and `ctx.listen` all remove themselves when the plugin stops. Use `ctx.onCleanup` for anything else you create by hand.

## Step 5: talk from the host to the page

`ctx.emit` sends an event to the page, `ctx.host.on` receives it. `ctx.request` asks for an answer from a page handler:

```ts
// host
host: {
  async start(ctx) {
    ctx.emit("greeting", ctx.config.greeting);
    const volume = await ctx.request<number>("volume");
    ctx.log.info("volume", volume);
  },
},
// page
page: {
  start(ctx) {
    ctx.host.on("greeting", (value) => ctx.toast(String(value)));
    ctx.host.handle("volume", () => ctx.player.api?.getVolume());
  },
},
```

A page handler that throws rejects the host request with the error message. Requests time out after 10 seconds unless `ctx.request(event, payload, { timeout })` says otherwise.

## Step 6: style the page

Static CSS goes in `style`, with the `css` macro:

```ts
import { css } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  // ...
  style: css`
    sel(player_bar.volume_sliders) {
      opacity: 1 !important;
    }
  `,
});
```

`sel(name)` is replaced at build time with the selector from `packages/sdk/src/selectors.ts`; an unknown name fails the build. A selector that differs between the classic and new player bar becomes `:is(a, b)`, so one rule covers both. `css` does not support `${}`; use CSS variables for values that change.

CSS that depends on config can be a function, but the macro still receives static text only, so branch on config and return one of a few static sheets:

```ts
style: (config) =>
  config.compact
    ? css`sel(player_bar) { --my-gap: 4px; }`
    : css`sel(player_bar) { --my-gap: 12px; }`,
```

For a value that changes continuously, write the rule in `ctx.addStyle` and update it from `onConfigChange`:

```ts
page(ctx) {
  const style = ctx.addStyle("");
  const render = () => style.update(`.hello-world { font-size: ${ctx.config.size}px; }`);
  render();
  ctx.onConfigChange(render);
}
```

`ctx.addStyle` also works before DOM ready and returns `{ update, remove }`. Styles are added before the theme sheets, so themes win ties.

## Step 7: add elements

Write JSX in a `.tsx` file with `/** @jsxImportSource @pear/sdk */`. The SDK runtime creates DOM elements, not Preact components:

```tsx
/** @jsxImportSource @pear/sdk */
import { definePlugin } from "@pear/sdk";
import { Icon } from "@pear/sdk/dom";

const STAR = "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
  page(ctx) {
    const button = (
      <button class="my-plugin-button" title="Star" onClick={() => ctx.toast("Starred")}>
        <Icon path={STAR} />
      </button>
    );
    ctx.mount(button, "player_bar.right_controls_buttons", "prepend");
  },
});
```

`ctx.mount` puts the element in place and puts it back when YTM re-renders the area. Without a selector, pass a placement function that finds its own spot.

`@pear/sdk/dom` also provides:

- `picker(ctx, options)`: a player-bar button with a menu of choices, like the quality and speed pickers. See `plugins/quality-changer`.
- `popupMenuItem(ctx, options)`: an entry in YTM's three-dot menus. See `plugins/picture-in-picture`.
- `shadowHost(tag, css)`: a custom element whose content YTM's CSS cannot reach.
- `anchoredPopover(ctx, { name, label })`: an empty popover in the pickers' look that you fill and show next to an element.
- `containScroll(element, signal)` and `isolateKeys(element, signal)`: keep the wheel and key presses inside an element from reaching the page.
- `sidebarEntry(ctx, { name, label, icon, onClick })`: an entry under Home and Library in both sidebar layouts. It returns `setBadge`, `elements`, `focus` and `setSelected`.
- `openBrowsePage(browseId)`: opens one of YTM's browse pages in place.
- `keepMounted(element, place)`, `observe(target, options, callback)`: the primitives behind `ctx.mount` and `ctx.observe`.

For larger UIs, render Preact into a shadow host. `plugins/synced-lyrics` and the settings overlay do this.

## Step 8: expose buttons in settings

`actions` adds buttons to the plugin's card. Each runs the host command of the same name:

```ts
actions: {
  reconnect: { label: "Reconnect", description: "Connect again now." },
},
host: {
  commands: {
    reconnect() { /* … */ },
  },
},
```

Buttons are shown only while the plugin is enabled. A throwing command shows its message under the buttons.

## Step 9: expose an API method

When another app should call the plugin, add an RPC method:

```ts
import { v } from "@pear/sdk/rpc";

host: {
  rpc: {
    segments: {
      summary: "Skip segments of a video",
      input: v.object({ videoId: v.pipe(v.string(), v.regex(/^[\w-]{11}$/)) }),
      run({ videoId }) {
        return fetchSegments(videoId);
      },
    },
  },
},
```

The method is served at `POST /api/v1/plugins/my-plugin/segments` while the API server is enabled and the plugin is running. `ctx.api.broadcast(event, data)` sends a `PLUGIN_EVENT` to WebSocket clients. See `plugins/sponsorblock`.

## Step 10: translate visible text

Names, descriptions, config fields and action labels are translated automatically from the definition strings. For any other text use `ctx.t` with the English fallback:

```ts
ctx.toast(ctx.t("plugins.my-plugin.saved", "Saved “{{title}}”", { title }));
```

Then run:

```sh
pnpm i18n
```

It appends missing keys to `src/i18n/resources/en.json`. `pnpm i18n -- --check` fails when a key is missing. Write keys out in full: the generator finds literal `t("key", "English")` calls, not computed keys.

## Plugins that cannot be undone

Some changes cannot be reversed at runtime: replacing page globals, adding constructor options to the main window, registering Chromium switches. Set `restartRequired: true` (or rely on `host.beforeReady` / `host.windowOptions`, which imply it):

```ts
export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
  restartRequired: true,
  page: {
    runAt: "start",
    start(ctx) {
      // patch something global before YTM runs
    },
  },
});
```

The settings card gets a restart pill and the restart banner appears after enabling or disabling. The page part starts only when the plugin was enabled at page load and keeps running until the next load. See `plugins/performance-improvement`.

## Helpers

`@pear/sdk/util` has small helpers plugins keep rewriting: `clamp`, `sleep`, `debounce`, `formatDuration`, `isPlaying(state)`, `isTypingTarget(event)`, `errorMessage(error)`, `remoteErrorMessage(error)`, `YTM_NAME` and `ytmUrl(path)`. `@pear/sdk/accelerator` has `fromInput`, `matchesAccelerator` and `ACCELERATOR_KEYS` for handling Electron accelerator strings in the page. `@pear/sdk/i18n` exposes `interpolate` and `translator` for UI code outside a plugin context.

## Testing

Unit tests go in `plugins/my-plugin/test/`. Add a `test` script to the package manifest (`vitest run`) so the workspace run finds it, then:

```sh
pnpm test
```

E2E tests go in `apps/desktop/e2e/` and drive the built app:

```ts
import { expect, test } from "./fixtures.ts";
import { mainWindow, playTestTrack } from "./launch.ts";
import { setConfig } from "./helpers/plugins.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";

test("my-plugin shows the greeting", async ({ launch }) => {
  const app = await launch({ plugins: { "my-plugin": { enabled: true } } });
  const page = await mainWindow(app);
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  await setConfig(page, "my-plugin", { greeting: "Hi" });
  await expect(page.locator(".my-plugin-greeting")).toHaveText("Hi");
});
```

Run them with `pnpm test:e2e my-plugin`. The suite needs a built app and network access. Never sign in to Google in a test.

## Gotchas

**Code outside `host` and `page` runs in both bundles.** A top-level statement runs in the main process and in the page, and the page has no Electron or Node:

```ts
// Breaks the page: Tray does not exist there.
const tray = new Tray(icon);

// Works: only the host runs it.
host: {
  start(ctx) {
    const tray = new Tray(icon);
    ctx.onCleanup(() => tray.destroy());
  },
},
```

Constants and pure functions at the top level are fine.

**Set things up through `ctx`, or clean them up yourself.** Plain `addEventListener`, `setInterval` or `new MutationObserver` keep running after the plugin is turned off:

```ts
// Keeps firing after the plugin is off.
video.addEventListener("ended", onEnded);
setInterval(tick, 1000);

// Removed when the plugin stops.
ctx.listen(video, "ended", onEnded);
ctx.setInterval(tick, 1000);
```

**Selectors are names, not CSS.** `ctx.$` takes a name from the registry:

```ts
ctx.$(".right-controls-buttons");           // type error
ctx.$("player_bar.right_controls_buttons"); // works
```

**Do not write YTM's class names into plugin code.** `"ytmusic-player-bar .title"` finds nothing for users with the new player bar; `ctx.$("player_bar.title")` works in both. If an element is missing, add it to `packages/sdk/src/selectors.ts` once.

**JSX event names are capitalised once.** Use `onKeydown`, `onPointerdown`, `onBeforetoggle`, not `onKeyDown`. JSX elements are typed `HTMLElement`, so cast when you need an input's value.

**`runAt: "start"` runs before the page exists.** There is no `<body>` yet. Use it only for patches that must precede YTM's scripts, and `ctx.waitFor` for elements later.

**Picker styles need both class names.** The picker's own CSS is added after yours, so a rule with one class loses:

```css
/* Loses. */
.pear-speed-popover { width: 260px; }
/* Wins. */
.pear-picker-popover.pear-speed-popover { width: 260px; }
```

**Do not write the music service's name in code.** Write "YTM" in comments and use `YTM_NAME` or `ytmUrl` from `@pear/sdk/util` when a string needs it. `scripts/escape-names.ts` rejects plain spellings in CI and the commit hook.
