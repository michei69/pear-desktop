import { createHash } from "node:crypto";
import { config, definePlugin, type HostContext } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { v } from "@pear/sdk/rpc";
import { net } from "electron";
import { buildSegmentsGradient, markerAt, type Marker, usableMarkers } from "./markers.ts";
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

type SponsorBlockConfig = { [K in Category]: boolean } & { apiURL: string; showSegmentsOnProgressBar: boolean };

const SEGMENTS_BAR_ID = "pear-sponsorblock-bar";
const HOVER_LABEL_ID = "pear-sponsorblock-hover";
/** Where the playhead sits on the track, as the marker mask's cut-out. */
const PLAYHEAD_PROPERTY = "--pear-sponsorblock-playhead";
/** YTM's own hover timestamp above the seek bar, on either player bar. */
const HOVER_TIME_SELECTOR = "#hover-time-info, .ytMusicMiniPlayerHoverTimeInfo";
/**
 * Where the markers go: the `tp-yt-paper-progress` track of YTM's classic seek
 * slider, or the new-UI miniplayer's full-width progress line. The selector
 * registry names the progress area rather than the track, and the overlay has
 * to be the track's own height.
 */
const SEEK_TRACKS = [
  "#progress-bar>#sliderContainer>div>#sliderBar>#progressContainer",
  ".ytMusicMiniPlayerProgressBarWrapper",
];

/** The page's in-flight segment request per running host part. */
const inflight = new WeakMap<object, AbortController>();

