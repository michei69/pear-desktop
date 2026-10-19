# Creating a plugin

This walkthrough builds a plugin from an empty folder to a working, configurable
plugin with a renderer, a stylesheet, a backend and a menu entry. It is written
for contributors who have read [Plugins overview](./index.md) and want a concrete
file layout; the APIs it uses are the ones the app itself uses.

The example plugin is called `hello-world`. It appends a small banner to the
YouTube Music page, can be switched on and off from the settings UI or the native
Plugins menu, and answers an IPC ping from its backend half.

## Step 1: the smallest renderer plugin

Create `src/plugins/hello-world/index.ts`:

```ts
import { t } from '@/i18n';
import { createPlugin } from '@/utils';

export default createPlugin({
  name: () => t('plugins.hello-world.name'),
  description: () => t('plugins.hello-world.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  renderer: {
    banner: null as HTMLElement | null,

    start() {
      this.banner = document.createElement('div');
      this.banner.className = 'hello-world-banner';
      this.banner.textContent = t('plugins.hello-world.greeting');
      document.body.appendChild(this.banner);
    },

    stop() {
      this.banner?.remove();
      this.banner = null;
    },
  },
});
```

Add the English strings to `src/i18n/resources/en.json` under the existing
`plugins` object:

```json
"hello-world": {
  "name": "Hello World",
  "description": "Adds a banner to the page",
  "greeting": "Hello from Pear Desktop"
}
```

Because the plugin's config declares `enabled: false`, it appears in the Plugins
menu and in Settings → Plugins as a disabled plugin. Enable it, and the banner
appears; disable it, and `stop` removes it. The id is the folder name
(`hello-world`), and `plugins.hello-world` is where its config is stored.

