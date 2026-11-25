import { type ConfigOf, definePlugin, type HostContext } from "@pear/sdk";
import { InnertubeSession, type PoTokenAnswer } from "@pear/sdk/innertube";
import type { PoTokenRequest } from "@pear/sdk/potoken";
import { startCrossfade } from "./page.ts";
import { schema } from "./schema.ts";
import {
  clientLookups,
  downloadAudio,
  lengthSecondsOf,
  MAX_FULL_DOWNLOAD_SECONDS,
  playabilityError,
  playableInfo,
  streamAttempts,
  streamFormat,
  type TrackInfo,
} from "./source.ts";

const YTM_ORIGIN = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";
/** An account rarely changes premium status mid-session. */
const PREMIUM_CACHE_TTL_MS = 5 * 60 * 1000;
/** BotGuard runs in the page; a page that hangs must not hold the track's second stream. */
const PO_TOKEN_TIMEOUT_MS = 15_000;
/** A candidate stream URL that doesn't answer a byte-range request in this long is refused. */
const STREAM_PROBE_TIMEOUT_MS = 5_000;

type Host = HostContext<ConfigOf<typeof schema>>;

export default definePlugin({
  id: "crossfade",
  name: "Crossfade",
  description: "Fades out the end of a track while the next one fades in.",
  config: schema,
  host: {
    start(ctx) {
      // All options live in the generated settings card; this is the quick way in.
      ctx.addMenuItem({
        label: ctx.t("plugins.crossfade.menu.options", "Crossfade options"),
        click: () => ctx.openSettings(),
      });
    },
    commands: {
      /**
       * A direct audio stream of a track, used to play the end while the next one
       * starts. The page fetches it when the track nears its end, so it only ever
       * streams the tail.
       */
      async audioUrl(videoId: string) {
        const { yt, poToken } = await streamSession(this, videoId);
        let lastError: unknown;
        // A playable response can still have no stream a URL can use (SABR-only),
        // and a client can offer a stream the CDN refuses for this account. Ask
        // every client, and every format audio-only first, for one it serves.
        for (const client of clientLookups(yt, videoId, poToken)) {
          let info: TrackInfo;
          try {
            info = await client.info();
          } catch (error) {
            lastError = error;
            continue;
          }
          if (info.playability_status?.status !== "OK") {
            lastError = playabilityError(info);
            continue;
          }
          for (const attempt of streamAttempts()) {
            let url: string;
            let format: ReturnType<typeof streamFormat>;
            try {
              format = streamFormat(info, attempt);
              url = await format.decipher(yt.session.player);
            } catch (error) {
              lastError = error;
              continue;
            }
            if (!(await serves(this, url))) continue;
            this.log.info(`streaming ${videoId} as ${format.mime_type ?? "unknown"} (itag ${format.itag}) from the ${client.name} client`);
            return url;
          }
        }
        throw lastError instanceof Error ? lastError : new Error(`no playable stream for ${videoId}`);
      },

      /**
       * A track's audio as bytes. A media element can't play the site's own stream
       * URLs reliably (the raw URL is refused once a renderer streams it), so the
       * crossfade decodes a Blob instead. Tracks too long to buffer return no
       * bytes, and the page streams their URL directly instead.
       */
      async audioBytes(videoId: string) {
        const { yt, poToken } = await streamSession(this, videoId);
        const info = await playableInfo(yt, videoId, poToken);
        const duration = lengthSecondsOf(info);
        if (duration !== undefined && duration > MAX_FULL_DOWNLOAD_SECONDS) {
          this.log.info(`not buffering ${videoId}: ${Math.round(duration)}s is too long; using its stream URL`);
          return undefined;
        }
        return await downloadAudio(info, await isPremium(this));
      },
    },
  },
  page: startCrossfade,
});

// Host: one InnerTube session per host instance, created on first use.
const sessions = new WeakMap<Host, InnertubeSession>();

function sessionOf(ctx: Host) {
  let session = sessions.get(ctx);
  if (!session) {
    session = new InnertubeSession({
      fetch: (input, init) => ctx.session.fetch(input, init),
      cookie: () => cookiesOf(ctx),
      poToken: (request: PoTokenRequest) => ctx.request<PoTokenAnswer>("poToken", request, { timeout: PO_TOKEN_TIMEOUT_MS }),
      log: ctx.log,
    });
    sessions.set(ctx, session);
  }
  return session;
}

/**
 * The client and the track's PO token. The library's player keeps the token it
 * was created with, so the session's gets this track's: that is what puts `pot`
 * on the stream URLs it deciphers.
 */
async function streamSession(ctx: Host, videoId: string) {
  const session = sessionOf(ctx);
  const yt = await session.get();
  const poToken = await session.poToken(yt, videoId);
  if (poToken && yt.session.player) yt.session.player.po_token = poToken;
  return { yt, poToken };
}

/** The window's site cookies: the session every request is signed with. */
async function cookiesOf(ctx: Host) {
  const cookies = await ctx.session.cookies.get({ url: YTM_ORIGIN });
  return cookies.length > 0 ? cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") : undefined;
}

/**
 * Whether the CDN serves a candidate stream URL to this session. A URL the
 * account may not play (audio-only on a non-premium web client, an expired or
 * region-blocked stream) answers 4xx here and would fail in the page too.
 */
async function serves(ctx: Host, url: string) {
  try {
    const response = await ctx.session.fetch(url, {
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(STREAM_PROBE_TIMEOUT_MS),
    });
    // Cancel the (tiny) body: a URL that ignores the range must not be drained.
    await response.body?.cancel();
    if (!response.ok) ctx.log.info(`the CDN refused a stream URL (${response.status}); trying the next one`);
    return response.ok;
  } catch (error) {
    ctx.log.warn("couldn't check a stream URL", error);
    return false;
  }
}

let premiumCache: { value: boolean; expires: number } | undefined;

/** Whether the page's account is premium (signed out: no). */
async function isPremium(ctx: Host) {
  if (premiumCache && premiumCache.expires > Date.now()) return premiumCache.value;
  try {
    const value = await queryPremium(ctx);
    premiumCache = { value, expires: Date.now() + PREMIUM_CACHE_TTL_MS };
    return value;
  } catch (error) {
    // Signed out, or the page isn't ready: the muxed stream works for both, so
    // don't cache a guess for the next five minutes.
    ctx.log.warn("could not read the account's premium state", error);
    return false;
  }
}

/** A premium account has no upgrade button in the guide. */
async function queryPremium(ctx: Host) {
  const run = (code: string) => ctx.window.webContents.executeJavaScript(code) as Promise<unknown>;
  const signedIn = (await run("!!yt.config_.LOGGED_IN")) as boolean;
  if (!signedIn) return false;

  const icon = (await run(
    `document.querySelector('iron-iconset-svg[name="yt-sys-icons"] #\u0079\u006f\u0075\u0074\u0075\u0062\u0065_music_monochrome')?.firstChild?.getAttribute("d")?.substring(0, 15)`,
  )) as string | null;
  if (!icon) return false;

  const upgrade = `ytmusic-guide-entry-renderer:has(> tp-yt-paper-item > yt-icon path[d^="${icon}"])`;
  return (await run(`!document.querySelector('${upgrade}')`)) as boolean;
}
