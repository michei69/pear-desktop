import type { PluginMenuItem } from "@pear/sdk";
import type { ApiServerConfig, CoreSection } from "@pear/sdk/core-config";
import { dialog, type MenuItemConstructorOptions } from "electron";
import { describe, expect, test, vi } from "vitest";
import { MenuItems } from "../src/main/menu-items.ts";
import { type ApiServerMenu, menuTemplate } from "../src/main/menu.ts";

vi.mock("electron", () => ({ app: { name: "App" }, dialog: { showOpenDialog: vi.fn() } }));

interface PluginToggle {
  id: string;
  name: string;
  enabled: boolean;
}

const API_SERVER: ApiServerConfig = {
  enabled: false,
  hostname: "127.0.0.1",
  port: 26538,
  authStrategy: "AUTH_AT_FIRST",
  authorizedClients: [],
  secret: "",
  mcpEnabled: false,
  useHttps: false,
  certPath: "",
  keyPath: "",
};

describe("menuTemplate", () => {
  const env = (
    platform: NodeJS.Platform,
    options: {
      pluginItems?: readonly PluginMenuItem[];
      plugins?: readonly PluginToggle[];
      /** Core options by `section.key`, as the host exposes them. */
      core?: Record<string, unknown>;
      /** pear-desktop's restart-on-config-changes switch, as the host exposes it. */
      restartOnConfigChanges?: boolean;
      /** The API server's menu, when the host exposes it. */
      apiServer?: Partial<ApiServerConfig>;
    } = {},
  ) => {
    const core = options.core ?? {};
    const api: ApiServerMenu = {
      config: { ...API_SERVER, ...options.apiServer },
      set: vi.fn(),
    };
    return {
      platform,
      pluginItems: () => options.pluginItems ?? [],
      pluginCatalog: () => options.plugins ?? [],
      setPluginEnabled: vi.fn(),
      apiServer: () => (options.apiServer ? api : undefined),
      coreOption: (section: CoreSection, key: string) => core[`${section}.${key}`],
      setCoreOption: vi.fn(),
      restartOnConfigChanges: () => options.restartOnConfigChanges === true,
      setRestartOnConfigChanges: vi.fn(),
      t: (_key: string, fallback?: string) => fallback ?? "",
      window: () => undefined,
      openSettings: vi.fn(),
      alwaysOnTop: () => true,
      setAlwaysOnTop: vi.fn(),
      singleInstanceLock: () => true,
      setSingleInstanceLock: vi.fn(),
      themes: {
        all: [],
        selected: "",
        presets: {},
        select: vi.fn(async () => true),
        setPreset: vi.fn(),
        import: vi.fn(async () => null),
        openFolder: vi.fn(async () => ""),
      },
      settingsPath: "/config.json",
      restart: vi.fn(),
    };
  };
  const labels = (items: MenuItemConstructorOptions[]) => items.map((item) => item.label ?? item.role ?? item.type);
  const submenu = (item: MenuItemConstructorOptions | undefined) => item?.submenu as MenuItemConstructorOptions[];
  const find = (items: MenuItemConstructorOptions[], label: string) => items.find((item) => item.label === label);
  const toggle = (item: MenuItemConstructorOptions | undefined, checked: boolean) => {
    if (!item?.click) throw new Error("menu item has no click handler");
    (item.click as (item: { checked: boolean }) => void)({ checked });
  };

  test("pear-desktop's menus, with Settings instead of Plugins and Options", () => {
    const template = menuTemplate(env("linux"));
    expect(labels(template)).toEqual(["Options", "View", "Navigation", "About"]);
    const options = submenu(template[0]);
    expect(labels(options)).toEqual([
      "Settings…",
      "separator",
      "Single Instance Lock",
      "Always on top",
      "separator",
      "Theme",
      "separator",
      "Advanced options",
    ]);
    expect(find(options, "Single Instance Lock")).toMatchObject({ type: "checkbox", checked: true });
    expect(find(options, "Always on top")).toMatchObject({ type: "checkbox", checked: true });
    // The page handles Ctrl+, itself (it toggles the dialog).
    expect(find(options, "Settings…")).toMatchObject({ accelerator: "CmdOrCtrl+,", registerAccelerator: false });
    // Without the host's core accessors the quick toggles are left out, not broken.
    expect(find(options, "Resume the last song")).toBeUndefined();
    expect(find(options, "Hide the menu bar")).toBeUndefined();
  });

  test("macOS gets the app menu, with Settings in it", () => {
    const template = menuTemplate(env("darwin"));
    expect(labels(template)).toEqual(["App", "Options", "View", "Navigation", "About"]);
    expect(labels(submenu(template[0])).slice(0, 3)).toEqual(["about", "separator", "Settings…"]);
    expect(labels(submenu(template[1]))).not.toContain("Settings…");
  });

  test("menu items call back into the core", () => {
    const e = env("win32");
    const options = submenu(menuTemplate(e)[0]);
    (find(options, "Settings…")!.click as () => void)();
    expect(e.openSettings).toHaveBeenCalled();
    toggle(find(options, "Single Instance Lock"), false);
    expect(e.setSingleInstanceLock).toHaveBeenCalledWith(false);
    toggle(find(options, "Always on top"), false);
    expect(e.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  test("the Plugins menu toggles plugins, as the settings cards do", () => {
    const e = env("linux", {
      plugins: [
        { id: "tray", name: "Tray icon", enabled: true },
        { id: "ambient-mode", name: "Ambient mode", enabled: false },
      ],
    });
    const template = menuTemplate(e);
    expect(labels(template)).toEqual(["Plugins", "Options", "View", "Navigation", "About"]);
    const plugins = submenu(template[0]);
    expect(labels(plugins)).toEqual(["Ambient mode", "Tray icon"]);
    expect(plugins[0]).toMatchObject({ type: "checkbox", checked: false });
    expect(plugins[1]).toMatchObject({ type: "checkbox", checked: true });

    toggle(plugins[0], true);
    expect(e.setPluginEnabled).toHaveBeenCalledWith("ambient-mode", true);
    toggle(plugins[1], false);
    expect(e.setPluginEnabled).toHaveBeenCalledWith("tray", false);
  });

  test("the Options quick toggles write through the core settings path", () => {
    const e = env("win32", {
      core: {
        "general.resumeOnStart": true,
        "general.stripMusicFromSharedLinks": false,
        "general.stripSIFromSharedLinks": true,
        "general.startingPage": "Home",
        "appearance.removeUpgradeButton": true,
        "appearance.useYtmIcons": false,
        "window.hideMenu": true,
        "window.startAtLogin": false,
        "window.forceSmtc": false,
        "advanced.overrideUserAgent": true,
        "advanced.disableHardwareAcceleration": false,
        "advanced.autoResetAppCache": true,
      },
    });
    const options = submenu(menuTemplate(e)[0]);

    const resume = find(options, "Resume the last song");
    expect(resume).toMatchObject({ type: "checkbox", checked: true });
    toggle(resume, false);
    expect(e.setCoreOption).toHaveBeenCalledWith("general", { resumeOnStart: false });

    const shared = submenu(find(options, "Shared links"));
    expect(shared[0]).toMatchObject({ type: "checkbox", checked: false });
    expect(shared[1]).toMatchObject({ type: "checkbox", checked: true });
    toggle(shared[1], false);
    expect(e.setCoreOption).toHaveBeenCalledWith("general", { stripSIFromSharedLinks: false });

    const pages = submenu(find(options, "Starting page"));
    expect(labels(pages)[0]).toBe("Unset");
    expect(pages.find((item) => item.label === "Home")).toMatchObject({ type: "radio", checked: true });
    (pages.find((item) => item.label === "Explore")!.click as () => void)();
    expect(e.setCoreOption).toHaveBeenCalledWith("general", { startingPage: "Explore" });

    const visual = submenu(find(options, "Visual tweaks"));
    expect(find(visual, "Remove the Upgrade button")).toMatchObject({ type: "checkbox", checked: true });
    toggle(find(visual, "Use original \u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063 icons"), true);
    expect(e.setCoreOption).toHaveBeenCalledWith("appearance", { useYtmIcons: true });

    expect(find(options, "Hide the menu bar")).toMatchObject({ type: "checkbox", checked: true });
    expect(find(options, "Start at login")).toMatchObject({ type: "checkbox", checked: false });

    const advanced = submenu(find(options, "Advanced options"));
    expect(labels(advanced)).toEqual([
      "Override the user agent",
      "Disable hardware acceleration",
      "Restart on config changes",
      "Clear the app cache on startup",
      "Force the use of external SMTC",
      "separator",
      "Toggle DevTools",
      "Edit config.json",
    ]);
    toggle(find(advanced, "Override the user agent"), false);
    expect(e.setCoreOption).toHaveBeenCalledWith("advanced", { overrideUserAgent: false });
    toggle(find(advanced, "Force the use of external SMTC"), true);
    expect(e.setCoreOption).toHaveBeenCalledWith("window", { forceSmtc: true });
  });

  test("the restart-on-config-changes checkbox goes through the core", () => {
    const e = env("linux", { restartOnConfigChanges: true });
    const advanced = submenu(find(submenu(menuTemplate(e)[0]), "Advanced options"));
    const toggleItem = find(advanced, "Restart on config changes");
    expect(toggleItem).toMatchObject({ type: "checkbox", checked: true });
    toggle(toggleItem, false);
    expect(e.setRestartOnConfigChanges).toHaveBeenCalledWith(false);
  });

  test("platform-only toggles stay off the wrong platforms", () => {
    const core = { "window.hideMenu": false, "window.startAtLogin": false };
    const darwin = submenu(menuTemplate(env("darwin", { core }))[1]);
    expect(find(darwin, "Hide the menu bar")).toBeUndefined();
    expect(find(darwin, "Start at login")).toBeDefined();
    const linux = submenu(menuTemplate(env("linux", { core }))[0]);
    expect(find(linux, "Hide the menu bar")).toBeDefined();
    expect(find(linux, "Start at login")).toBeUndefined();
  });

  test("plugins' items follow Settings, and come and go", () => {
    const items = new MenuItems();
    const changes = vi.fn();
    items.onChange(changes);
    const click = vi.fn();
    const remove = items.add({ label: "Downloads", accelerator: "CmdOrCtrl+J", click });
    expect(changes).toHaveBeenCalledOnce();

    const options = submenu(menuTemplate(env("linux", { pluginItems: items.items }))[0]);
    expect(labels(options).slice(0, 3)).toEqual(["Settings…", "Downloads", "separator"]);
    expect(options[1]).toMatchObject({ accelerator: "CmdOrCtrl+J" });
    (options[1]!.click as () => void)();
    expect(click).toHaveBeenCalled();
    // On macOS, where Settings is in the app menu, they lead Options.
    expect(labels(submenu(menuTemplate(env("darwin", { pluginItems: items.items }))[1])).slice(0, 2)).toEqual(["Downloads", "separator"]);

    remove();
    expect(changes).toHaveBeenCalledTimes(2);
    expect(items.items).toEqual([]);
  });

  test("the API server submenu mirrors its config and picks the HTTPS files", async () => {
    const e = env("linux", { apiServer: { enabled: true, mcpEnabled: false, useHttps: true } });
    const api = e.apiServer()!;
    const options = submenu(menuTemplate(e)[0]);
    const server = submenu(find(options, "API Server"));
    expect(labels(server)).toEqual([
      "Enable the API server",
      "Hostname: 127.0.0.1   Port: 26538",
      "MCP server",
      "Authorization strategy",
      "HTTPS & Certificates",
      "separator",
      "API server settings…",
    ]);

    expect(find(server, "Enable the API server")).toMatchObject({ type: "checkbox", checked: true });
    toggle(find(server, "MCP server"), true);
    expect(api.set).toHaveBeenCalledWith({ mcpEnabled: true });
    expect(submenu(find(server, "Authorization strategy"))[0]).toMatchObject({ type: "radio", checked: true });

    const https = submenu(find(server, "HTTPS & Certificates"));
    toggle(find(https, "Enable HTTPS"), false);
    expect(api.set).toHaveBeenCalledWith({ useHttps: false });

    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ["/tmp/cert.pem"] } as never);
    void (find(https, "Certificate file (.crt/.pem)")!.click as () => void)();
    await vi.waitFor(() => expect(api.set).toHaveBeenCalledWith({ certPath: "/tmp/cert.pem" }));
    expect(vi.mocked(dialog.showOpenDialog)).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: "Certificate", extensions: ["crt", "pem"] }] }),
    );

    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ["/tmp/key.pem"] } as never);
    void (find(https, "Private key file (.key/.pem)")!.click as () => void)();
    await vi.waitFor(() => expect(api.set).toHaveBeenCalledWith({ keyPath: "/tmp/key.pem" }));

    // A cancelled picker writes nothing.
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] } as never);
    void (find(https, "Certificate file (.crt/.pem)")!.click as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.set).toHaveBeenCalledTimes(4);

    (find(server, "API server settings…")!.click as () => void)();
    expect(e.openSettings).toHaveBeenCalled();
  });

  test("the API server submenu is left out without the host's hook", () => {
    const options = submenu(menuTemplate(env("linux"))[0]);
    expect(find(options, "API Server")).toBeUndefined();
  });
});
