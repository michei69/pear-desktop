// The v2 REST routes, on the same hand-rolled table as v1 so dispatch, auth,
// body checking and the OpenAPI document stay one mechanism.

import type { Operations, Outcome } from "./operations.ts";
import type { BodySchema, Method, Reply, Route, RouteRequest } from "./types.ts";

export const API_V2 = "/api/v2";

const NO_CONTENT: Reply = { status: 204 };
const ok = (body: unknown): Reply => ({ status: 200, body });

type OkHandler<T> = (value: T) => Reply;
type FailureHandler = (status: number, error: string) => Reply;

const fail: FailureHandler = (status, error) => ({ status, body: { error } });

function answer<T>(result: Outcome<T>, onOk: OkHandler<T>, onError: FailureHandler = fail): Reply {
  return result.ok ? onOk(result.value) : onError(result.status, result.error);
}

/** Reads a boolean query flag; fork clients send `true`/`false`, absent means off. */
const flag = (query: URLSearchParams, name: string) => query.get(name) === "true";

/** A route that acts on the player and answers 204. */
function action(method: Method, path: string, summary: string, run: () => void): Route {
  return {
    method,
    path,
    summary,
    handle() {
      run();
      return NO_CONTENT;
    },
  };
}

/** POST and PATCH twins for a setter: clients use either, both stay documented. */
const setters = (path: string, summary: string, body: BodySchema, run: (body: Record<string, unknown>) => void): Route[] =>
  (["POST", "PATCH"] as const).map((method) => ({
    method,
    path,
    summary,
    body,
    handle({ body: values }: RouteRequest) {
      run(values);
      return NO_CONTENT;
    },
  }));

/** A GET route that answers JSON. */
function readable(path: string, summary: string, run: (query: URLSearchParams) => Reply | Promise<Reply>): Route {
  return { method: "GET", path, summary, handle: ({ query }) => run(query) };
}

