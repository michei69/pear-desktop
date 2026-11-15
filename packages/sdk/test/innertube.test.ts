import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Innertube } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";
import { InnertubeSession, type SessionOptions } from "../src/innertube.ts";

// The library talks to the site; only what the session hands it is under test.
const library = vi.hoisted(() => {
  const create = vi.fn();
  return { create, platform: { shim: {} as { eval?: unknown } } };
});

vi.mock("\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js", () => ({
  Innertube: { create: library.create },
  Platform: library.platform,
  UniversalCache: class {},
}));

/** A player response as the site sent it, with the status the session remembers. */
const playerJson = (videoId: string, status = "OK") => JSON.stringify({ videoDetails: { videoId }, playabilityStatus: { status } });

/** Enough of a Response for the session's fetch wrapper. */
const response = (json = "{}") => ({ ok: true, clone: () => ({ text: async () => json }) }) as unknown as Response;

/** An InnerTube client as the library returns it: just the session the code reads. */
function fakeClient(loggedIn = false) {
  return { session: { logged_in: loggedIn, context: { client: {} as { visitorData?: string } }, player: undefined } };
}

function options(patch: Partial<SessionOptions> = {}): SessionOptions {
  return {
    fetch: vi.fn(async () => response()),
    cookie: async () => "SAPISID=account",
    poToken: async () => ({ poToken: "token", visitorData: "visitor" }),
    log: { warn: vi.fn() },
    ...patch,
  };
}

beforeEach(() => {
  library.create.mockReset();
  library.platform.shim = {};
});

describe("the host's InnerTube session", () => {
  test("signs the client with the account's cookies and reuses it while they last", async () => {
    library.create.mockResolvedValueOnce(fakeClient());
    const session = new InnertubeSession(options());

    const yt = await session.get();
    expect(yt).toBeDefined();
    expect(library.create).toHaveBeenCalledTimes(1);
    expect(library.create.mock.calls[0]![0]).toMatchObject({ cookie: "SAPISID=account", generate_session_locally: true });
    // The library deciphers stream URLs through the evaluator the session installs.
    expect(library.platform.shim.eval).toBeTypeOf("function");

    await session.get();
    expect(library.create).toHaveBeenCalledTimes(1);
  });

  test("makes a new client when the account's cookies change", async () => {
    library.create.mockResolvedValueOnce(fakeClient()).mockResolvedValueOnce(fakeClient());
    let cookie = "SAPISID=first";
    const session = new InnertubeSession(options({ cookie: async () => cookie }));

    const first = await session.get();
    cookie = "SAPISID=second";
    const second = await session.get();
    expect(second).not.toBe(first);
    expect(library.create).toHaveBeenCalledTimes(2);
    expect(library.create.mock.calls[1]![0]).toMatchObject({ cookie: "SAPISID=second" });
  });

  test("forgets a client that failed to start, so the next caller tries again", async () => {
    library.create.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(fakeClient());
    const session = new InnertubeSession(options());

    await expect(session.get()).rejects.toThrow("offline");
    await expect(session.get()).resolves.toBeDefined();
    expect(library.create).toHaveBeenCalledTimes(2);
  });

  test("runs a signed-out client's requests from the page's visitor", async () => {
    library.create.mockResolvedValueOnce(fakeClient(false));
    const poToken = vi.fn(async () => ({ poToken: "token", visitorData: "visitor-1" }));
    const session = new InnertubeSession(options({ poToken }));

    const yt = await session.get();
    expect(poToken).toHaveBeenCalledWith({ signedIn: false, refresh: false });
    expect((yt as unknown as ReturnType<typeof fakeClient>).session.context.client.visitorData).toBe("visitor-1");
  });

  test("keeps the account's own context when signed in", async () => {
    library.create.mockResolvedValueOnce(fakeClient(true));
    const session = new InnertubeSession(options());

    const yt = await session.get();
    expect((yt as unknown as ReturnType<typeof fakeClient>).session.context.client.visitorData).toBeUndefined();
  });

  test("fetches through the window's session, without the jar's cookies", async () => {
    library.create.mockResolvedValueOnce(fakeClient());
    const fetch = vi.fn(async () => response());
    const session = new InnertubeSession(options({ fetch }));

    await session.get();
    const sessionFetch = library.create.mock.calls[0]![0].fetch as SessionOptions["fetch"];
    await sessionFetch("https://music.example/v1/browse?key=1", { method: "POST" });
    expect(fetch).toHaveBeenCalledWith("https://music.example/v1/browse?key=1", {
      method: "POST",
      credentials: "omit",
    });
  });

  test("asks the page for a track's PO token, and carries on without one", async () => {
    const poToken = vi.fn(async () => ({ poToken: "track-token", visitorData: undefined }));
    const log = { warn: vi.fn() };
    const session = new InnertubeSession(options({ poToken, log }));
    const yt = fakeClient() as unknown as Innertube;

    await expect(session.poToken(yt, "track")).resolves.toBe("track-token");
    expect(poToken).toHaveBeenCalledWith({ signedIn: false, refresh: false, videoId: "track" });
    await session.poToken(yt, "track", true);
    expect(poToken).toHaveBeenLastCalledWith({ signedIn: false, refresh: true, videoId: "track" });

    poToken.mockRejectedValueOnce(new Error("no BotGuard"));
    await expect(session.poToken(yt, "track")).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  test("remembers the player responses the offline player needs, when asked", async () => {
    library.create.mockResolvedValueOnce(fakeClient());
    const fetch = vi.fn(async () => response(playerJson("abc")));
    const session = new InnertubeSession(options({ fetch, keepPlayerResponses: true }));
    await session.get();

    const sessionFetch = library.create.mock.calls[0]![0].fetch as SessionOptions["fetch"];
    await sessionFetch("https://music.example/v1/player?key=1", {});
    expect(session.playerResponse("abc")).toBe(playerJson("abc"));
  });

  test("keeps no player responses for callers that don't ask for them", async () => {
    library.create.mockResolvedValueOnce(fakeClient());
    const fetch = vi.fn(async () => response(playerJson("abc")));
    const session = new InnertubeSession(options({ fetch }));
    await session.get();

    const sessionFetch = library.create.mock.calls[0]![0].fetch as SessionOptions["fetch"];
    await sessionFetch("https://music.example/v1/player?key=1", {});
    expect(session.playerResponse("abc")).toBeUndefined();
  });
});
