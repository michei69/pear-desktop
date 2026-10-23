import { join } from "node:path";
import type { FiltersEngine } from "@ghostery/adblocker";
import { type ConfigOf, definePlugin } from "@pear/sdk";
import { dialog, net } from "electron";
import { applyCosmetics } from "./cosmetics.ts";
import { type CosmeticsRequest, cosmetics, enableBlocking, loadEngine, type LoadedEngine } from "./engine.ts";
import { cachedSources, chooseLists, fetchSources, loadLocalLists, type FilterSource } from "./lists.ts";
import { installPruner } from "./prune.ts";
import { dismissPromos, hidePromoCss } from "./promo.ts";
import { LITE, schema } from "./schema.ts";
import { skipAds } from "./skip-ads.ts";

type Config = ConfigOf<typeof schema>;

const LOCAL_LISTS_DIR = "blocklists";
const stats = { active: false, blocked: 0, lists: 0 };

/** Whether a profile filters requests (Lite only prunes the player unless custom lists are on). */
const needsBlocklists = (config: Config) => config.blocker !== LITE || config.customEnabled;

/** What the page was built with: a change here needs a reload to fully apply. */
function profileKey(config: Config) {
  return JSON.stringify({
    blocker: config.blocker,
    customEnabled: config.customEnabled,
    ...(config.customEnabled
      ? {
          lists: config.additionalBlockLists,
          rules: config.additionalBlockListRules,
          disabledFiles: [...config.disabledLocalBlockLists].sort(),
          disableDefaultLists: config.disableDefaultLists,
        }
      : {}),
  });
}

