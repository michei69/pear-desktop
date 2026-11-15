import { IDLE } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import { validateBody } from "../src/main/api/body-schema.ts";
import { createRoutes } from "../src/main/api/routes.ts";
import type { Backend, BodySchema, Reply, Route, RouteRequest } from "../src/main/api/types.ts";

const PLAYER_UNAVAILABLE = { status: 502, body: { error: "The player did not answer" } };

const request = (overrides: Partial<RouteRequest> = {}): RouteRequest => ({
  params: {},
  body: {},
  query: new URLSearchParams(),
  remoteAddress: "test",
  ...overrides,
});

function backend(page: Backend["page"], control: Backend["control"] = () => undefined): Backend {
  return {
    state: () => IDLE,
    details: () => undefined,
    control,
    page,
    setFullscreen: async () => undefined,
    authorize: async () => null,
    rpcMethods: () => [],
    callRpc: async () => ({ status: 204 }),
  };
}

const routeOf = (routes: Route[], method: Route["method"], path: string) =>
  routes.find((entry) => entry.method === method && entry.path === path)!;

const queueReply = (reply: unknown) => (async <T>() => reply as T) as Backend["page"];

describe("v1 page-backed routes", () => {
  it("answers the documented 502 when the page does not answer", async () => {
    const page = async () => {
      throw new Error("[pear] core: page did not answer");
    };
    const routes = createRoutes(backend(page as Backend["page"]));
    const answered = await Promise.all([
      routeOf(routes, "GET", "/api/v1/queue").handle(request()),
      routeOf(routes, "GET", "/api/v1/queue-info").handle(request()),
      routeOf(routes, "GET", "/api/v1/fullscreen").handle(request()),
      routeOf(routes, "GET", "/api/v1/queue/next").handle(request()),
      routeOf(routes, "POST", "/api/v1/search").handle(request({ body: { query: "x" } })),
    ]);
    for (const reply of answered) expect(reply).toEqual(PLAYER_UNAVAILABLE as Reply);
  });

  it("asks the page for the projected next entry instead of the whole queue", async () => {
    const calls: string[] = [];
    const projection = { title: "B", videoId: "b", lengthText: { runs: [{ text: "3:21" }] } };
    const page = (async <T>(event: string) => {
      calls.push(event);
      return projection as T;
    }) as Backend["page"];
    const routes = createRoutes(backend(page));
    expect(await routeOf(routes, "GET", "/api/v1/queue/next").handle(request())).toEqual({ status: 200, body: projection });
    expect(calls).toEqual(["queue:next"]);
  });

  it("answers 204 for /queue/next while the page reports no next entry", async () => {
    const routes = createRoutes(backend(queueReply(null)));
    expect(await routeOf(routes, "GET", "/api/v1/queue/next").handle(request())).toEqual({ status: 204 });
  });
});

describe("POST /api/v1/loadVideo", () => {
  it("requires a video id", async () => {
    const routes = createRoutes(backend(async <T>() => undefined as T));
    const route = routeOf(routes, "POST", "/api/v1/loadVideo");
    expect(validateBody(route.body as BodySchema, {})).toBe("videoId must be a string");
    expect(validateBody(route.body as BodySchema, { videoId: 5 })).toBe("videoId must be a string");
    expect(await route.handle(request({ body: { videoId: "" } }))).toEqual({ status: 400, body: { error: "videoId must not be empty" } });
  });

  it("loads the video the body names", async () => {
    const calls: [string, unknown][] = [];
    const page = async <T>(event: string, payload?: unknown) => {
      calls.push([event, payload]);
      return undefined as T;
    };
    const routes = createRoutes(backend(page));
    expect(await routeOf(routes, "POST", "/api/v1/loadVideo").handle(request({ body: { videoId: "v1" } }))).toEqual({ status: 204 });
    expect(calls).toEqual([["video:play", "v1"]]);
  });
});
