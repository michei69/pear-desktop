// Musixmatch, through the API of its mobile app, like pear-desktop did (after
// Strvm/musicxmatch-api): `token.get` for a token, then one
// `macro.subtitles.get` call for the matched track, its lyrics and its LRC.
//
// The mobile API hands its token to anonymous clients, which the desktop API
// no longer does (it answers an all-zero token, and every query then "matches"
// some other song with made-up syllables). So the default mode takes the auto
// token and renews it when Musixmatch reports it stale: it lives 60 seconds. A
// token copied from the user's own signed-in app can be configured instead.
// Matches are also checked against the playing track, as Musixmatch's matcher
// always answers with *some* track.

import type { Translate } from "@pear/sdk/i18n";
import { parseLrc } from "../lrc.ts";
import { queryArtistSimilarity, queryTitleSimilarity } from "../match.ts";
import type { LyricResult, SearchQuery } from "../types.ts";
import { getJson, type Fetch } from "./http.ts";

const BASE = "https://apic-appmobile.musixmatch.com/ws/1.1";
const APP_ID = "mac-ios-v2.0";
/** The headers of the mobile app; Musixmatch asks for a captcha without the X-* ones. */
const HEADERS = {
  authority: "apic-appmobile.musixmatch.com",
  "X-Cookie": "x-mxm-token-guid=",
  "x-mxm-app-version": "10.1.1",
  "X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  Accept: "application/json",
};
/** The mobile app's token is good for a minute. */
const TOKEN_TTL_MS = 60_000;
/** The matcher's fallback when it finds nothing (pear-desktop's note: "Coldplay - Paradise"). */
const FALLBACK_TRACK_ID = 115264642;
/** Appended to lyrics served to API clients. */
const DISCLAIMER = /\n*\*{3,}[^*]*\*{3,}\s*(\(\d+\))?\s*$/;

export interface MusixmatchOptions {
  /** "auto": the mobile app's own token; "user": the token set in the settings. */
  tokenMode: "auto" | "user";
  /** The user's own token, used in user mode only. */
  userToken: string;
  t: Translate;
}

interface Header {
  status_code: number;
  hint?: string;
}

interface Envelope<B> {
  message?: { header?: Header; body?: B | unknown[] | string };
}

export interface MacroBody {
  macro_calls?: Record<string, Envelope<Record<string, any>>>;
}

/** An empty or all-zero token is what Musixmatch hands out when it has none. */
export const isUsableToken = (token: string | undefined): token is string => Boolean(token && !/^0+$/.test(token));

let anonymous: { token: Promise<string | undefined>; at: number } | undefined;

/** Forgets the cached anonymous token (tests, and after Musixmatch rejected it). */
export function resetMusixmatchToken() {
  anonymous = undefined;
}

export async function fetchToken(fetch: Fetch): Promise<string | undefined> {
  const data = await getJson<Envelope<{ user_token?: string }>>(fetch, `${BASE}/token.get?${new URLSearchParams({ app_id: APP_ID })}`, {
    headers: HEADERS,
  });
  const body = data.message?.body;
  return body && typeof body === "object" && !Array.isArray(body) ? body.user_token : undefined;
}

function anonymousToken(fetch: Fetch) {
  if (!anonymous || Date.now() - anonymous.at > TOKEN_TTL_MS) {
    const entry = { token: fetchToken(fetch), at: Date.now() };
    entry.token.catch(() => anonymous === entry && resetMusixmatchToken());
    anonymous = entry;
  }
  return anonymous.token;
}

const missingToken = (options: MusixmatchOptions) =>
  new Error(
    options.t(
      "plugins.synced-lyrics.musixmatch.no-token",
      "Musixmatch only gives lyrics to signed-in apps: set a Musixmatch user token in the settings",
    ),
  );

const rejectedToken = (options: MusixmatchOptions) =>
  new Error(
    options.t("plugins.synced-lyrics.musixmatch.token-rejected", "Musixmatch rejected the user token (expired, or asking for a captcha)"),
  );

