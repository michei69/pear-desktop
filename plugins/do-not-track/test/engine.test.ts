import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FiltersEngine, Request } from "@ghostery/adblocker";
import { net, type WebRequest } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enableBlocking, loadEngine } from "../engine.ts";

vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));

type Match = { match?: boolean; redirect?: { dataUrl: string }; rewrite?: { url?: string } };

function fakeEngine(result: Match) {
  return { match: () => ({ match: false, redirect: undefined, rewrite: undefined, ...result }) } as unknown as FiltersEngine;
}

function fakeWebRequest() {
  let listener: ((details: unknown, callback: (response: Record<string, unknown>) => void) => void) | undefined;
  const webRequest = {
    onBeforeRequest: (_filter: unknown, next: typeof listener) => {
      listener = next;
    },
    onHeadersReceived: () => {},
  } as unknown as WebRequest;
  return {
    webRequest,
    run: (details: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => listener?.({ id: 1, url: "https://page.example/", ...details }, resolve)),
  };
}

const subresource = { url: "https://cdn.example/ad.js", resourceType: "script" };
const mainFrame = { url: "https://page.example/", resourceType: "mainFrame" };

describe("enableBlocking", () => {
  test("rewrites a document a $rewrite rule targets", async () => {
    const { webRequest, run } = fakeWebRequest();
    const blocked = vi.fn();
    enableBlocking(webRequest, () => fakeEngine({ rewrite: { url: "https://replacement.example/" } }), blocked);
    expect(await run(mainFrame)).toEqual({ redirectURL: "https://replacement.example/" });
    expect(blocked).toHaveBeenCalledOnce();
  });

  test("redirects subresources after the engine's own order", async () => {
    const redirected = fakeWebRequest();
    enableBlocking(
      redirected.webRequest,
      () => fakeEngine({ redirect: { dataUrl: "data:text/javascript,1" }, rewrite: { url: "https://replacement.example/" } }),
      vi.fn(),
    );
    expect(await redirected.run(subresource)).toEqual({ redirectURL: "data:text/javascript,1" });

    const rewritten = fakeWebRequest();
    enableBlocking(rewritten.webRequest, () => fakeEngine({ rewrite: { url: "https://replacement.example/" } }), vi.fn());
    expect(await rewritten.run(subresource)).toEqual({ redirectURL: "https://replacement.example/" });
  });

  test("cancels matches, and leaves the main frame to navigate", async () => {
    const matched = fakeWebRequest();
    enableBlocking(matched.webRequest, () => fakeEngine({ match: true }), vi.fn());
    expect(await matched.run(subresource)).toEqual({ cancel: true });
    // A network rule only filters subresources; a document still loads.
    expect(await matched.run(mainFrame)).toEqual({});
  });

  test("does nothing without an engine", async () => {
    const { webRequest, run } = fakeWebRequest();
    enableBlocking(webRequest, () => undefined, vi.fn());
    expect(await run(subresource)).toEqual({});
  });
});

const matches = (engine: FiltersEngine, url: string) => engine.match(Request.fromRawDetails({ url, type: "main_frame" })).match;

describe("loadEngine cache", () => {
  let dir: string;
  let served = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pear-dnt-engine-"));
    // Ghostery also fetches its redirect/scriptlet resources; an empty set is valid.
    vi.mocked(net.fetch).mockImplementation(async (url) =>
      String(url).endsWith("/resources.json") ? new Response("{}") : new Response(served),
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  test("remote lists refresh the cached engine in the background on every launch", async () => {
    const lists = [{ url: "https://lists.example/a.txt" }];
    served = "||old.example^\n";
    expect(await (await loadEngine({ lists, cacheDir: dir })).refreshed).toBeUndefined();

    // The same URL serves new rules: the cached engine blocks at once and is rebuilt.
    served = "||new.example^\n";
    const cached = await loadEngine({ lists, cacheDir: dir });
    expect(matches(cached.engine, "https://old.example/x")).toBe(true);
    const fresh = await cached.refreshed;
    expect(fresh).toBeDefined();
    expect(matches(fresh!, "https://new.example/x")).toBe(true);
    expect(matches(fresh!, "https://old.example/x")).toBe(false);
  });

  test("bundled lists keep using the cached engine", async () => {
    const lists = [{ url: "builtin-blocklist://test", contents: "||bundled.example^\n" }];
    await loadEngine({ lists, cacheDir: dir });
    const cached = await loadEngine({ lists, cacheDir: dir });
    expect(await cached.refreshed).toBeUndefined();
    expect(matches(cached.engine, "https://bundled.example/x")).toBe(true);
  });
});