export function createV2Routes(operations: Operations): Route[] {
  const video: Route = {
    method: "GET",
    path: `${API_V2}/video`,
    summary: "Get the current video as the unified song info object",
    async handle() {
      const result = await operations.video();
      return answer(result, (value) => (value ? ok(value) : NO_CONTENT), fail);
    },
  };

  const search = (raw: boolean, query: URLSearchParams): Promise<Outcome<unknown, 502>> =>
    operations.search({
      query: query.get("query") ?? "",
      ...(query.get("params") ? { params: query.get("params")! } : {}),
      ...(query.get("continuation") ? { continuation: query.get("continuation")! } : {}),
      raw,
    });

  const browse = (raw: boolean, query: URLSearchParams): Promise<Outcome<unknown, 502>> =>
    operations.browse({
      ...(query.get("browseId") ? { browseId: query.get("browseId")! } : {}),
      ...(query.get("continuation") ? { continuation: query.get("continuation")! } : {}),
      raw,
    });

  const routes: Route[] = [
    video,
    action("POST", `${API_V2}/video/next`, "Play the next song in the queue", operations.nextVideo),
    action("POST", `${API_V2}/video/prev`, "Play the previous song in the queue", operations.previousVideo),
    {
      ...action("POST", `${API_V2}/video/previous`, "Play the previous song in the queue (alias of /video/prev)", operations.previousVideo),
      summary: "Play the previous song in the queue (alias of `/video/prev`)",
    },
    {
      method: "POST",
      path: `${API_V2}/video/play`,
      summary: "Replace the queue with the given video and play it",
      body: { videoId: "string" },
      handle({ body }: RouteRequest) {
        operations.playVideo(String(body.videoId));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: `${API_V2}/video/download`,
      summary: "Download the current song, or `videoId`, with the downloader plugin",
      body: "json",
      async handle({ body }: RouteRequest) {
        const videoId = typeof body.videoId === "string" ? body.videoId : undefined;
        return answer(await operations.downloadVideo(videoId), () => NO_CONTENT, fail);
      },
    },
    readable(`${API_V2}/video/search`, "Search YTM and return its parsed results", async (query) => {
      if (!query.get("query")) return { status: 400, body: { error: "query must be a string" } };
      return answer(await search(flag(query, "raw"), query), ok, fail);
    }),
    {
      method: "POST",
      path: `${API_V2}/video/search`,
      summary: "Search YTM and return its parsed results",
      body: { query: "string", params: "string?", continuation: "string?", raw: "boolean?" },
      async handle({ body }: RouteRequest) {
        const result = await operations.search({
          query: String(body.query),
          ...(typeof body.params === "string" ? { params: body.params } : {}),
          ...(typeof body.continuation === "string" ? { continuation: body.continuation } : {}),
          raw: body.raw === true,
        });
        return answer(result, ok, fail);
      },
    },
    readable(`${API_V2}/browse`, "Browse a YTM page by id or continuation", async (query) => {
      if (!query.get("browseId") && !query.get("continuation")) {
        return { status: 400, body: { error: "Provide browseId or continuation" } };
      }
      return answer(await browse(flag(query, "raw"), query), ok, fail);
    }),
    {
      method: "POST",
      path: `${API_V2}/browse`,
      summary: "Browse a YTM page by id or continuation",
      body: "json",
      async handle({ body }: RouteRequest) {
        if (typeof body.browseId !== "string" && typeof body.continuation !== "string") {
          return { status: 400, body: { error: "Provide browseId or continuation" } };
        }
        const result = await operations.browse({
          ...(typeof body.browseId === "string" ? { browseId: body.browseId } : {}),
          ...(typeof body.continuation === "string" ? { continuation: body.continuation } : {}),
          raw: body.raw === true,
        });
        return answer(result, ok, fail);
      },
    },
    readable(`${API_V2}/video/lyrics`, "Get lyrics from every provider that found some", async (query) => {
      const result = await operations.lyrics(query.get("videoId") ?? undefined);
      return answer(result, (value) => (value ? ok(value) : NO_CONTENT), fail);
    }),
    readable(`${API_V2}/video/lyrics/translations`, "Get the cached translations of the current song's lyrics", async (query) => {
      const result = await operations.lyricsTranslations(query.get("videoId") ?? undefined);
      return answer(result, ok, fail);
    }),
    {
      method: "POST",
      path: `${API_V2}/video/lyrics/translations`,
      summary: "Translate a song's lyrics into `lang` and cache the result",
      body: { lang: "string", videoId: "string?" },
      async handle({ body }: RouteRequest) {
        const lang = String(body.lang).trim();
        if (!lang) return { status: 400, body: { error: "lang must not be empty" } };
        const videoId = typeof body.videoId === "string" ? body.videoId : undefined;
        return answer(await operations.translateLyrics(lang, videoId), ok, fail);
      },
    },
  ];

  routes.push(
    {
      method: "GET",
      path: `${API_V2}/playback`,
      summary: "Get whether the player is currently playing",
      handle: () => ok({ state: operations.playing() }),
    },
    action("POST", `${API_V2}/playback/play`, "Play", operations.play),
    action("POST", `${API_V2}/playback/pause`, "Pause", operations.pause),
    action("POST", `${API_V2}/playback/toggle`, "Toggle play/pause", operations.togglePlay),
    {
      method: "GET",
      path: `${API_V2}/playback/speed`,
      summary: "Get the current playback speed",
      async handle() {
        return ok({ speed: await operations.playbackSpeed() });
      },
    },
    ...setters(`${API_V2}/playback/speed`, "Set the playback speed", { speed: "number" }, (body) =>
      operations.setPlaybackSpeed(Number(body.speed)),
    ),
    {
      method: "GET",
      path: `${API_V2}/playback/position`,
      summary: "Get the playback position: a 0..1 fraction with `percentage=true`, seconds otherwise",
      handle: async ({ query }) => {
        const result = await operations.playbackPosition(flag(query, "percentage"));
        return answer(result, (value) => ok({ position: value }), fail);
      },
    },
    ...setters(`${API_V2}/playback/position`, "Seek to a specific time in the current song", { seconds: "number" }, (body) =>
      operations.seekTo(Number(body.seconds)),
    ),
    {
      method: "POST",
      path: `${API_V2}/playback/position/seek-by`,
      summary: "Move the current song forward or backward by a number of seconds",
      body: { seconds: "number" },
      handle({ body }: RouteRequest) {
        operations.seekBy(Number(body.seconds));
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: `${API_V2}/playback/shuffle`,
      summary: "Get the current shuffle state",
      handle: () => ok({ state: operations.shuffleState() }),
    },
    action("POST", `${API_V2}/playback/shuffle`, "Shuffle the queue", operations.shuffleQueue),
    ...setters(`${API_V2}/playback/shuffle`, "Enable or disable shuffle", { enabled: "boolean" }, (body) =>
      operations.setShuffle(body.enabled === true),
    ),
    {
      method: "GET",
      path: `${API_V2}/playback/repeat`,
      summary: "Get the current repeat mode (NONE, ALL, ONE)",
      handle: () => ok({ mode: operations.repeatMode() }),
    },
    ...setters(`${API_V2}/playback/repeat`, "Set the repeat mode", { mode: ["NONE", "ALL", "ONE"] }, (body) =>
      operations.setRepeat(body.mode as "NONE" | "ALL" | "ONE"),
    ),
    action("POST", `${API_V2}/playback/repeat/next`, "Switch to the next repeat mode", operations.switchRepeat),

    { method: "GET", path: `${API_V2}/volume`, summary: "Get the current volume", handle: () => ok({ volume: operations.volume() }) },
    ...setters(`${API_V2}/volume`, "Set the volume of the player", { volume: "number" }, (body) =>
      operations.setVolume(Number(body.volume)),
    ),
    {
      method: "GET",
      path: `${API_V2}/volume/mute`,
      summary: "Get whether the player is muted",
      handle: () => ok({ muted: operations.muteState() }),
    },
    ...setters(`${API_V2}/volume/mute`, "Mute or unmute the player", { muted: "boolean" }, (body) =>
      operations.setMute(body.muted === true),
    ),
    action("POST", `${API_V2}/volume/unmute`, "Unmute the player", () => operations.setMute(false)),
    action("POST", `${API_V2}/volume/toggle-mute`, "Toggle the mute state of the player", operations.toggleMute),

    {
      method: "GET",
      path: `${API_V2}/rating`,
      summary: "Get the current like state",
      handle: () => ok({ state: operations.likeState() }),
    },
    {
      method: "POST",
      path: `${API_V2}/rating`,
      summary: "Set the like state of the current song",
      body: { state: ["LIKE", "DISLIKE", "INDIFFERENT"] },
      handle({ body }: RouteRequest) {
        operations.setLikeState(body.state as "LIKE" | "DISLIKE" | "INDIFFERENT");
        return NO_CONTENT;
      },
    },
    action("POST", `${API_V2}/rating/like`, "Set the current song as liked", operations.like),
    action("POST", `${API_V2}/rating/dislike`, "Set the current song as disliked", operations.dislike),
    action("POST", `${API_V2}/rating/unlike`, "Clear the like state of the current song", operations.unlike),

    {
      method: "GET",
      path: `${API_V2}/queue`,
      summary: "Get the current queue info; add `raw=true` to include each item's raw renderer",
      async handle({ query }) {
        const result = await operations.queue(flag(query, "raw"));
        return answer(result, (value) => (value ? ok(value) : NO_CONTENT), fail);
      },
    },
    {
      method: "POST",
      path: `${API_V2}/queue`,
      summary: "Add songs to the queue",
      body: "json",
      handle({ body }: RouteRequest) {
        const videoIds = Array.isArray(body.videoIds) ? body.videoIds.filter((id: unknown): id is string => typeof id === "string") : [];
        const playlistIds = Array.isArray(body.playlistIds)
          ? body.playlistIds.filter((id: unknown): id is string => typeof id === "string")
          : [];
        if (!videoIds.length && !playlistIds.length) {
          return { status: 400, body: { error: "Provide videoIds or playlistIds" } };
        }
        operations.addToQueue(
          videoIds,
          playlistIds,
          body.insertPosition === "INSERT_AT_END" ? "INSERT_AT_END" : "INSERT_AFTER_CURRENT_VIDEO",
        );
        return NO_CONTENT;
      },
    },
    {
      method: "PATCH",
      path: `${API_V2}/queue/{index}`,
      summary: "Move the song at `index` to another position in the queue",
      body: { toIndex: "integer" },
      handle({ params, body }: RouteRequest) {
        operations.moveInQueue(Number(params.index), Number(body.toIndex));
        return NO_CONTENT;
      },
    },
    {
      method: "DELETE",
      path: `${API_V2}/queue/{index}`,
      summary: "Remove the song at `index` from the queue",
      handle({ params }: RouteRequest) {
        operations.removeFromQueue(Number(params.index));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: `${API_V2}/queue/index`,
      summary: "Set the current index of the queue",
      body: { index: "integer" },
      handle({ body }: RouteRequest) {
        operations.setQueueIndex(Number(body.index));
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: `${API_V2}/queue/autoplay`,
      summary: "Get the autoplay entries; `raw=true` for raw renderers and `continuation` for the next page",
      async handle({ query }) {
        const continuation = query.get("continuation") ?? undefined;
        return answer(await operations.autoplay(flag(query, "raw"), continuation), ok, fail);
      },
    },
    action("DELETE", `${API_V2}/queue`, "Clear the queue", operations.clearQueue),
  );

  // Config: `/pear/settings` is the documented alias of `/pear/config`.
  for (const path of [`${API_V2}/pear/config`, `${API_V2}/pear/settings`]) {
    routes.push(
      {
        method: "GET",
        path,
        summary: path.endsWith("settings") ? "Alias of `GET /pear/config`" : "Get the app config as stored on disk",
        handle: () => ok(operations.getConfig()),
      },
      {
        method: "PATCH",
        path,
        summary: path.endsWith("settings") ? "Alias of `PATCH /pear/config`" : "Deep-merge a partial config into the stored one",
        body: "json",
        async handle({ body }: RouteRequest) {
          if (typeof body !== "object" || body === null || Array.isArray(body)) {
            return { status: 400, body: { error: "expected a JSON object" } };
          }
          await operations.patchConfig(body as Record<string, unknown>);
          return NO_CONTENT;
        },
      },
    );
  }

  routes.push(
    {
      method: "GET",
      path: `${API_V2}/pear`,
      summary: "Get app version, build, platform, CPU, GPU and memory info",
      async handle() {
        return ok(await operations.appMeta());
      },
    },
    {
      method: "GET",
      path: `${API_V2}/pear/feature-flags`,
      summary: "Every flag this app sets, with the value the page is running it with",
      async handle() {
        return ok({ flags: await operations.featureFlags() });
      },
    },
    {
      method: "PATCH",
      path: `${API_V2}/pear/feature-flags`,
      summary: "Apply the given flags as overrides, live where the page allows it (otherwise restart-required)",
      body: "json",
      async handle({ body }: RouteRequest) {
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return { status: 400, body: { error: "expected a JSON object" } };
        }
        await operations.patchFeatureFlags(body);
        return NO_CONTENT;
      },
    },
    {
      method: "DELETE",
      path: `${API_V2}/pear/feature-flags`,
      summary: "Drop the overrides for the given flags",
      body: { flags: "string[]" },
      async handle({ body }: RouteRequest) {
        await operations.deleteFeatureFlags(body.flags as string[]);
        return NO_CONTENT;
      },
    },
  );

  return routes;
}