function macroUrl(query: SearchQuery, token: string) {
  const params = new URLSearchParams({
    app_id: APP_ID,
    format: "json",
    usertoken: token,
    // pear-desktop asked for the title in its original language when YTM has one.
    q_track: query.alternativeTitle || query.title,
    q_artist: query.artist,
    q_duration: String(Math.round(query.durationSeconds)),
    namespace: "lyrics_richsynched",
    subtitle_format: "lrc",
  });
  if (query.album) params.set("q_album", query.album);
  return `${BASE}/macro.subtitles.get?${params}`;
}

/** The answer, or null when Musixmatch rejected the token (stale, or a captcha). */
async function queryMacro(query: SearchQuery, fetch: Fetch, token: string): Promise<Envelope<MacroBody> | null> {
  const data = await getJson<Envelope<MacroBody>>(fetch, macroUrl(query, token), { headers: HEADERS });
  const status = data.message?.header?.status_code;
  if (status === 401) return null;
  if (status !== 200) throw new Error(`Musixmatch answered ${status ?? "nothing"}`);
  return data;
}

export async function musixmatch(query: SearchQuery, fetch: Fetch, options: MusixmatchOptions): Promise<LyricResult | null> {
  const userMode = options.tokenMode === "user";
  const token = userMode ? options.userToken.trim() : await anonymousToken(fetch);
  if (!isUsableToken(token)) throw missingToken(options);

  let data = await queryMacro(query, fetch, token);
  if (!data) {
    // A user token is the only source in user mode, so never fall back to the
    // app's own token. The auto token lives a minute: ask for a fresh one and
    // retry once.
    if (userMode) throw rejectedToken(options);
    resetMusixmatchToken();
    const fresh = await anonymousToken(fetch);
    if (!isUsableToken(fresh)) throw missingToken(options);
    data = await queryMacro(query, fetch, fresh);
    if (!data) throw rejectedToken(options);
  }
  return parseMacro(data, query);
}

const bodyOf = (envelope: Envelope<Record<string, any>> | undefined) => {
  const body = envelope?.message?.body;
  // Calls without a result answer an empty array or string instead of an object.
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, any>) : undefined;
};

/** The track, lyrics and LRC of a macro.subtitles.get answer, if it's the track asked for. */
export function parseMacro(data: Envelope<MacroBody>, query: SearchQuery): LyricResult | null {
  const body = data.message?.body;
  const calls = body && typeof body === "object" && !Array.isArray(body) ? (body as MacroBody).macro_calls : undefined;
  if (!calls) return null;
  const track = bodyOf(calls["matcher.track.get"])?.track as
    | { track_id: number; track_name: string; artist_name: string; instrumental?: number }
    | undefined;
  if (!track || track.track_id === FALLBACK_TRACK_ID || track.instrumental === 1) return null;
  const minArtist = query.inexact ? 0.75 : 0.85;
  if (queryTitleSimilarity(track.track_name, query) < 0.8 || queryArtistSimilarity(track.artist_name, query) < minArtist) return null;

  const lyrics = bodyOf(calls["track.lyrics.get"])?.lyrics as { lyrics_body?: string; instrumental?: number } | undefined;
  if (lyrics?.instrumental === 1) return null;
  const subtitle = bodyOf(calls["track.subtitles.get"])?.subtitle_list?.[0]?.subtitle as { subtitle_body?: string } | undefined;

  const lines = subtitle?.subtitle_body ? parseLrc(subtitle.subtitle_body, query.durationSeconds * 1000) : undefined;
  const plain = lyrics?.lyrics_body?.replace(DISCLAIMER, "").trim();
  if (!lines?.length && !plain) return null;
  const result: LyricResult = { title: track.track_name, artists: [track.artist_name] };
  if (lines?.length) result.lines = lines;
  if (plain) result.plain = plain;
  return result;
}