export default definePlugin({
  id: "sponsorblock",
  name: "SponsorBlock",
  description: "Skips non-music parts of music videos, using segments crowdsourced by SponsorBlock.",
  style: css`
    /* Segment markers painted over YTM's seek track. \`inset: 0\` keeps the band
       exactly the height of whichever track holds it. */
    #pear-sponsorblock-bar {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    /* The markers paint over YTM's played progress, but the seek knob stays on
       top of them: on the classic bar the knob is a later sibling, and on the
       new bar it is the progress input's own thumb, painted inside that
       element. Cutting the markers away at the playhead while the thumb shows
       (hover, focus) keeps the knob readable. */
    .ytMusicMiniPlayerProgressBarWrapper:hover > #pear-sponsorblock-bar,
    .ytMusicMiniPlayerProgressBarWrapper:focus-within > #pear-sponsorblock-bar {
      mask-image: linear-gradient(
        to right,
        #000 0,
        #000 calc(var(--pear-sponsorblock-playhead, 0%) - 9px),
        transparent calc(var(--pear-sponsorblock-playhead, 0%) - 9px),
        transparent calc(var(--pear-sponsorblock-playhead, 0%) + 9px),
        #000 calc(var(--pear-sponsorblock-playhead, 0%) + 9px)
      );
    }

    /* Names the segment under the pointer, sitting right above YTM's hover
       timestamp; matches that timestamp's own look. */
    #pear-sponsorblock-hover {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 2147483000;
      display: none;
      padding: 4px 8px;
      border-radius: 2px;
      background: rgb(33, 33, 33);
      color: #fff;
      font-size: 12px;
      line-height: 14.4px;
      white-space: nowrap;
      pointer-events: none;
    }
  `,
  config: {
    ...(Object.fromEntries(
      Object.entries(CATEGORIES).map(([id, c]) => [id, config.bool(c.on, { label: c.label, description: c.description })]),
    ) as { [K in Category]: ReturnType<typeof config.bool> }),
    apiURL: config.string("https://sponsor.ajay.app", {
      label: "API server",
      placeholder: "https://sponsor.ajay.app",
    }),
    showSegmentsOnProgressBar: config.bool(false, {
      label: "Show segments on the progress bar",
      description: "Paints the fetched segments on the seek bar, coloured per category.",
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
    /** The segment under the pointer, and where the pointer is. */
    let hovered: { category: string; pointerX: number; trackTop: number } | undefined;
    let stopHover: (() => void) | undefined;

    const api = await ctx.player.ready();

    /** The category's name, as the settings UI shows it. */
    const categoryLabel = (category: string) =>
      ctx.t(`plugins.sponsorblock.settings.category.${category}`, CATEGORIES[category as Category]?.label ?? category);

    /** Where the playhead sits on the track, or undefined while the duration is unknown. */
    const playhead = () => {
      const duration = api.getDuration();
      if (!Number.isFinite(duration) || duration <= 0) return undefined;
      return `${(api.getCurrentTime() / duration) * 100}%`;
    };

    /** Segments of the current track, as the seek bar paints them. */
    const markers = (): Marker[] => usableMarkers(submissions, api.getDuration());

    const hideHoverLabel = () => {
      hovered = undefined;
      const label = document.querySelector<HTMLElement>(`#${HOVER_LABEL_ID}`);
      if (label) label.style.display = "none";
    };

    /** Sits the label just above YTM's timestamp, or above the track without one. */
    const positionHoverLabel = () => {
      const label = document.querySelector<HTMLElement>(`#${HOVER_LABEL_ID}`);
      if (!hovered || !label || label.style.display === "none") return;

      const timestamp = document.querySelector<HTMLElement>(HOVER_TIME_SELECTOR);
      const rect = timestamp?.getBoundingClientRect();
      const hasTimestamp = !!rect && rect.width > 0 && rect.height > 0;
      if (hasTimestamp && timestamp) {
        // Match the timestamp's own surface (it is black on the new bar).
        label.style.backgroundColor = getComputedStyle(timestamp).backgroundColor;
      }
      const centerX = rect && hasTimestamp ? rect.x + rect.width / 2 : hovered.pointerX;
      const top = rect && hasTimestamp ? rect.y - label.offsetHeight - 6 : hovered.trackTop - label.offsetHeight - 6;
      label.style.transform = `translate(${Math.round(centerX)}px, ${Math.round(top)}px) translateX(-50%)`;
    };

    /** Names the segment under the pointer, right above YTM's timestamp. */
    const showHoverLabel = (category: string, pointerX: number, trackTop: number) => {
      hovered = { category, pointerX, trackTop };

      let label = document.querySelector<HTMLElement>(`#${HOVER_LABEL_ID}`);
      if (!label) {
        label = document.createElement("div");
        label.id = HOVER_LABEL_ID;
        document.body.append(label);
      }

      const text = categoryLabel(category);
      if (label.textContent !== text) label.textContent = text;
      label.style.display = "block";

      // YTM creates and moves its timestamp in a handler that runs after ours,
      // so the next frames re-anchor the label above it instead of guessing.
      positionHoverLabel();
      requestAnimationFrame(positionHoverLabel);
      ctx.setTimeout(positionHoverLabel, 60);
    };

    /** Follows the pointer along the seek bar to label the segment under it. */
    const trackHover = (container: HTMLElement) => {
      stopHover?.();

      // The classic bar's slider covers the track; the new bar's input is the
      // hover target YTM shows its own timestamp for.
      const host =
        container.closest<HTMLElement>("#progress-bar") ??
        container.querySelector<HTMLElement>("input") ??
        container;

      const onMove = (event: MouseEvent) => {
        const duration = api.getDuration();
        const rect = container.getBoundingClientRect();
        if (
          !ctx.config.showSegmentsOnProgressBar ||
          submissions.length === 0 ||
          !Number.isFinite(duration) ||
          duration <= 0 ||
          rect.width <= 0
        ) {
          hideHoverLabel();
          return;
        }

        const marker = markerAt(markers(), ((event.clientX - rect.left) / rect.width) * duration);
        if (!marker) {
          hideHoverLabel();
          return;
        }

        showHoverLabel(marker.category, event.clientX, rect.top);
      };

      const onLeave = () => hideHoverLabel();
      host.addEventListener("mousemove", onMove);
      host.addEventListener("mouseleave", onLeave);
      stopHover = () => {
        host.removeEventListener("mousemove", onMove);
        host.removeEventListener("mouseleave", onLeave);
        stopHover = undefined;
        hideHoverLabel();
      };
    };

    /** Paints the segments' colours over the seek track, or clears them. */
    const renderMarkers = () => {
      const gradient = ctx.config.showSegmentsOnProgressBar ? buildSegmentsGradient(markers(), api.getDuration()) : "";

      const existing = document.querySelector<HTMLElement>(`#${SEGMENTS_BAR_ID}`);
      if (!gradient) {
        existing?.remove();
        return;
      }

      if (existing) {
        existing.style.backgroundImage = gradient;
        existing.style.setProperty(PLAYHEAD_PROPERTY, playhead() ?? "0%");
        return;
      }

      // YTM builds its player bar after the plugins start, so this can no-op
      // until a later hook finds the track.
      const container = document.querySelector<HTMLElement>(SEEK_TRACKS.join(", "));
      if (!container) return;

      const bar = document.createElement("div");
      bar.id = SEGMENTS_BAR_ID;
      bar.style.backgroundImage = gradient;
      bar.style.setProperty(PLAYHEAD_PROPERTY, playhead() ?? "0%");
      // Last child: the markers paint over YTM's played progress. The knob stays
      // on top of them (a later sibling on the classic bar; the input's own
      // thumb on the new bar, which the stylesheet uncovers at the playhead).
      container.append(bar);
      trackHover(container);
    };

    /** Moves the marker cut-out with the playhead, re-adding the bar if YTM rebuilt its seek track. */
    const syncMarkers = () => {
      const bar = document.querySelector<HTMLElement>(`#${SEGMENTS_BAR_ID}`);
      if (!bar) {
        renderMarkers();
        return;
      }
      const at = playhead();
      if (at) bar.style.setProperty(PLAYHEAD_PROPERTY, at);
    };

    /** Drops the segment set and everything drawn from it. */
    const resetSegments = () => {
      submissions = [];
      document.querySelector(`#${SEGMENTS_BAR_ID}`)?.remove();
      hideHoverLabel();
    };

    /** Jumps past the segment the player is inside, if any. */
    const applySegments = () => {
      if (submissions.length === 0 || ctx.player.state.ad || api.getVideoData().video_id !== videoId) return;
      const target = skipTarget(usableSegments(submissions, api.getDuration()), api.getCurrentTime());
      if (target === undefined) return;
      ctx.log.info(`skipping to ${target.toFixed(1)}s`);
      ctx.player.control({ type: "seek", seconds: target });
    };

    const load = async (id: string) => {
      videoId = id;
      // A new track starts with no segments, so the previous track's markers and
      // bar go before its own answer can arrive. Resetting on load rather than
      // on the media's `emptied` keeps a late emptied event from wiping the set
      // this track just received.
      resetSegments();
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
        return;
      }

      // Segments can arrive mid-track: skip the one already in progress and
      // paint the bar now, instead of waiting for the next timeupdate.
      applySegments();
      renderMarkers();
    };

    // Ads and the gap before YTM knows the track carry no video id.
    ctx.player.on("trackLoading", (id) => {
      if (id) void load(id);
    });
    // The host only fetches on a track change, so ask it for the current
    // track's segments instead of waiting for the next one.
    const initial = api.getVideoData().video_id;
    if (initial) void load(initial);

    const video = await ctx.player.videoReady();
    ctx.listen(video, "timeupdate", () => {
      applySegments();
      syncMarkers();
    });
    // Duration is unknown when the plugin starts; the bar waits for it.
    ctx.listen(video, "durationchange", renderMarkers);

    return () => {
      stopHover?.();
      document.querySelector(`#${HOVER_LABEL_ID}`)?.remove();
      document.querySelector(`#${SEGMENTS_BAR_ID}`)?.remove();
    };
  },
});

/** Skip submissions for a video, looked up by hash prefix so the server never learns which video plays. */
async function fetchSegments(ctx: HostContext<SponsorBlockConfig>, videoId: string, signal?: AbortSignal) {
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