export default definePlugin({
  id: "do-not-track",
  name: "Do Not Track",
  description: "Blocks tracking: strips ad and tracking data from the player, with lite, balanced or strict blocklists.",
  config: schema,
  host: {
    async start(ctx) {
      let stopped = false;
      let generation = 0;
      let engine: FiltersEngine | undefined;
      let blocking = false;
      /** Profile changes apply one after another, so engine loads never race. */
      let queue = Promise.resolve();
      let currentProfile = profileKey(ctx.config);
      let currentCache = ctx.config.cache;
      let prompting = false;
      engines.set(ctx, () => engine);
      ctx.onCleanup(() => engines.delete(ctx));

      const fetch = (url: string) => net.fetch(url);
      const cacheDir = (config: Config) => (config.cache ? join(ctx.app.getPath("userData"), "tb_cache") : undefined);
      const localDir = join(ctx.app.getPath("userData"), LOCAL_LISTS_DIR);

      /** The curated list URLs, when custom lists want them. */
      const curatedFor = async (config: Config): Promise<readonly string[]> => {
        if (!config.customEnabled || config.disableDefaultLists) return [];
        const dir = cacheDir(config);
        if (dir) return cachedSources(dir);
        return (await fetchSources(fetch, undefined)) ?? (await cachedSources(undefined));
      };

      const sourcesFor = async (config: Config, curated: readonly string[]): Promise<FilterSource[]> => {
        const local = config.customEnabled ? await loadLocalLists(localDir, config.disabledLocalBlockLists) : [];
        return chooseLists(curated, local, {
          profile: config.blocker,
          customEnabled: config.customEnabled,
          disableDefaultLists: config.disableDefaultLists,
          additionalBlockLists: config.additionalBlockLists,
          additionalBlockListRules: config.additionalBlockListRules,
        });
      };

      /** Loads the config's lists and starts using them; an engine load failure keeps the old one. */
      const apply = async (config: Config, run: number) => {
        const curated = await curatedFor(config);
        const next = await sourcesFor(config, curated);
        if (stopped || generation !== run) return;
        if (next.length === 0) {
          engine = undefined;
          Object.assign(stats, { active: false, lists: 0 });
          return;
        }

        const started = performance.now();
        const loaded = await loadEngine({ lists: next, cacheDir: cacheDir(config) });
        if (stopped || generation !== run) return;
        engine = loaded.engine;
        if (!blocking) {
          // One registration for the plugin's lifetime: profile switches swap the
          // engine it reads, instead of leaving old listeners behind.
          blocking = true;
          enableBlocking(
            ctx.webRequest,
            () => engine,
            () => void stats.blocked++,
          );
        }
        Object.assign(stats, { active: true, lists: next.length });
        ctx.log.info(`${next.length} blocklist(s) ready in ${Math.round(performance.now() - started)}ms`);
        refresh(config, loaded, next, run).catch((error: unknown) => ctx.log.warn("could not refresh the blocklists", error));
      };

      /** Picks up a fresher cached engine and newly published curated lists. */
      async function refresh(config: Config, loaded: LoadedEngine, loadedLists: readonly FilterSource[], run: number) {
        const fresh = await loaded.refreshed;
        if (stopped || generation !== run) return;
        if (fresh) engine = fresh;
        if (!config.customEnabled || config.disableDefaultLists) return;

        const latest = await fetchSources(fetch, cacheDir(config));
        if (!latest || stopped || generation !== run) return;
        const next = await sourcesFor(config, latest);
        const unchanged =
          next.length === loadedLists.length &&
          next.every((list, i) => list.url === loadedLists[i]!.url && list.contents === loadedLists[i]!.contents);
        if (stopped || generation !== run || unchanged) return;
        const rebuilt = await loadEngine({ lists: next, cacheDir: cacheDir(config) });
        if (stopped || generation !== run) return;
        engine = rebuilt.engine;
        stats.lists = next.length;
        ctx.log.info(`blocklists updated (${next.length})`);
      }

      /** Asks once while a reload is pending; the engine already took the change. */
      const promptReload = async () => {
        if (prompting || stopped) return;
        prompting = true;
        try {
          const { response } = await dialog.showMessageBox(ctx.window, {
            type: "info",
            title: ctx.t("plugins.do-not-track.dialog.reload.title", "Reload page"),
            message: ctx.t("plugins.do-not-track.dialog.reload.message", "Do Not Track settings have changed."),
            detail: ctx.t(
              "plugins.do-not-track.dialog.reload.detail",
              "Network rules update without restarting the app. Reload the page to fully apply changes to page filters. " +
                "Playback may be interrupted. You can reload later.",
            ),
            buttons: [
              ctx.t("plugins.do-not-track.dialog.reload.reload-now", "Reload page now"),
              ctx.t("main.dialog.need-to-restart.buttons.later", "Later"),
            ],
            defaultId: 1,
            cancelId: 1,
          });
          if (response !== 0 || stopped) return;
          // A change queued while the dialog was open is applied first.
          await queue.catch(() => undefined);
          if (!stopped && !ctx.window.isDestroyed()) ctx.window.webContents.reload();
        } catch (error) {
          ctx.log.warn("could not show the reload prompt", error);
        } finally {
          prompting = false;
        }
      };

      // Registered before the first load: a change while it runs applies after it.
      ctx.onConfigChange((config) => {
        const key = profileKey(config);
        const profileChanged = key !== currentProfile;
        const cacheChanged = config.cache !== currentCache;
        if (!profileChanged && !cacheChanged) return;
        currentProfile = key;
        currentCache = config.cache;
        const nextRun = ++generation;
        queue = queue
          .catch(() => undefined)
          .then(async () => {
            if (stopped || generation !== nextRun) return;
            if (needsBlocklists(config)) await apply(config, nextRun);
            else {
              engine = undefined;
              Object.assign(stats, { active: false, lists: 0 });
            }
            if (stopped || generation !== nextRun) return;
            // Cached engines move with the setting; page filters only with the profile.
            if (profileChanged) void promptReload();
          })
          .catch((error: unknown) => ctx.log.error("could not apply the new profile", error));
      });

      const run = ++generation;
      if (needsBlocklists(ctx.config)) {
        await apply(ctx.config, run);
      } else {
        Object.assign(stats, { active: false, lists: 0 });
      }

      return () => {
        stopped = true;
        generation++;
        engine = undefined;
        stats.active = false;
      };
    },
    commands: {
      stats() {
        return { ...stats };
      },
      /** The blocklists' cosmetic filters for the page (null until the lists are loaded). */
      cosmetics(request: CosmeticsRequest) {
        const engine = engines.get(this)?.();
        if (!engine || this.config.cosmeticFilters === "off") return null;
        return cosmetics(engine, request, this.config.cosmeticFilters === "all");
      },
    },
  },
  page: {
    // Before YTM's scripts, so the player response inlined in the page is pruned too.
    runAt: "start",
    start(ctx) {
      // The player-data layer is part of every profile: the bundled lists assume
      // it (pear-desktop's Lite blocker) and add to it.
      ctx.onCleanup(installPruner());
      if (needsBlocklists(ctx.config) && ctx.config.cosmeticFilters !== "off") applyCosmetics(ctx);

      // The Premium reminder YTM shows once ads are skipped.
      const promo = ctx.sel("promo.mealbar");
      ctx.addStyle(hidePromoCss(promo));
      const onDismiss = () => ctx.log.info("dismissed a Premium reminder");
      ctx.waitFor("popup.container").then(
        (container) => ctx.onCleanup(dismissPromos(container, promo, ctx.sel("promo.dismiss"), onDismiss)),
        () => {}, // stopped before YTM's popups existed
      );

      if (ctx.config.skipAds) skipAds(ctx);
    },
  },
});

/** Per running host part: its current engine. */
const engines = new WeakMap<object, () => FiltersEngine | undefined>();
