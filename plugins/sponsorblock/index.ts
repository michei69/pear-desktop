import { createHash } from "node:crypto";
import { config, definePlugin, type HostContext } from "@pear/sdk";
import { v } from "@pear/sdk/rpc";
import { net } from "electron";
import { skipTarget, type Submission, usableSegments } from "./segments.ts";

const CATEGORIES = {
  music_offtopic: { label: "Non-music sections", description: "Talking, skits and intros in music videos.", on: true },
  sponsor: { label: "Sponsors", description: "Paid promotions.", on: true },
  selfpromo: { label: "Self-promotion", description: "Merch, donations and shout-outs.", on: true },
  interaction: { label: "Interaction reminders", description: "“Like and subscribe”.", on: true },
  intro: { label: "Intros", description: "Intermissions and intro animations.", on: true },
  outro: { label: "Outros", description: "End cards and credits.", on: true },
  preview: { label: "Previews and recaps", description: "Previews of what's coming up.", on: false },
  filler: { label: "Filler tangents", description: "Off-topic jokes and tangents.", on: false },
} as const;
type Category = keyof typeof CATEGORIES;

/** The page's in-flight segment request per running host part. */
const inflight = new WeakMap<object, AbortController>();

export default definePlugin({
  id: "sponsorblock",
  name: "SponsorBlock",
  description: "Skips non-music parts of music videos, using segments crowdsourced by SponsorBlock.",
  config: {
    ...(Object.fromEntries(
      Object.entries(CATEGORIES).map(([id, c]) => [id, config.bool(c.on, { label: c.label, description: c.description })]),
    ) as { [K in Category]: ReturnType<typeof config.bool> }),
    apiURL: config.string("https://sponsor.ajay.app", {
      label: "API server",
      placeholder: "https://sponsor.ajay.app",
    }),
  },
  host: {
    start(ctx) {
      // The page stops asking when the plugin is disabled mid-request.
      ctx.onCleanup(() => {
        inflight.get(ctx)?.abort();
        inflight.delete(ctx);
      });
    },
    commands: {
      segments(videoId: string) {
        // A newer track started: the previous answer can no longer apply, and
        // its request is no longer worth waiting for.
        inflight.get(this)?.abort();
        const controller = new AbortController();
        inflight.set(this, controller);
        return fetchSegments(this, videoId, controller.signal).finally(() => {
          if (inflight.get(this) === controller) inflight.delete(this);
        });
      },
    },
    rpc: {
      segments: {
        summary: "Skip segments of a video, for the enabled categories",
        input: v.object({ videoId: v.pipe(v.string(), v.regex(/^[\w-]{11}$/, "not a video id")) }),
        run({ videoId }) {
          return fetchSegments(this, videoId);
        },
      },
    },
  },
  page: async (ctx) => {
    let videoId: string | undefined;
    let submissions: Submission[] = [];
    let generation = 0;

    const load = async (id: string) => {
      videoId = id;
      submissions = [];
      // A slower answer for a previous track must not replace the current
      // track's segments (the host aborts its request too).
      const request = ++generation;
      try {
        const result = await ctx.host.invoke("segments", id);
        if (request !== generation || videoId !== id) return;
        submissions = result;
        if (result.length > 0) ctx.log.info(`${result.length} segment(s) for ${id}`);
      } catch (error) {
        if (request !== generation) return;
        ctx.log.warn("could not load segments", error);
      }
    };

    const api = await ctx.player.ready();
    ctx.player.on("trackLoading", (id) => void load(id));
    const initial = api.getVideoData().video_id;
    if (initial) void load(initial);

    const video = await ctx.player.videoReady();
    ctx.listen(video, "timeupdate", () => {
      if (submissions.length === 0 || ctx.player.state.ad || api.getVideoData().video_id !== videoId) return;
      const target = skipTarget(usableSegments(submissions, api.getDuration()), api.getCurrentTime());
      if (target === undefined) return;
      ctx.log.info(`skipping to ${target.toFixed(1)}s`);
      ctx.player.control({ type: "seek", seconds: target });
    });
  },
});

/** Skip submissions for a video, looked up by hash prefix so the server never learns which video plays. */
async function fetchSegments(ctx: HostContext<{ [K in Category]: boolean } & { apiURL: string }>, videoId: string, signal?: AbortSignal) {
  const categories = (Object.keys(CATEGORIES) as Category[]).filter((c) => ctx.config[c]);
  if (categories.length === 0) return [];
  const base = (ctx.config.apiURL || "https://sponsor.ajay.app").replace(/\/+$/, "");
  const prefix = createHash("sha256").update(videoId).digest("hex").slice(0, 4);
  const query = new URLSearchParams({ categories: JSON.stringify(categories), actionTypes: '["skip"]' });
  let response: Response;
  try {
    response = await net.fetch(`${base}/api/skipSegments/${prefix}?${query}`, signal ? { signal } : undefined);
  } catch (error) {
    // Aborted because the track changed: the caller has newer work.
    if (signal?.aborted) return [];
    throw error;
  }
  // 404 means no segments for any video with this prefix.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`SponsorBlock answered ${response.status}`);
  const videos = (await response.json()) as { videoID: string; segments: Submission[] }[];
  return videos.find((video) => video.videoID === videoId)?.segments ?? [];
}
