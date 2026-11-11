import type { CoreState } from "@pear/sdk/protocol";
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../src/main/config.ts";
import { ApiServer } from "../src/main/api/index.ts";
import type { PageRequests } from "../src/main/page-requests.ts";
import { PlayerMirror } from "../src/main/player.ts";
import type { PluginHost } from "../src/main/plugins.ts";

// The server's Electron surface: only the authorization dialog and app info are reached.
vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0", getAppPath: () => "/app" },
  dialog: { showMessageBox: async () => ({ response: 1 }) },
}));

const storedConfig = () => ({
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
});

function apiServer() {
  const config = storedConfig();
  const published: CoreState[] = [];
  const settings = {
    core: () => config,
    setCore: (section: string, patch: Partial<typeof config>) => {
      expect(section).toBe("apiServer");
      Object.assign(config, patch);
    },
  } as unknown as Settings;
  const server = new ApiServer({
    settings,
    plugins: { rpcMethods: () => [], t: (_key: string, fallback?: string) => fallback ?? "" } as unknown as PluginHost,
    player: new PlayerMirror(() => undefined),
    requests: { request: async () => undefined, songDetails: async () => null } as unknown as PageRequests,
    window: {} as BrowserWindow,
    publish: (state) => published.push(state),
    applyConfig: async () => undefined,
  });
  return { server, published, config };
}

describe("the API server's token secret", () => {
  it("is generated when empty, even while the address stays the same", async () => {
    const { server, published, config } = apiServer();
    await server.apply();
    const generated = config.secret;
    expect(generated).toHaveLength(43);

    // The settings field was cleared and saved: the address is unchanged, so a
    // rebind-only generation would leave the server signing with "".
    config.secret = "";
    await server.apply();
    expect(config.secret).toHaveLength(43);
    expect(config.secret).not.toBe(generated);
    expect(published.at(-1)?.config.secret).toBe(config.secret);
  });

  it("keeps the secret the user set", async () => {
    const { server, config } = apiServer();
    config.secret = "chosen";
    await server.apply();
    expect(config.secret).toBe("chosen");
  });
});
