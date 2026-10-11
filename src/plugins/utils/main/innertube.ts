import { BG, type BgConfig } from 'bgutils-js';
import { type BrowserWindow } from 'electron';
import {
  Innertube,
  Platform,
  UniversalCache,
  Utils,
  type Types,
  type YT,
  type YTMusic,
} from '\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js';

import { getNetFetchAsFetch } from './fetch';

const BG_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

// youtubei.js evaluates the player script itself; without this it throws on Node.
Platform.shim.eval = (
  data: Types.BuildScriptResult,
  env: Record<string, Types.VMPrimative>,
) => {
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`);
  }

  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  }

  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

  // oxlint-disable-next-line typescript/no-implied-eval,typescript/no-unsafe-return,typescript/no-unsafe-call
  return new Function(code)();
};

const getCookieFromWindow = async (win: BrowserWindow) =>
  (
    await win.webContents.session.cookies.get({
      url: 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
    })
  )
    .map((it) => it.name + '=' + it.value)
    .join(';');

/**
 * Attaches a proof-of-origin token, which YouTube requires for some stream
 * requests. Best effort: most videos work without one.
 */
const attachPoToken = async (yt: Innertube, win: BrowserWindow) => {
  const visitorData = yt.session.context.client.visitorData;
  if (!visitorData) return;

  const cleanUp = (context: Partial<typeof globalThis>) => {
    delete context.window;
    delete context.document;
  };

  try {
    const [width, height] = win.getSize();
    // emulate jsdom using happy-dom
    const window = new (await import('happy-dom')).Window({
      width,
      height,
      console,
    });
    const document = window.document;

    Object.assign(globalThis, { window, document });

    const bgConfig: BgConfig = {
      fetch: getNetFetchAsFetch(),
      globalObj: globalThis,
      identifier: visitorData,
      requestKey: BG_REQUEST_KEY,
    };

    const bgChallenge = await BG.Challenge.create(bgConfig);
    const interpreterJavascript =
      bgChallenge?.interpreterJavascript
        .privateDoNotAccessOrElseSafeScriptWrappedValue;

    if (interpreterJavascript) {
      // Workaround to run interpreterJavascript; maybe sval would do instead
      // (https://github.com/Siubaak/sval).
      // oxlint-disable-next-line typescript/no-implied-eval,typescript/no-unsafe-call
      new Function(interpreterJavascript)();

      const poTokenResult = await BG.PoToken.generate({
        program: bgChallenge.program,
        globalName: bgChallenge.globalName,
        bgConfig,
      }).finally(() => {
        cleanUp(globalThis);
      });

      yt.session.po_token = poTokenResult.poToken;
    } else {
      cleanUp(globalThis);
    }
  } catch {
    cleanUp(globalThis);
  }
};

let session: Promise<Innertube> | undefined;

/**
 * The Innertube session every plugin shares: signed with the app's YouTube
 * cookies and carrying a proof-of-origin token. A failed setup is forgotten so
 * the next caller retries.
 */
export const getInnertubeSession = (win: BrowserWindow): Promise<Innertube> => {
  session ??= getCookieFromWindow(win)
    .then((cookie) =>
      Innertube.create({
        cache: new UniversalCache(false),
        cookie,
        generate_session_locally: true,
        fetch: getNetFetchAsFetch(),
      }),
    )
    .then(async (yt) => {
      await attachPoToken(yt, win);
      return yt;
    })
    .catch((error: unknown) => {
      session = undefined;
      throw error;
    });

  return session;
};
export const isPremium = async (win: BrowserWindow): Promise<boolean> => {
  // Signed out counts as non-premium.
  const isSignedIn = (await win.webContents.executeJavaScript(
    '!!yt.config_.LOGGED_IN',
  )) as boolean;

  if (!isSignedIn) return false;

  // Signed in: look for the upgrade button.
  const upgradeBtnIconPathData = (await win.webContents.executeJavaScript(
    'document.querySelector(\'iron-iconset-svg[name="yt-sys-icons"] #\u0079\u006f\u0075\u0074\u0075\u0062\u0065_music_monochrome\')?.firstChild?.getAttribute("d")?.substring(0, 15)',
  )) as string | null;

  // No icon means non-premium.
  if (!upgradeBtnIconPathData) return false;

  const upgradeButton = `ytmusic-guide-entry-renderer:has(> tp-yt-paper-item > yt-icon path[d^="${upgradeBtnIconPathData}"])`;

  return (await win.webContents.executeJavaScript(
    `!document.querySelector('${upgradeButton}')`,
  )) as boolean;
};

/**
 * What `info.download({ type: 'video+audio' })` returns: a muxed mp4. A music
 * track still only plays its soundtrack, and every browser decodes this one.
 */
const MUXED_MIME = 'video/mp4; codecs="avc1.42001E, mp4a.40.2"';

/** A track's audio, ready to be turned into a Blob by the renderer. */
export type AudioBytes = { bytes: Uint8Array<ArrayBuffer>; mimeType: string };

/**
 * The playable audio of a track, as bytes. A media element cannot play a track
 * URL straight from YouTube: page streams use YouTube's proprietary UMP container
 * (`application/vnd.yt-ump`, which no browser can demux) and raw URLs 403
 * (`net::ERR_BLOCKED_BY_ORB`) once a renderer streams one. Fetching bytes here
 * avoids both: plain mp4 in, Blob out.
 */
export const getAudioBytes = async (
  yt: Innertube,
  videoId: string,
  win: BrowserWindow,
): Promise<AudioBytes | undefined> => {
  let info: YTMusic.TrackInfo | YT.VideoInfo = await yt.music.getInfo(videoId);

  // Age-restricted videos 404 with the bypass, so use getBasicInfo instead;
  // only the streaming data is needed.
  if (info.playability_status?.status === 'LOGIN_REQUIRED') {
    info = await yt.getBasicInfo(videoId, { client: 'TV_EMBEDDED' });
  }

  if (info.playability_status?.status !== 'OK') return undefined;

  // `info.download()` is the downloader's own path; hand-built stream URLs
  // (decipher + range request) 403 far more often, so the transport stays in the
  // library. `video+audio`, not `audio`: audio-only streams resolve fine (itag
  // 251, opus) but the CDN refuses to serve them on licensed tracks, whereas the
  // muxed format works. The video track is ignored on playback, so it costs bytes.
  const stream = await info.download({
    type: (await isPremium(win)) ? 'audio' : 'video+audio',
    quality: 'best',
    format: 'any',
  });

  const chunks: Buffer[] = [];
  for await (const chunk of Utils.streamToIterable(stream)) {
    chunks.push(Buffer.from(chunk));
  }

  return { bytes: new Uint8Array(Buffer.concat(chunks)), mimeType: MUXED_MIME };
};
