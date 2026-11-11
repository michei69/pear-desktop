// The MCP tools: one per operation, with their own names, descriptions and
// schemas. They call the same operations the HTTP routes call; each tool only
// maps an outcome to text.

import { v } from "@pear/sdk/rpc";
import type { Operations, Outcome } from "./operations.ts";

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  /** Validates `tools/call` arguments before the tool runs; `tools/list` publishes it as JSON schema. */
  input: v.GenericSchema;
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

const optional = <S extends v.GenericSchema>(schema: S) => v.optional(schema);

const NO_ARGS = v.object({});

const string = v.string();
const number = v.number();
const boolean = v.boolean();
const stringArray = v.array(v.string());
const repeatMode = v.picklist(["NONE", "ALL", "ONE"]);
const likeState = v.picklist(["LIKE", "DISLIKE", "INDIFFERENT"]);

/** Flags arrive from the network: an unknown shape must not reach the page. */
const rawResponse = optional(v.pipe(boolean, v.description("Return the raw response instead of parsed results")));
const rawRenderer = optional(v.pipe(boolean, v.description("Include each item's raw renderer")));

const index = v.pipe(number, v.integer(), v.minValue(0));
const QUEUE_INDEX = v.object({ index });
const MOVE_IN_QUEUE = v.object({ index, toIndex: index });
const SEEK = v.object({ seconds: number });
const SEARCH = v.object({ query: string, params: optional(string), continuation: optional(string), raw: rawResponse });
const BROWSE = v.object({ browseId: optional(string), continuation: optional(string), raw: optional(boolean) });
const QUEUE_QUERY = v.object({ raw: rawRenderer });
const AUTOPLAY = v.object({ raw: rawRenderer, continuation: optional(string) });
const LYRICS = v.object({ videoId: optional(string) });
const TRANSLATE = v.object({ lang: string, videoId: optional(string) });
const ADD_TO_QUEUE = v.object({
  videoIds: optional(stringArray),
  playlistIds: optional(stringArray),
  insertPosition: optional(v.picklist(["INSERT_AFTER_CURRENT_VIDEO", "INSERT_AT_END"])),
});
const PLAY_VIDEO = v.object({ videoId: string });
const DOWNLOAD = v.object({ videoId: optional(string) });
const SET_LIKE = v.object({ state: likeState });
const CONFIG = v.record(v.string(), v.unknown());
const FLAGS = v.record(v.string(), v.unknown());
const DELETE_FLAGS = v.object({ flags: stringArray });

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
    input: v.object({ speed: number }),
    run: (o, args) => (o.setPlaybackSpeed(Number(args.speed)), ok()),
  },
  {
    name: "playback_position",
    description: "Get the playback position in seconds, or a 0..1 fraction.",
    input: v.object({ percentage: optional(boolean) }),
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
    input: v.object({ enabled: boolean }),
    run: (o, args) => (o.setShuffle(args.enabled === true), ok()),
  },
  { name: "repeat_mode", description: "Get the repeat mode.", input: NO_ARGS, readOnly: true, run: (o) => ok({ mode: o.repeatMode() }) },
  {
    name: "set_repeat",
    description: "Set the repeat mode.",
    input: v.object({ mode: repeatMode }),
    run: (o, args) => (o.setRepeat(args.mode as "NONE" | "ALL" | "ONE"), ok()),
  },
  { name: "switch_repeat", description: "Cycle to the next repeat mode.", input: NO_ARGS, run: (o) => (o.switchRepeat(), ok()) },

  // Volume
  { name: "volume", description: "Get the volume.", input: NO_ARGS, readOnly: true, run: (o) => ok({ volume: o.volume() }) },
  {
    name: "set_volume",
    description: "Set the volume, 0-100.",
    input: v.object({ volume: number }),
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
    input: v.object({ muted: boolean }),
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
