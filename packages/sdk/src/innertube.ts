// The host's InnerTube session: the app's cookies, the library's platform shims
// and the page's proof-of-origin tokens, for the main-process plugins that stream
// from the site (the downloader and the crossfade). Host-only: page code imports
// `potoken.ts` instead, as the library is a main-process dependency.

import { Innertube, Platform, type Types, UniversalCache } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";
import type { PoTokenRequest } from "./potoken.ts";
import { errorMessage } from "./util.ts";

/** What the page answers for a PO token (potoken.ts). */
export interface PoTokenAnswer {
  poToken: string;
  /** The page's visitor, which the token is minted for when signed out. */
  visitorData: string | undefined;
}

export type { PoTokenRequest };

export interface SessionOptions {
  /** The window's session's fetch. */
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  /** The signed-in session's cookies, when requests use the account. */
  cookie(): Promise<string | undefined>;
  /** A PO token from the page, which runs BotGuard in a real DOM; for a song when the site binds them to songs. */
  poToken(request: PoTokenRequest): Promise<PoTokenAnswer>;
  /** Remember the player responses the client fetched (`playerResponse()`), which YTM's offline player needs. */
  keepPlayerResponses?: boolean;
  log: { warn(...args: unknown[]): void };
}

/** The site's player responses remembered for offline playback, the latest songs'. */
const PLAYER_RESPONSES_KEPT = 50;

/**
 * The InnerTube library (13 and later) leaves deciphering stream URLs to the app: run the
 * player's script it extracted, as pear-desktop did.
 */
function evaluate(data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) {
  const properties: string[] = [];
  if (env.n) properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (env.sig) properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  // oxlint-disable-next-line typescript/no-implied-eval
  return new Function(`${data.output}\nreturn { ${properties.join(", ")} }`)() as Record<string, Types.VMPrimative>;
}

/** One InnerTube client for the plugin's lifetime, created again when the account changes. */
export class InnertubeSession {
  #options: SessionOptions;
  #current: Promise<{ yt: Innertube; cookie: string | undefined }> | undefined;
  readonly #playerResponses = new Map<string, string>();

  constructor(options: SessionOptions) {
    this.#options = options;
  }

  async get(): Promise<Innertube> {
    const cookie = await this.#options.cookie();
    const current = await this.#current?.catch(() => undefined);
    if (current && current.cookie === cookie) return current.yt;
    const created = this.#create(cookie);
    this.#current = created;
    created.catch(() => {
      if (this.#current === created) this.#current = undefined;
    });
    return (await created).yt;
  }

  /**
   * The site's player response for a song this session looked up, as it sent it
   * (JSON); undefined when it wasn't playable. YTM's offline player plays the song
   * with it; asking again without the song's PO token isn't answered.
   */
  playerResponse(videoId: string) {
    return this.#playerResponses.get(videoId);
  }

  /** A PO token for a song's streams; `refresh` after a stream refused the last one. Undefined when the page has none. */
  async poToken(yt: Innertube, videoId: string, refresh = false): Promise<string | undefined> {
    try {
      const answer = await this.#options.poToken({ signedIn: yt.session.logged_in, refresh, videoId });
      return answer.poToken;
    } catch (error) {
      this.#options.log.warn("no PO token from the page:", errorMessage(error));
      return undefined;
    }
  }

  /** Remembers a playable player response the library got. */
  async #remember(response: Response) {
    try {
      const json = await response.text();
      const parsed = JSON.parse(json) as { videoDetails?: { videoId?: string }; playabilityStatus?: { status?: string } };
      const videoId = parsed.videoDetails?.videoId;
      if (!videoId || parsed.playabilityStatus?.status !== "OK" || this.#playerResponses.has(videoId)) return;
      this.#playerResponses.set(videoId, json);
      if (this.#playerResponses.size > PLAYER_RESPONSES_KEPT) this.#playerResponses.delete(this.#playerResponses.keys().next().value!);
    } catch {}
  }

  async #create(cookie: string | undefined) {
    Platform.shim.eval = evaluate;
    const { fetch, keepPlayerResponses } = this.#options;
    const yt = await Innertube.create({
      // The cookies go in as the library's header (it signs requests with them), not again from the session's jar.
      fetch: async (input, init) => {
        const response = await fetch(input as string | Request, { ...init, credentials: "omit" });
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (keepPlayerResponses && new URL(url).pathname.endsWith("/player")) void this.#remember(response.clone());
        return response;
      },
      generate_session_locally: true,
      cache: new UniversalCache(false),
      ...(cookie ? { cookie } : {}),
    });
    // Signed out, tokens are bound to the page's visitor; requests must come from the same one.
    const visitorData = await this.#options
      .poToken({ signedIn: yt.session.logged_in, refresh: false })
      .then((answer) => answer.visitorData)
      .catch(() => undefined);
    if (visitorData && !yt.session.logged_in) yt.session.context.client.visitorData = visitorData;
    return { yt, cookie };
  }
}
