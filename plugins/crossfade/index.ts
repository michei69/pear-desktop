import { type ConfigOf, definePlugin, type HostContext } from "@pear/sdk";
import { InnertubeSession, type PoTokenAnswer } from "@pear/sdk/innertube";
import type { PoTokenRequest } from "@pear/sdk/potoken";
import { startCrossfade } from "./page.ts";
import { schema } from "./schema.ts";
import { chooseAudioFormat, downloadAudio, playableInfo } from "./source.ts";

const YTM_ORIGIN = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";
/** An account rarely changes premium status mid-session; master cached it this long too. */
const PREMIUM_CACHE_TTL_MS = 5 * 60 * 1000;
/** BotGuard runs in the page; a page that hangs must not hold the track's second stream. */
const PO_TOKEN_TIMEOUT_MS = 15_000;

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
       * A direct audio stream of a track, as pear-desktop fetched one to play the
       * end of the track while the next one starts. The page falls back to it when
       * the track's bytes don't arrive.
       */
      async audioUrl(videoId: string) {
        const { yt, poToken } = await streamSession(this, videoId);
        const info = await playableInfo(yt, videoId, poToken);
        return await chooseAudioFormat(info, await isPremium(this)).decipher(yt.session.player);
      },

      /**
       * A track's audio as bytes. A media element can't play the site's own stream
       * URLs reliably (the raw URL is refused once a renderer streams it), so the
       * crossfade decodes a Blob instead.
       */
      async audioBytes(videoId: string) {
        const { yt, poToken } = await streamSession(this, videoId);
        const info = await playableInfo(yt, videoId, poToken);
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
 * on the stream URLs it deciphers, as pear-desktop's session token did.
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

/** pear-desktop's check: a premium account has no upgrade button in the guide. */
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
