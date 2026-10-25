// The main process: builds the app's parts and wires them together.

import { app, session } from "electron";
import hostPlugins from "virtual:pear/host-plugins";
import { ApiServer } from "./api/index.ts";
import { applyConfigPatch } from "./apply-config.ts";
import { APP_ID, setAppIdentity } from "./app-identity.ts";
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
import { openSettingsWindow, SETTINGS_FLAG, serveSettings } from "./settings-window.ts";
import { startSmtc } from "./smtc.ts";
import { applyProxy, beforeReady, clearStaleCodeCaches, PROXY_PLUGIN, scheduleLaterTasks } from "./startup-tasks.ts";
import { checkForUpdates, UpdateManager } from "./updates.ts";
import { WebRequestRouter } from "./web-request.ts";
import { focusWindow } from "./windows.ts";

setAppIdentity();
if (!app.requestSingleInstanceLock()) app.quit();
else main();

function main() {
  const settings = new Settings(app.getPath("userData"), hostPlugins, app.getVersion());
  const plugins = new PluginHost(hostPlugins, settings, process.platform);
  beforeReady(app, settings, plugins);

  const mainWindow = new MainWindow(settings, plugins);
  const { send, openSettings } = mainWindow;
  // Replaced once the menu exists; importing a theme adds it to the menu.
  let refreshMenu = () => {};
  let updates: UpdateManager | undefined;
  const core = new CoreOptions(settings, plugins.t, mainWindow, () => refreshMenu(), {
    updates: { channelChanged: () => updates?.channelChanged() },
    refreshMenu: () => refreshMenu(),
    // The tray plugin draws its own artwork; a no-op while it is disabled.
    refreshTrayIcons: () => void plugins.invoke("tray", "refreshIcons", []).catch(() => {}),
  });
  const player = new PlayerMirror((action) => send({ type: "player-control", action }));
  const requests = new PageRequests(send);
  const menuItems = new MenuItems();
  // pear-desktop's app protocol: links control playback; plugins hear about them too.
  const links = new ProtocolLinks((action) => player.control(action));
  let api: ApiServer | undefined;
  let stopSmtc: (() => void) | undefined;
  let quitting = false;

  links.handleOpenUrl(app);
  app.on("second-instance", (_, argv) => {
    const link = findProtocolLink(argv);
    if (link) links.run(link);
    else if (argv.includes(SETTINGS_FLAG)) openSettingsWindow(settings.core("appearance").useYtmIcons);
    else mainWindow.focus();
  });

  app.whenReady().then(async () => {
    console.info(`[pear] startup: app ready after ${Math.round(performance.now())}ms`);
    // Before any page loads: YTM and the settings window get only what they need.
    hardenSession(session.defaultSession);
    // Not awaited: a few file stats must not hold the window back.
    void clearStaleCodeCaches(app);
    const language = resolveLanguage(settings.core("general").language, app.getLocale());
    plugins.setI18n(await loadI18n(language));
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
    setupIpc({
      plugins,
      player,
      requests,
      settingsPath: settings.path,
      onRuntimeBootstrap: (sender) => mainWindow.runtimeBootstrapped(sender),
      windowVisible: () => mainWindow.visible,
      window: () => mainWindow.window,
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
        },
      },
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
      restart: () => {
        app.relaunch();
        app.quit();
      },
    };
    setApplicationMenu(menu);
    refreshMenu = () => setApplicationMenu(menu);
    menuItems.onChange(() => setApplicationMenu(menu));
    await seedConsent(session.defaultSession);
    await applyProxy(settings);

    const window = mainWindow.create();
    if (process.platform === "darwin") hideOnClose(app, window);
    // The native transport controls own the media keys on Windows; the module is optional.
    if (process.platform === "win32" && settings.core("advanced").forceSmtc) {
      startSmtc(player, { appMediaId: APP_ID }).then(
        (stop) => {
          if (quitting) stop();
          else stopSmtc = stop;
        },
        (error) => console.warn("[pear] SMTC unavailable:", error),
      );
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

  app.on("activate", () => onActivate(mainWindow.window, () => void mainWindow.create()));
}
