import type { SessionOptions } from "@pear/sdk/innertube";
import { beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../index.ts";
import { schema } from "../schema.ts";

type HostStart = NonNullable<NonNullable<typeof plugin.host>["start"]>;
type HostCtx = Parameters<HostStart>[0];
type HostCommands = NonNullable<NonNullable<typeof plugin.host>["commands"]>;

/** The host session is under test in @pear/sdk; here only the wiring to it matters. */
const session = vi.hoisted(() => ({
  created: [] as SessionOptions[],
  client: undefined as
    | {
        session: { player: { po_token?: string } };
        music: { getInfo: (videoId: string, options: { po_token?: string }) => Promise<unknown> };
      }
    | undefined,
}));

vi.mock("@pear/sdk/innertube", () => ({
  // The session is tested in @pear/sdk; this one keeps its token plumbing.
  InnertubeSession: class {
    #options: SessionOptions;
    constructor(options: SessionOptions) {
      this.#options = options;
      session.created.push(options);
    }
    async get() {
      return session.client!;
    }
    async poToken(_client: unknown, videoId: string, refresh = false) {
      try {
        const answer = await this.#options.poToken({ signedIn: false, refresh, videoId });
        return answer.poToken;
      } catch {
        return undefined;
      }
    }
  },
}));

const YTM_ORIGIN = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";

/** What a player response answers: a muxed stream the download reads. */
function trackInfo() {
  const format = { itag: 140, mime_type: "audio/mp4", decipher: vi.fn(async () => "https://stream.example/audio") };
  const info = {
    playability_status: { status: "OK" },
    chooseFormat: vi.fn(() => format),
    download: vi.fn(async () =>
      (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
    ),
  };
  return { info, format };
}

function harness() {
  const fetch = vi.fn(async () => ({ ok: true }) as Response);
  const cookies = vi.fn(async () => [
    { name: "SAPISID", value: "secret" },
    { name: "PREF", value: "hl=en" },
  ]);
  const request = vi.fn(async () => ({ poToken: "track-token", visitorData: "visitor" }));
  // Signed out: the muxed stream is the first attempt (isPremium asks the page).
  const executeJavaScript = vi.fn(async () => false);
  const ctx = {
    session: { fetch, cookies: { get: cookies } },
    request,
    window: { webContents: { executeJavaScript } },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    t: (key: string, fallback?: string) => fallback ?? key,
    addMenuItem: vi.fn(),
    openSettings: vi.fn(),
  } as unknown as HostCtx;
  return { ctx, fetch, cookies, request };
}

beforeEach(() => {
  session.created.length = 0;
  const { info } = trackInfo();
  session.client = { session: { player: {} }, music: { getInfo: vi.fn(async () => info) } };
});

describe("the crossfade's second stream", () => {
  it("fetches it with the app's session, cookies and PO token", async () => {
    const { ctx, cookies, request, fetch } = harness();
    const audio = await (plugin.host!.commands as HostCommands).audioBytes.call(ctx, "track");

    // One session per host instance, wired to the window's cookies and fetch.
    expect(session.created).toHaveLength(1);
    expect(await session.created[0]!.cookie()).toBe("SAPISID=secret; PREF=hl=en");
    expect(session.created[0]!.fetch).toBeTypeOf("function");
    await session.created[0]!.fetch(YTM_ORIGIN, { method: "POST" });
    expect(fetch).toHaveBeenCalledWith(YTM_ORIGIN, { method: "POST" });

    // The page mints the track's token, the lookup is asked with it, and the
    // library's player gets it so the stream URLs carry `pot`.
    expect(request).toHaveBeenCalledWith("poToken", { signedIn: false, refresh: false, videoId: "track" }, { timeout: 15_000 });
    expect(session.client!.music.getInfo).toHaveBeenCalledWith("track", { po_token: "track-token" });
    expect(session.client!.session.player.po_token).toBe("track-token");
    expect(audio).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/mp4" });
    expect(cookies).toHaveBeenCalledWith({ url: YTM_ORIGIN });
  });

  it("keeps one session for both commands of a host instance", async () => {
    const { ctx } = harness();
    const commands = plugin.host!.commands as HostCommands;
    await commands.audioBytes.call(ctx, "track");
    const url = await commands.audioUrl.call(ctx, "track");
    expect(url).toBe("https://stream.example/audio");
    expect(session.created).toHaveLength(1);
  });

  it("asks for the bytes without a token when the page can't mint one", async () => {
    const { ctx, request } = harness();
    request.mockRejectedValue(new Error("no BotGuard"));
    await (plugin.host!.commands as HostCommands).audioBytes.call(ctx, "track");
    expect(request).toHaveBeenCalledOnce();
    expect(session.client!.music.getInfo).toHaveBeenCalledWith("track", {});
    expect(session.client!.session.player.po_token).toBeUndefined();
  });
});

describe("the crossfade's settings", () => {
  it("defaults to pear-desktop's five-second fade-in", () => {
    expect(schema.fadeInDuration.default).toBe(5000);
    expect(schema.fadeOutDuration.default).toBe(5000);
    expect(schema.secondsBeforeEnd.default).toBe(10);
  });

  it("keeps a settings shortcut in the Options menu", () => {
    const items: { label: string; click(): void }[] = [];
    const openSettings = vi.fn();
    const t = vi.fn((key: string, fallback?: string) => fallback ?? key);
    const ctx = {
      addMenuItem: (item: { label: string; click(): void }) => items.push(item),
      openSettings,
      t,
    } as unknown as HostCtx;

    plugin.host!.start!(ctx);
    expect(t).toHaveBeenCalledWith("plugins.crossfade.menu.options", "Crossfade options");
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe("Crossfade options");
    items[0]!.click();
    expect(openSettings).toHaveBeenCalledOnce();
  });
});
