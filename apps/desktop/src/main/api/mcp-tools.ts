// The MCP tools: one per operation, with their own names, descriptions and
// schemas. They call the same operations the HTTP routes call; each tool only
// maps an outcome to text.

import type { Operations, Outcome } from "./operations.ts";

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** A JSON Schema object describing a tool's arguments. */
export type InputSchema = Record<string, unknown>;

export interface McpTool {
  name: string;
  description: string;
  input: InputSchema;
  readOnly?: boolean;
  run: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

const ok = (data?: unknown): McpToolResult => ({
  content: [
    {
      type: "text",
      text: data === undefined ? "Success" : typeof data === "string" ? data : JSON.stringify(data),
    },
  ],
});

const fail = (message: string): McpToolResult => ({ isError: true, content: [{ type: "text", text: message }] });

/** A tool's answer from an operation: its value, or its error text. */
function fromOutcome<T>(result: Outcome<T>, empty: string): McpToolResult {
  if (!result.ok) return fail(result.error);
  return ok(result.value === undefined ? empty : result.value);
}

const object = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

const NO_ARGS = object();

const string = { type: "string" };
const number = { type: "number" };
const boolean = { type: "boolean" };
const stringArray = { type: "array", items: { type: "string" } };
const repeatMode = { type: "string", enum: ["NONE", "ALL", "ONE"] };
const likeState = { type: "string", enum: ["LIKE", "DISLIKE", "INDIFFERENT"] };

const QUEUE_INDEX = object({ index: { type: "integer", minimum: 0 } }, ["index"]);
const MOVE_IN_QUEUE = object({ index: { type: "integer", minimum: 0 }, toIndex: { type: "integer", minimum: 0 } }, ["index", "toIndex"]);
const SEEK = object({ seconds: number }, ["seconds"]);
const SEARCH = object(
  {
    query: string,
    params: string,
    continuation: string,
    raw: { ...boolean, description: "Return the raw response instead of parsed results" },
  },
  ["query"],
);
const BROWSE = object({ browseId: string, continuation: string, raw: boolean });
const QUEUE_QUERY = object({
  raw: { ...boolean, description: "Include each item's raw renderer" },
});
const AUTOPLAY = object({
  raw: { ...boolean, description: "Include each item's raw renderer" },
  continuation: string,
});
const LYRICS = object({ videoId: string });
const TRANSLATE = object({ lang: string, videoId: string }, ["lang"]);
const ADD_TO_QUEUE = object({
  videoIds: stringArray,
  playlistIds: stringArray,
  insertPosition: { type: "string", enum: ["INSERT_AFTER_CURRENT_VIDEO", "INSERT_AT_END"] },
});
const PLAY_VIDEO = object({ videoId: string }, ["videoId"]);
const DOWNLOAD = object({ videoId: string });
const SET_LIKE = object({ state: likeState }, ["state"]);
const CONFIG = { type: "object", additionalProperties: true };
const FLAGS = { type: "object", additionalProperties: true };
const DELETE_FLAGS = object({ flags: stringArray }, ["flags"]);

type ToolDefinition = Omit<McpTool, "run"> & {
  run: (operations: Operations, args: Record<string, unknown>) => McpToolResult | Promise<McpToolResult>;
};

const TOOLS: ToolDefinition[] = [
  // Video
  {
    name: "video",
    description: "Get the current track info.",
    input: NO_ARGS,
    readOnly: true,
    async run(operations) {
      return fromOutcome(await operations.video(), "No track is playing");
    },
  },
  { name: "next_video", description: "Play the next track.", input: NO_ARGS, run: (o) => (o.nextVideo(), ok()) },
  { name: "previous_video", description: "Play the previous track.", input: NO_ARGS, run: (o) => (o.previousVideo(), ok()) },
  {
    name: "play_video",
    description: "Play this video now, replacing the queue.",
    input: PLAY_VIDEO,
    run: (o, args) => (o.playVideo(String(args.videoId)), ok()),
  },
  {
    name: "download_video",
    description: "Download a video, or the current track, with the downloader plugin.",
    input: DOWNLOAD,
    async run(o, args) {
      return fromOutcome(await o.downloadVideo(typeof args.videoId === "string" ? args.videoId : undefined), "Success");
    },
  },
  {
    name: "search",
    description: "Search YTM.",
    input: SEARCH,
    async run(o, args) {
      return fromOutcome(
        await o.search({
          query: String(args.query),
          ...(typeof args.params === "string" ? { params: args.params } : {}),
          ...(typeof args.continuation === "string" ? { continuation: args.continuation } : {}),
          raw: args.raw === true,
        }),
        "No results",
      );
    },
  },
  {
    name: "browse",
    description: "Browse a YTM page by browse id or continuation token.",
    input: BROWSE,
    readOnly: true,
    async run(o, args) {
      return fromOutcome(
        await o.browse({
          ...(typeof args.browseId === "string" ? { browseId: args.browseId } : {}),
          ...(typeof args.continuation === "string" ? { continuation: args.continuation } : {}),
          raw: args.raw === true,
        }),
        "No results",
      );
    },
  },
  {
    name: "lyrics",
    description: "Get the current track's lyrics from every provider.",
    input: LYRICS,
    readOnly: true,
    async run(o, args) {
      return fromOutcome(await o.lyrics(typeof args.videoId === "string" ? args.videoId : undefined), "No lyrics available");
    },
  },
  {
    name: "lyrics_translations",
    description: "Get the cached translations of the current track's lyrics.",
    input: LYRICS,
    readOnly: true,
    async run(o, args) {
      return fromOutcome(await o.lyricsTranslations(typeof args.videoId === "string" ? args.videoId : undefined), "No entries");
    },
  },
  {
    name: "translate_lyrics",
    description: "Translate the lyrics into a language and cache the result.",
    input: TRANSLATE,
    async run(o, args) {
      return fromOutcome(
        await o.translateLyrics(String(args.lang), typeof args.videoId === "string" ? args.videoId : undefined),
        "No lines",
      );
    },
  },

  // Playback
  {
    name: "playing",
    description: "Check whether playback is running.",
    input: NO_ARGS,
    readOnly: true,
    run: (o) => ok({ state: o.playing() }),
  },
  { name: "play", description: "Start playback.", input: NO_ARGS, run: (o) => (o.play(), ok()) },
  { name: "pause", description: "Pause playback.", input: NO_ARGS, run: (o) => (o.pause(), ok()) },
  { name: "toggle_play", description: "Toggle between play and pause.", input: NO_ARGS, run: (o) => (o.togglePlay(), ok()) },
  {
    name: "playback_speed",
    description: "Get the playback speed.",
    input: NO_ARGS,
    readOnly: true,
    async run(o) {
      return ok({ speed: await o.playbackSpeed() });
    },
  },
  {
    name: "set_playback_speed",
    description: "Set the playback speed, where 1 is normal.",
    input: object({ speed: number }, ["speed"]),
    run: (o, args) => (o.setPlaybackSpeed(Number(args.speed)), ok()),
  },
  {
    name: "playback_position",
    description: "Get the playback position in seconds, or a 0..1 fraction.",
    input: object({ percentage: boolean }),
    readOnly: true,
    async run(o, args) {
      return fromOutcome(await o.playbackPosition(args.percentage === true), "No position");
    },
  },
  { name: "seek_to", description: "Seek to a time in seconds.", input: SEEK, run: (o, args) => (o.seekTo(Number(args.seconds)), ok()) },
  {
    name: "seek_by",
    description: "Seek forward or backward by a number of seconds.",
    input: SEEK,
    run: (o, args) => (o.seekBy(Number(args.seconds)), ok()),
  },
  {
    name: "shuffle_state",
    description: "Check whether shuffle is on.",
    input: NO_ARGS,
    readOnly: true,
    run: (o) => ok({ state: o.shuffleState() }),
  },
  { name: "shuffle", description: "Shuffle the queue.", input: NO_ARGS, run: (o) => (o.shuffleQueue(), ok()) },
  {
    name: "set_shuffle",
    description: "Turn shuffle on or off.",
    input: object({ enabled: boolean }, ["enabled"]),
    run: (o, args) => (o.setShuffle(args.enabled === true), ok()),
  },
  { name: "repeat_mode", description: "Get the repeat mode.", input: NO_ARGS, readOnly: true, run: (o) => ok({ mode: o.repeatMode() }) },
  {
    name: "set_repeat",
    description: "Set the repeat mode.",
    input: object({ mode: repeatMode }, ["mode"]),
    run: (o, args) => (o.setRepeat(args.mode as "NONE" | "ALL" | "ONE"), ok()),
  },
  { name: "switch_repeat", description: "Cycle to the next repeat mode.", input: NO_ARGS, run: (o) => (o.switchRepeat(), ok()) },

  // Volume
  { name: "volume", description: "Get the volume.", input: NO_ARGS, readOnly: true, run: (o) => ok({ volume: o.volume() }) },
  {
    name: "set_volume",
    description: "Set the volume, 0-100.",
    input: object({ volume: number }, ["volume"]),
    run: (o, args) => (o.setVolume(Number(args.volume)), ok()),
  },
  {
    name: "mute_state",
    description: "Check whether the player is muted.",
    input: NO_ARGS,
    readOnly: true,
    run: (o) => ok({ muted: o.muteState() }),
  },
  {
    name: "set_mute",
    description: "Mute or unmute the player.",
    input: object({ muted: boolean }, ["muted"]),
    run: (o, args) => (o.setMute(args.muted === true), ok()),
  },
  { name: "unmute", description: "Unmute the player.", input: NO_ARGS, run: (o) => (o.setMute(false), ok()) },
  { name: "toggle_mute", description: "Toggle mute.", input: NO_ARGS, run: (o) => (o.toggleMute(), ok()) },

  // Rating
  {
    name: "like_state",
    description: "Get the like state of the current track.",
    input: NO_ARGS,
    readOnly: true,
    run: (o) => ok({ state: o.likeState() }),
  },
  {
    name: "set_like_state",
    description: "Set the like state of the current track.",
    input: SET_LIKE,
    run: (o, args) => (o.setLikeState(args.state as "LIKE" | "DISLIKE" | "INDIFFERENT"), ok()),
  },
  { name: "like", description: "Like the current track.", input: NO_ARGS, run: (o) => (o.like(), ok()) },
  { name: "dislike", description: "Dislike the current track.", input: NO_ARGS, run: (o) => (o.dislike(), ok()) },
  { name: "unlike", description: "Clear the like state of the current track.", input: NO_ARGS, run: (o) => (o.unlike(), ok()) },

  // Queue
  {
    name: "queue",
    description: "Get the queue.",
    input: QUEUE_QUERY,
    readOnly: true,
    async run(o, args) {
      return fromOutcome(await o.queue(args.raw === true), "No queue info");
    },
  },
  {
    name: "add_to_queue",
    description: "Add videos or playlists to the queue.",
    input: ADD_TO_QUEUE,
    run(o, args) {
      const videoIds = Array.isArray(args.videoIds) ? args.videoIds.map(String) : [];
      const playlistIds = Array.isArray(args.playlistIds) ? args.playlistIds.map(String) : [];
      o.addToQueue(videoIds, playlistIds, args.insertPosition === "INSERT_AT_END" ? "INSERT_AT_END" : "INSERT_AFTER_CURRENT_VIDEO");
      return ok();
    },
  },
  {
    name: "move_in_queue",
    description: "Move a queue item to another position.",
    input: MOVE_IN_QUEUE,
    run: (o, args) => (o.moveInQueue(Number(args.index), Number(args.toIndex)), ok()),
  },
  {
    name: "remove_from_queue",
    description: "Remove a queue item.",
    input: QUEUE_INDEX,
    run: (o, args) => (o.removeFromQueue(Number(args.index)), ok()),
  },
  {
    name: "set_queue_index",
    description: "Jump to a queue position.",
    input: QUEUE_INDEX,
    run: (o, args) => (o.setQueueIndex(Number(args.index)), ok()),
  },
  {
    name: "autoplay",
    description: "Get the autoplay entries.",
    input: AUTOPLAY,
    readOnly: true,
    async run(o, args) {
      return fromOutcome(
        await o.autoplay(args.raw === true, typeof args.continuation === "string" ? args.continuation : undefined),
        "No autoplay entries",
      );
    },
  },
  { name: "clear_queue", description: "Clear the queue.", input: NO_ARGS, run: (o) => (o.clearQueue(), ok()) },

  // Config
  { name: "config", description: "Get the app config.", input: NO_ARGS, readOnly: true, run: (o) => ok(o.getConfig()) },
  {
    name: "patch_config",
    description: "Deep-merge a partial config into the app config.",
    input: CONFIG,
    run: async (o, args) => {
      await o.patchConfig(args);
      return ok();
    },
  },
  {
    name: "app_meta",
    description: "Get app version, platform and hardware info.",
    input: NO_ARGS,
    readOnly: true,
    async run(o) {
      return ok(await o.appMeta());
    },
  },
  {
    name: "feature_flags",
    description: "Get the feature flags this app sets.",
    input: NO_ARGS,
    readOnly: true,
    async run(o) {
      return ok({ flags: await o.featureFlags() });
    },
  },
  {
    name: "patch_feature_flags",
    description: "Set feature flag overrides.",
    input: FLAGS,
    async run(o, args) {
      await o.patchFeatureFlags(args);
      return ok();
    },
  },
  {
    name: "delete_feature_flags",
    description: "Remove feature flag overrides.",
    input: DELETE_FLAGS,
    async run(o, args) {
      await o.deleteFeatureFlags(Array.isArray(args.flags) ? args.flags.map(String) : []);
      return ok();
    },
  },
];

/** Binds the tool list to one operations instance. */
export function createMcpTools(operations: Operations): McpTool[] {
  return TOOLS.map(({ run, ...tool }) => ({
    ...tool,
    run: (args: Record<string, unknown>) => Promise.resolve(run(operations, args)),
  }));
}
