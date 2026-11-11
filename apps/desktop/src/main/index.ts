// The main process: builds the app's parts and wires them together.

import { app, session } from "electron";
import hostPlugins from "virtual:pear/host-plugins";
import { ApiServer } from "./api/index.ts";
import { applyConfigPatch } from "./apply-config.ts";
import { APP_ID, registerStartMenuShortcut, relaunchOptions, setAppIdentity } from "./app-identity.ts";
import { commit, updatesSupported } from "./app-info.ts";
import { hideOnClose, onActivate } from "./close.ts";
import { Settings } from "./config.ts";
import { seedConsent } from "./consent.ts";
import { CoreOptions } from "./core-options.ts";
import { loadFlagMetadata } from "./flag-metadata.ts";
import { loadI18n, resolveLanguage } from "./i18n.ts";
import { setupIpc } from "./ipc.ts";
import { languageFromYtm, setYtmLanguage } from "./language-sync.ts";
import { MainWindow } from "./main-window.ts";
import { type MenuEnvironment, setApplicationMenu } from "./menu.ts";
import { MenuItems } from "./menu-items.ts";
import { setupNet } from "./net.ts";
import { PageRequests } from "./page-requests.ts";
import { hardenSession } from "./permissions.ts";
import { PlayerMirror } from "./player.ts";
import { PluginHost } from "./plugins.ts";
import { findProtocolLink, ProtocolLinks, registerProtocol } from "./protocol.ts";
import { watchPreloadBundle } from "./dev-reload.ts";
import {
  openSettingsWindow,
  RestartSessions,
  SETTINGS_FLAG,
  serveSettings,
  setSettingsTranslate,
  settingsWindowContents,
} from "./settings-window.ts";
import { loadSmtc, startSmtc } from "./smtc.ts";
import { applyProxy, beforeReady, clearStaleCodeCaches, PROXY_PLUGIN, scheduleLaterTasks } from "./startup-tasks.ts";
import { checkForUpdates, UpdateManager } from "./updates.ts";
import { WebRequestRouter } from "./web-request.ts";
import { focusWindow } from "./windows.ts";

setAppIdentity();
if (!app.requestSingleInstanceLock()) app.quit();
else void main();

