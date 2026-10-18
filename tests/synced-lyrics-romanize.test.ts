import { expect, test } from '@playwright/test';

import {
  installDom,
  setUpModuleStubs,
  startStubbing,
  stopStubbing,
  uninstallDom,
} from '../src/plugins/synced-lyrics/tests/harness';

/**
 * `utils.tsx` imports the renderer half of the plugin, which only resolves
 * inside the bundler; the UI module is stubbed for the duration of the import.
 * `lazy-var` is CommonJS and cannot be named-imported by Node's ESM loader, so
 * the test supplies the one-call equivalent it uses.
 *
 * A Playwright worker reuses its module registry across test files, so
 * `utils.tsx` is imported through a query-suffixed URL (the pattern
 * `translate-for-language.test.ts` uses): this file gets its own copy of the
 * graph wired to these stubs, whichever test file loaded first.
 */
const FRESH = '?romanize-test';
const RENDERER_STUB =
  'export const LyricsRenderer = () => null; export const setIsVisible = () => {};';
const LAZY_STUB =
  'export const lazy = (fn) => { let value; return { get: () => (value ??= Promise.resolve().then(fn)) }; };';
/** Only `Util.hasKana` is consulted outside the Japanese conversion path. */
const KUROSHIRO_STUB = 'export default { Util: { hasKana: () => false } };';

/** True while the entry import resolves its graph. */
let importing = false;

const inPrivateGraph = (parentURL: string | undefined) =>
  Boolean(parentURL?.includes(FRESH)) ||
  (importing && Boolean(parentURL?.includes('/synced-lyrics/')));

setUpModuleStubs({
  resolve(specifier, context, nextResolve) {
    if (inPrivateGraph(context.parentURL)) {
      if (specifier === 'kuroshiro') {
        return {
          url: `data:text/javascript,${encodeURIComponent(KUROSHIRO_STUB)}`,
          shortCircuit: true,
        };
      }
      if (specifier === 'lazy-var') {
        return {
          url: `data:text/javascript,${encodeURIComponent(LAZY_STUB)}`,
          shortCircuit: true,
        };
      }
    }

    const resolved = nextResolve(specifier, context);
    if (
      inPrivateGraph(context.parentURL) &&
      resolved.url.endsWith('/synced-lyrics/renderer/renderer.tsx')
    ) {
      return {
        url: `data:text/javascript,${encodeURIComponent(RENDERER_STUB)}`,
        shortCircuit: true,
      };
    }

    return resolved;
  },
  load(url, context, nextLoad) {
    if (url.includes(FRESH)) {
      return { ...nextLoad(url.split('?')[0], context), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

test('romanize memoises lines and lazy-loads pinyin', async () => {
  installDom();
  startStubbing();
  importing = true;

  try {
    // Dynamic because the specifier is runtime-composed (the `FRESH` query is
    // what gives this file a private module graph); a static import would
    // resolve to the shared, already-cached copy. The `.tsx` extension is
    // explicit because Node's extensionless resolution never tries it.
    const utilsModule = `../src/plugins/synced-lyrics/renderer/utils.tsx${FRESH}`;
    const { romanize } = await import(utilsModule);
    importing = false;

    // A repeated line must not re-run detection/transliteration.
    const first = romanize('你好世界');
    const second = romanize('你好世界');
    expect(first).toBe(second);
    expect(await first).toBe('nǐ hǎo shì jiè');

    expect(romanize('hello world')).toBe(romanize('hello world'));
    expect(await romanize('hello world')).toBe('hello world');
  } finally {
    importing = false;
    stopStubbing();
    uninstallDom();
  }
});