The renderer object's function properties are bound to the object before `start`
runs, which is why `this.banner` works and survives until `stop`. See
[Lifecycle and `this`](./index.md#lifecycle-and-this).

## Step 2: add a config option and a settings field

Extend the plugin with a typed config and a settings schema. Keep the config type
in the entry file (or a `types.ts` beside it for larger plugins) and give the
default object an explicit annotation so the lifecycle hooks infer their config
type:

```ts
export type HelloWorldConfig = {
  enabled: boolean;
  showBanner: boolean;
};

const defaultConfig: HelloWorldConfig = {
  enabled: false,
  showBanner: true,
};

export default createPlugin({
  // ...
  config: defaultConfig,
  settings: [
    {
      type: 'switch',
      key: 'showBanner',
      label: () => t('plugins.hello-world.settings.show-banner'),
      description: () =>
        t('plugins.hello-world.settings.show-banner-description'),
    },
  ],
  renderer: {
    // ...
  },
});
```

Then read the value in `start` and react to later writes in `onConfigChange`:

```ts
renderer: {
  banner: null as HTMLElement | null,

  mount() {
    if (this.banner) return;
    this.banner = document.createElement('div');
    this.banner.className = 'hello-world-banner';
    this.banner.textContent = t('plugins.hello-world.greeting');
    document.body.appendChild(this.banner);
  },

  unmount() {
    this.banner?.remove();
    this.banner = null;
  },

  async start({ getConfig }) {
    if ((await getConfig()).showBanner) this.mount();
  },

  onConfigChange(newConfig) {
    if (newConfig.showBanner) this.mount();
    else this.unmount();
  },

  stop() {
    this.unmount();
  },
},
```

The settings modal writes only the changed field, through the same
`config.setPartial` path as `ctx.setConfig`, and the app then calls
`onConfigChange` where a half is loaded. The field's `key` is a dotted path, so
nested config needs no extra work; `key: 'downloadOnFinish.enabled'` reads and
writes `config.downloadOnFinish.enabled`, as
`src/plugins/downloader/index.ts` does.

### Settings schema

`settings` accepts a flat field list or an array of groups
(`{ title?: () => t(...), fields: [...] }`), not a mix of the two. A group's
`title` is optional, so untitled groups separate controls without a heading.
Fields are declared in `src/types/settings.ts` and rendered by the `settings-ui`
plugin.

Common field properties:

| Property | Type | Notes |
| -------- | ---- | ----- |
| `key` | `string` | Dotted path into the plugin config. |
| `label` | `() => string` | Required; use `t(...)`. |
| `description` | `() => string` | Optional second line. |
| `restartNeeded` | `boolean` | Shows the restart pill and flags the modal; also matches writes below the key. |
| `platform` | `Platform` | Hides the field on other platforms. |
| `visible` | `() => boolean` | Hides the field while it returns false. |
| `hideLabel` | `boolean` | Drops the label row for controls that name themselves. |

Field types:

| `type` | Stored value | Options |
| ------ | ------------ | ------- |
| `switch` | `boolean` | - |
| `select` | one option's `value` (`string` or `number`) | `options` (static array or async function), `variant: 'radio' \| 'dropdown'`, `refreshable`, `languageSync` |
| `slider` | `number` | `min`, `max`, `step`, `unit`, `scale` (displayed value is `stored / scale`) |
| `number` | `number` | `min`, `max`, `step`, `unit`, `placeholder` |
| `text` | `string` | `placeholder` |
| `multiselect` | array of option values | `options` |
| `action` | not stored | `buttons: [{ label, onClick }]`; the callback receives `getValue`, `setValue`, `pickDirectory`, `pickFile` |
| `orderable` | array of option values | `options`; up/down buttons to reorder |
| `custom` | component-defined | `component: '<pluginId>.<registryName>'`; see step 8 |

Use `select` with a function for `options` when the list is dynamic (themes,
devices, files); the field offers a refresh button and re-reads the list when the
stored value is missing. `src/plugins/api-server/index.ts` has `text`, `number`,
`select`, `switch` and `action` examples; `src/plugins/downloader/index.ts` shows
titled groups.

## Step 3: add a stylesheet

Put the CSS in `src/plugins/hello-world/style.css`:

```css
.hello-world-banner {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1000;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.75);
  color: var(--yt-spec-text-primary);
}
```

Import it with Vite's `?inline` suffix and list it in `stylesheets`:

```ts
import style from './style.css?inline';

export default createPlugin({
  // ...
  stylesheets: [style],
  renderer: {
    // ...
  },
});
```

The renderer loader adopts the CSS into `document.adoptedStyleSheets` while the
plugin is loaded and drops it on unload. CSS is global, so scope every selector
to a plugin-specific class. A plugin needs a `renderer` half for its stylesheets
to load, even an empty object.

## Step 4: add a backend half

Put it in `src/plugins/hello-world/backend.ts` so the renderer bundle does not
pull main-process code into its import graph:

```ts
import { createBackend } from '@/utils';

import type { HelloWorldConfig } from './index';

export const backend = createBackend<unknown, HelloWorldConfig>({
  start({ ipc }) {
    ipc.handle('peard:hello-world-ping', () => 'pong');
  },
  stop({ ipc }) {
    ipc.removeHandler('peard:hello-world-ping');
  },
});
```

Reference it from the entry file:

```ts
import { backend } from './backend';

export default createPlugin({
  // ...
  backend,
});
```

`ipc.handle` registers an `ipcMain.handle` listener and drops the Electron event
object, so the callback receives only the arguments the renderer sent;
`ipc.on` behaves the same for `ipcMain.on`. `ipc.send` pushes to the main window's
web contents. The backend receives `window` as well, for dialogs, native
operations and `webContents` work.

The renderer can call the handler as soon as its half has loaded, because
renderer plugins start after main has finished starting the backends:

```ts
async start({ getConfig, ipc }) {
  console.log('[hello-world]', await ipc.invoke('peard:hello-world-ping'));
  if ((await getConfig()).showBanner) this.mount();
},
```

State belongs on the backend object, as it does on the renderer: add fields to
the first type argument of `createBackend` and use `this` inside the hooks. See
`src/plugins/memory-saver/index.ts` for a backend that keeps an interval and
re-reads the config in `onConfigChange`.

## Step 5: add a preload half

The preload half runs in the preload script, before the renderer bundle is
injected. It can use Electron preload APIs directly and sees the page's DOM,
though page-world JavaScript globals are separate; its context only carries
`getConfig` and `setConfig`. Code that must patch page-world globals runs in the
page's world through `webFrame.executeJavaScript`, as
`src/plugins/prefer-song/index.ts` does:

```ts
import { webFrame } from 'electron';

import { createPreload } from '@/utils';

import type { HelloWorldConfig } from './index';

export const preload = createPreload<unknown, HelloWorldConfig>({
  async start() {
    await webFrame.executeJavaScript(
      "document.documentElement.dataset.helloWorld = 'true'; 0",
    );
  },
  async stop() {
    await webFrame.executeJavaScript(
      "delete document.documentElement.dataset.helloWorld; 0",
    );
  },
});
```

Wire it in with `preload` in the definition. The preload context has no `ipc`
member because preload code imports `ipcRenderer` from `electron` directly when it
needs it.

## Step 6: add a menu half

A plugin can add entries below its own item in the native Plugins menu. Put the
template in `src/plugins/hello-world/menu.ts`:

```ts
import { type MenuItemConstructorOptions } from 'electron';

import { t } from '@/i18n';
import { type MenuContext } from '@/types/contexts';

import { type HelloWorldConfig } from './index';

export const menu = async ({
  getConfig,
  setConfig,
}: MenuContext<HelloWorldConfig>): Promise<MenuItemConstructorOptions[]> => {
  const config = await getConfig();

  return [
    {
      label: t('plugins.hello-world.menu.show-banner'),
      type: 'checkbox',
      checked: config.showBanner,
      click(item) {
        setConfig({ showBanner: item.checked });
      },
    },
  ];
};
```

```ts
import { menu } from './menu';

export default createPlugin({
  // ...
  menu,
});
```

The function runs each time the application menu is built and only for plugins
that are enabled (or essential). Returning `[]` leaves the plugin with a plain
enable/disable entry and no submenu. `setConfig` writes the option; a checkbox
updates its own checked state, while changes that alter labels or enabled state
should be followed by `refresh()` from the `MenuContext`, which rebuilds the
menu.

## Step 7: use the player API

Add `onPlayerApiReady` to the renderer object to receive YouTube Music's player
object. It is called once after every loaded renderer plugin has started, and
again when the plugin itself is re-enabled:

```ts
import type { MusicPlayer } from '@/types/music-player';

renderer: {
  api: null as MusicPlayer | null,

  onPlayerApiReady(api) {
    this.api = api;
  },

  stop() {
    this.api = null;
  },
},
```

From there, call the player's methods (for example `api.seekBy(5)`), listen to
its events, or read its state. The full surface is documented in [Player
API](./player-api.md); `src/plugins/seek-shortcuts/index.ts` is a short real
consumer.

## Step 8: add a custom settings component

When a control needs more than the declarative field types, declare a `custom`
field whose `component` names a component in the plugin's renderer registry:

```ts
// in the entry file's settings array
{
  type: 'custom',
  key: 'presets',
  label: () => t('plugins.hello-world.menu.presets'),
  component: 'hello-world.presets',
},
```

```tsx
// src/plugins/hello-world/PresetsField.tsx
import type { CustomFieldContext } from '@/types/settings';

export const PresetsField = (props: { ctx: CustomFieldContext }) => (
  <button
    onClick={() => props.ctx.setValue('presets.classical', true)}
    type="button"
  >
    Classical
  </button>
);
```

```ts
import { PresetsField } from './PresetsField';

renderer: {
  components: {
    presets: PresetsField,
  },
  // ...
},
```

The string is `<pluginId>.<registryName>`: the settings UI splits it at the first
dot, looks up that plugin's renderer definition and then the name in its
`components` map. The component is a Solid component receiving `ctx` with
`getValue(key)` and `setValue(key, value)`; writes may go below the field's key
(`presets.classical`), and a `restartNeeded` on the field also covers those
writes. `src/plugins/equalizer/EqualizerPresets.tsx` is a real, small example.

## Step 9: test it

With `pnpm dev` running:

1. Restart the dev server so the build scans the new folder.
2. Open Settings → Plugins, enable **Hello World**, and expand its card.
3. Toggle the switch; the banner appears and disappears without a reload.
4. Open the Plugins menu; the entry is checked and the submenu toggles the same
   option.
5. Disable the plugin; the banner and the stylesheet go away.
6. Check the developer console for `[YTMusic] Plugin "hello-world" loaded` and
   the ping response.

Most automated tests are plain Node tests run by Playwright's runner; they never
open a window. Keep logic worth testing in a module that does not import Electron
or touch the DOM, then test it from `tests/` or from
`src/plugins/hello-world/tests/`. If the plugin grows a `greeting.ts` normalizer,
its test would look like this:

```ts
import { expect, test } from '@playwright/test';

import { normalizeGreeting } from '../src/plugins/hello-world/greeting';

test('trims the stored greeting', () => {
  expect(normalizeGreeting('  hi  ')).toBe('hi');
});
```

Run `pnpm test` for tests, `pnpm typecheck` for the config and context types, and
`pnpm check` before review. See [Conventions](../conventions.md#tests) for what
belongs in a unit test and what is verified by hand.

## Final checklist

- The folder is `src/plugins/<kebab-id>/` with an `index` entry, and the default
  export is a directly written `createPlugin({ ... })` call.
- The config type extends `PluginConfig`, every default value is present, and
  each user-facing option has a settings field with a `t(...)` label.
- English strings exist under `plugins.<id>.*`; labels and descriptions are
  functions, not precomputed strings.
- User-facing menu entries are translated and return Electron menu options.
- `stop` removes every listener, element, interval and stylesheet the half added,
  and state lives on the half's object.
- `restartNeeded` is set only for changes that cannot apply live, at plugin level
  for enabling and at field level for startup-only options.
- Process-specific code lives outside the entry file; the build removes the other
  halves from the definition but not their imports.
- `platform` is set for OS-specific plugins, and `addedVersion` names the release
  line that introduces a new plugin.
- `pnpm test` and `pnpm typecheck` pass.
