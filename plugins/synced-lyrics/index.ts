import { definePlugin } from "@pear/sdk";
import { v } from "@pear/sdk/rpc";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { shell } from "electron";
import { hostOf, hosts, LyricsHost } from "./host.ts";
import { mountLyrics } from "./page/mount.tsx";
import { schema } from "./schema.ts";
import type { CustomQuery, LyricResult, ProviderId, SearchQuery } from "./types.ts";

const videoId = v.pipe(v.string(), v.regex(/^[\w-]{11}$/, "not a video id"));
const videoInput = v.optional(v.object({ videoId: v.optional(videoId) }), {});

export default definePlugin({
  id: "synced-lyrics",
  name: "Synced lyrics",
  description: "Time-synced lyrics in the Lyrics tab, with word-by-word highlighting, click-to-seek and romanization.",
  authors: ["Non0reo", "ArjixWasTaken", "KimJammer", "Strvm"],
  config: schema,
  host: {
    start(ctx) {
      hosts.set(ctx, new LyricsHost(ctx.app.getPath("userData"), ctx.app.getLocale()));
      return () => void hosts.delete(ctx);
    },
    // Keep the cache; config only matters to the page and to each call.
    onConfigChange() {},
    commands: {
      search(provider: ProviderId, query: SearchQuery): Promise<LyricResult | null> {
        return hostOf(this).search(provider, query, {
          musixmatch: {
            tokenMode: this.config.musixmatchTokenMode,
            userToken: this.config.musixmatchToken,
            t: this.t,
          },
          ytmusic: { useProxyFallback: !this.config.useYTMLyricsWithoutProxy },
        });
      },
      /** Opens a lyrics page at its provider (Megalobiz asks to be linked). */
      openSource(url: string) {
        if (!/^https:\/\/(www\.)?megalobiz\.com\//.test(url)) throw new Error("not a lyrics page");
        return shell.openExternal(url);
      },
      romanize(lines: string[]) {
        return hostOf(this).romanize(lines);
      },
      convertChinese(lines: string[], mode: "s2t" | "t2s") {
        return hostOf(this).convertChinese(lines, mode);
      },
      translate(request: { videoId: string; title: string; artists: string[]; lines: string[]; language?: string }) {
        return hostOf(this).translate(request, this.config);
      },
      customQuery(videoId: string) {
        return hostOf(this).customQuery(videoId);
      },
      setCustomQuery(videoId: string, query: CustomQuery) {
        return hostOf(this).setCustomQuery(videoId, query);
      },
      removeCustomQuery(videoId: string) {
        return hostOf(this).removeCustomQuery(videoId);
      },
    },
    rpc: {
      lyrics: {
        summary: "Lyrics from every provider for a video (default: the current track)",
        input: videoInput,
        async run({ videoId }) {
          const track = this.player.state.track;
          const details = track ? await this.player.details().catch(() => null) : null;
          return hostOf(this).lyrics({
            track,
            details,
            config: this.config,
            t: this.t,
            ...(videoId ? { videoId } : {}),
          });
        },
      },
      translations: {
        summary: "Cached translations of a video's lyrics (default: the current track)",
        input: videoInput,
        run({ videoId }) {
          return hostOf(this).translations(videoId ?? this.player.state.track?.videoId ?? null);
        },
      },
      translateLyrics: {
        summary: "Translate a video's lyrics into lang (default: the configured language) and cache the result",
        input: v.object({
          lang: v.optional(v.string()),
          videoId: v.optional(videoId),
          force: v.optional(v.boolean()),
        }),
        async run({ lang, videoId, force }) {
          const track = this.player.state.track;
          const details = track ? await this.player.details().catch(() => null) : null;
          return hostOf(this).translateLyrics({
            track,
            details,
            config: this.config,
            t: this.t,
            ...(videoId ? { videoId } : {}),
            ...(lang ? { lang } : {}),
            ...(force ? { force } : {}),
          });
        },
      },
    },
  },
  page: mountLyrics,
  style: css`
    sel(lyrics.panel):has(> pear-synced-lyrics[open]) > :not(pear-synced-lyrics) {
      display: none !important;
    }
    sel(lyrics.panel):has(> pear-synced-lyrics[open]) {
      scrollbar-width: none;
    }
    pear-synced-lyrics:not([open]) {
      display: none;
    }
  `,
});