async function main() {
  const settings = new Settings(app.getPath("userData"), hostPlugins, app.getVersion());
  const plugins = new PluginHost(hostPlugins, settings, process.platform);
  // The tray's click pair and the core startup switch became single settings;
  // carry them over once, before the window's start-hidden decision. This also
  // runs while the tray plugin is disabled.
  const trayState = settings.plugin("tray");
  const trayPlugin = hostPlugins.find((plugin) => plugin.id === "tray");
  if (trayState && trayPlugin) {
    const patch: Record<string, unknown> = {};
    if (!trayState.config.startupMigrated) {
      patch.showAtStartup = settings.core("window").appVisible;
      patch.startupMigrated = true;
    }
    if (!trayState.config.clickActionMigrated) {
      patch.clickAction = trayState.config.clickPlayPause ? "play-pause" : "toggle";
      patch.clickActionMigrated = true;
    }
    if (Object.keys(patch).length > 0) settings.setPlugin(trayPlugin, { config: patch });
  }
  // The optional SMTC addon has to be resolved before the Chromium feature
  // switches are applied: when it is missing or fails to build, Chromium's own
  // media session must stay enabled as the fallback (see startup-tasks).
  const smtc = process.platform === "win32" && settings.core("window").forceSmtc ? await loadSmtc() : null;
  beforeReady(app, settings, plugins, smtc !== null);

  const mainWindow = new MainWindow(settings, plugins);
  const { send, openSettings } = mainWindow;
  const restart = () => {
    app.relaunch(relaunchOptions());
    app.quit();
  };
  // Replaced once the menu exists; importing a theme adds it to the menu.
  let refreshMenu = () => {};
  let updates: UpdateManager | undefined;
  const core = new CoreOptions(settings, plugins.t, mainWindow, () => refreshMenu(), {
    updates: { channelChanged: () => updates?.channelChanged() },
    refreshMenu: () => refreshMenu(),
    // The tray plugin draws its own artwork; a no-op while it is disabled.
    refreshTrayIcons: () => void plugins.invoke("tray", "refreshIcons", []).catch(() => {}),
    restart,
  });
  const player = new PlayerMirror((action) => send({ type: "player-control", action }));
  // pear-desktop's `url` key held the playing track; the startup toggle reopens it.
  player.on("trackChange", (track) => {
    if (!track) return;
    const url = new URL(track.url);
    // Keep the list, so YTM restores the queue the track was played from.
    if (track.playlistId) url.searchParams.set("list", track.playlistId);
    settings.lastPlayback = url.toString();
  });
  const requests = new PageRequests(send);
  const menuItems = new MenuItems();
  // pear-desktop's app protocol: links control playback; plugins hear about them too.
  const links = new ProtocolLinks(
    (action) => player.control(action),
    (task) => {
      const window = mainWindow.window;
      if (task.type === "page") {
        requests.request("core", task.event, task.payload).catch((error) => {
          // The state requests have no reply channel in the protocol; their answer is unused.
          if (!task.ignoreResult) console.warn("[pear] protocol link:", error);
        });
      } else if (task.type === "fullscreen") {
        window?.setFullScreen(task.fullscreen);
        requests.request("core", "fullscreen:set", task.fullscreen).catch((error) => console.warn("[pear] protocol link:", error));
      } else if (window) {
        // As pear-desktop: YTM's own shortcut for its search box.
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: "/" });
        window.webContents.sendInputEvent({ type: "char", keyCode: "/" });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "/" });
      }
    },
  );
  let api: ApiServer | undefined;
  let stopSmtc: (() => void) | undefined;
  let quitting = false;

  links.handleOpenUrl(app);
  app.on("second-instance", (_, argv) => {
    const link = findProtocolLink(argv);
    if (link) links.run(link);
    else if (argv.includes(SETTINGS_FLAG)) openSettingsWindow(settings.core("appearance").useYtmIcons);
    else void plugins.invoke("tray", "showWindow", []).catch(() => mainWindow.focus());
  });

  app.whenReady().then(async () => {
    console.info(`[pear] startup: app ready after ${Math.round(performance.now())}ms`);
    registerStartMenuShortcut();
    // Before any page loads: YTM and the settings window get only what they need.
    hardenSession(session.defaultSession);
    // Not awaited: a few file stats must not hold the window back.
    void clearStaleCodeCaches(app);
    const language = resolveLanguage(settings.core("general").language, app.getLocale());
    plugins.setI18n(await loadI18n(language));
    // The settings window's own error page (shown when pear://settings fails to load).
    setSettingsTranslate(plugins.t);
    const activeLanguage = plugins.i18n?.language ?? language;
    const languageSync = {
      fromYtm: async () => (await languageFromYtm(session.defaultSession)) ?? null,
      toYtm: () => setYtmLanguage(session.defaultSession, mainWindow.window, activeLanguage),
    };
    const router = new WebRequestRouter(session.defaultSession);
    const electronUserAgent = mainWindow.useYtmUserAgent(settings.core("advanced").overrideUserAgent);
    setupNet(router.scoped("core"), { electronUserAgent });
    serveSettings();
    // Started here, not when the Flags section opens: the download takes a while.
    void loadFlagMetadata();
    // The settings surfaces' restart-pending changes, batched until the last one closes.
    const restarts = new RestartSessions({
      t: plugins.t,
      window: () => mainWindow.window,
      restart,
    });
    setupIpc({
      plugins,
      player,
      requests,
      settingsPath: settings.path,
      onRuntimeBootstrap: (sender) => mainWindow.runtimeBootstrapped(sender),
      windowVisible: () => mainWindow.visible,
      window: () => mainWindow.window,
      openSettingsWindow: () => openSettingsWindow(settings.core("appearance").useYtmIcons),
      restarts,
      themes: core.themes,
      language: languageSync,
      apiPageEvent: (name, payload) => api?.pageEvent?.(name, payload),
      checkUpdates: () => checkUpdatesNow(),
      core: {
        states: () => ({ ...core.states(), apiServer: api?.state() ?? { config: settings.core("apiServer") } }),
        async setConfig(section, patch) {
          if (section !== "apiServer") return core.set(section, patch);
          settings.setCore(section, patch);
          await api?.apply();
          return true;
        },
      },
      restartOnConfigChanges: () => settings.core("advanced").restartOnConfigChanges,
      restart,
    });
    core.start();
    const checkUpdatesNow = () => {
      void checkForUpdates({
        currentVersion: app.getVersion(),
        channel: settings.core("general").updateChannel,
        window: () => mainWindow.window,
        t: plugins.t,
        disable: () => void core.set("general", { autoUpdates: false }),
      });
    };
    const menu: MenuEnvironment = {
      platform: process.platform,
      t: plugins.t,
      window: () => mainWindow.window,
      openSettings,
      themes: core.themes,
      pluginItems: () => menuItems.items,
      // The API server's own menu (pear-desktop's plugin submenu).
      apiServer: () => ({
        config: settings.core("apiServer"),
        set: (patch) => {
          settings.setCore("apiServer", patch);
          void api?.apply();
        },
      }),
      // pear-desktop's Plugins menu: the same stored state the settings cards toggle.
      pluginCatalog: () =>
        plugins.plugins.map((plugin) => ({
          id: plugin.id,
          name: plugins.t(`plugins.${plugin.id}.name`, plugin.name),
          enabled: settings.plugin(plugin.id)?.enabled === true,
        })),
      setPluginEnabled: (id, enabled) => {
        void plugins
          .setEnabled(id, enabled)
          .then(() => {
            refreshMenu();
            // pear-desktop's Plugins menu went through setMenuOptions: it restarts with the option on too.
            if (settings.core("advanced").restartOnConfigChanges) restart();
          })
          .catch((error) => console.warn("[pear] couldn't change a plugin:", error));
      },
      // The Options menu's quick toggles write through the settings path.
      coreOption: (section, key) => (settings.core(section) as Record<string, unknown>)[key],
      setCoreOption: (section, patch) => {
        if (section !== "apiServer") void core.set(section, patch);
      },
      restartOnConfigChanges: () => settings.core("advanced").restartOnConfigChanges,
      // Turning it on restarts on the spot, as master's setMenuOption did.
      setRestartOnConfigChanges: (value) => void core.set("advanced", { restartOnConfigChanges: value }),
      alwaysOnTop: () => settings.core("window").alwaysOnTop,
      setAlwaysOnTop: (alwaysOnTop) => void core.set("window", { alwaysOnTop }),
      languageFromYtm: languageSync.fromYtm,
      languageToYtm: languageSync.toYtm,
      setLanguage: (value) => void core.set("general", { language: value }),
      shareLinkOptions: () => ({
        stripMusic: settings.core("general").stripMusicFromSharedLinks,
        stripSI: settings.core("general").stripSIFromSharedLinks,
      }),
      updatesSupported: () => updatesSupported(),
      checkForUpdates: checkUpdatesNow,
      autoUpdates: () => settings.core("general").autoUpdates,
      setAutoUpdates: (value) => void core.set("general", { autoUpdates: value }),
      updateChannel: () => settings.core("general").updateChannel,
      setUpdateChannel: (value) => {
        // A declined downgrade leaves the setting alone; rebuild so the radio follows the store.
        void core.set("general", { updateChannel: value }).then(() => refreshMenu());
      },
      settingsPath: settings.path,
      singleInstanceLock: () => app.hasSingleInstanceLock(),
      setSingleInstanceLock: (locked) => {
        if (!locked && app.hasSingleInstanceLock()) app.releaseSingleInstanceLock();
        else if (locked && !app.hasSingleInstanceLock()) app.requestSingleInstanceLock();
      },
      restart,
    };
    setApplicationMenu(menu);
    refreshMenu = () => setApplicationMenu(menu);
    menuItems.onChange(() => setApplicationMenu(menu));
    await seedConsent(session.defaultSession);
    await applyProxy(settings);

    const window = mainWindow.create();
    // Dev only: page-side changes produce a new preload bundle; load it in the running windows.
    watchPreloadBundle(() => {
      const main = mainWindow.window;
      if (main && !main.isDestroyed()) main.webContents.reloadIgnoringCache();
      const standalone = settingsWindowContents();
      if (standalone && !standalone.isDestroyed()) standalone.reloadIgnoringCache();
    });
    if (process.platform === "darwin") hideOnClose(app, window);
    // The native transport controls own the media keys on Windows; the module is optional.
    if (smtc) {
      try {
        const stop = startSmtc(smtc, player, { appMediaId: APP_ID });
        if (quitting) stop();
        else stopSmtc = stop;
      } catch (error) {
        console.warn("[pear] SMTC unavailable:", error);
      }
    }
    updates = new UpdateManager({
      currentVersion: app.getVersion(),
      commit,
      packaged: app.isPackaged,
      channel: () => settings.core("general").updateChannel,
      enabled: () => settings.core("general").autoUpdates,
      window: () => mainWindow.window,
      t: plugins.t,
      disable: () => void core.set("general", { autoUpdates: false }),
    });
    updates.start();
    api = new ApiServer({
      settings,
      plugins,
      player,
      requests,
      window,
      publish: (state) => send({ type: "core-state", section: "apiServer", state }),
      // A config patch from the API applies like the same edit in the settings
      // dialog: core sections live, merged plugins started, stopped or restarted.
      applyConfig: (patch) =>
        applyConfigPatch(
          {
            settings,
            plugins,
            pluginIds: hostPlugins.map((plugin) => plugin.id),
            applyCore: (section, previous, next) => {
              core.apply(section);
              send({ type: "core-state", section, state: core.state(section) });
              const before = previous as Partial<Record<string, unknown>>;
              const after = next as Partial<Record<string, unknown>>;
              if (section !== "general" || (before.updateChannel === after.updateChannel && before.autoUpdates === after.autoUpdates)) {
                return;
              }
              // The update manager rereads the channel itself; the menu mirrors the new values.
              updates?.channelChanged();
              refreshMenu();
            },
            applyApiServer: async () => void (await api?.apply()),
          },
          patch,
        ),
    });
    plugins.attach({
      app,
      window,
      session: session.defaultSession,
      router,
      player,
      requests,
      send,
      openSettings,
      focusWindow: () => focusWindow(window),
      menuItems,
      broadcast: (plugin, event, data) => api?.broadcastPluginEvent(plugin, event, data),
      onProtocol: (listener) => links.listen(listener),
      // The Proxy plugin resets to the system proxy when turned off; the core option takes over again.
      onDisabled: (id) => {
        if (id === PROXY_PLUGIN) void applyProxy(settings);
      },
    });
    registerProtocol(app);
    core.apply("window");
    // Picks up the saved icon option (the Dock icon on macOS, the window icon).
    core.apply("appearance");
    void api.apply();
    if (process.argv.includes(SETTINGS_FLAG)) openSettingsWindow(settings.core("appearance").useYtmIcons);
    scheduleLaterTasks({ settings });
  });

  app.on("before-quit", () => {
    quitting = true;
    stopSmtc?.();
    stopSmtc = undefined;
    updates?.stop();
    core.stop();
    api?.stop();
    plugins.stopAll();
    settings.flush();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // `started` is false until whenReady builds the first window: creating one
  // here during startup would race it (and duplicate its per-window setup).
  app.on("activate", () => {
    if (!mainWindow.started) return;
    onActivate(mainWindow.window, () => void mainWindow.create());
  });
}
