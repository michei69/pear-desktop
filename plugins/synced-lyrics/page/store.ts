// Page-side lyrics state: per-provider results for the current track, which one
// is selected in the picker, its romanization and its translation. Framework-free;
// the view subscribes to it.
//
// Selection follows the configured provider order (or the preferred provider
// when the order is off) until the user switches by hand for this track, and a
// starred provider is always shown for its track, as in pear-desktop.

import type { Track } from "@pear/sdk";
import { remoteErrorMessage } from "@pear/sdk/util";
import { parseLrc } from "../lrc.ts";
import { pickProvider, resolvePriority } from "../priority.ts";
import { isChineseTarget } from "../translation/language.ts";
import {
  PROVIDERS,
  resultRank,
  type CustomQuery,
  type LyricLine,
  type LyricResult,
  type LyricTranslation,
  type ProviderId,
  type SearchQuery,
} from "../types.ts";

export type ProviderState = { status: "loading" } | { status: "done"; result: LyricResult | null } | { status: "error"; message: string };

export interface TranslationOptions {
  enabled: boolean;
  targetLanguage: string;
}

export interface Options {
  preferred: ProviderId | "auto";
  inexact: boolean;
  romanize: boolean;
  chinese: "off" | "s2t" | "t2s";
  /** The user's provider order; see `resolvePriority`. */
  priority?: readonly string[];
  usePriorityList?: boolean;
  preferSynced?: boolean;
  translation?: TranslationOptions;
}

export interface TranslateRequest {
  videoId: string;
  title: string;
  artists: string[];
  lines: string[];
  language: string;
}

export interface TranslateResponse {
  lines: string[];
  fromCache?: boolean;
  sameLanguage?: boolean;
  error?: string;
}

export interface Backend {
  search(provider: ProviderId, query: SearchQuery): Promise<LyricResult | null>;
  /** The playing track's original-language title and tags, when the page knows them. */
  details?(videoId: string): { alternativeTitle?: string; tags: string[] } | null;
  romanize(lines: string[]): Promise<(string | null)[]>;
  convertChinese(lines: string[], mode: "s2t" | "t2s"): Promise<string[]>;
  translate?(request: TranslateRequest): Promise<TranslateResponse>;
  customQuery?(videoId: string): Promise<CustomQuery | null>;
  setCustomQuery?(videoId: string, query: CustomQuery): Promise<unknown>;
  removeCustomQuery?(videoId: string): Promise<unknown>;
}

export interface Shown {
  provider: ProviderId;
  result: LyricResult;
  /** Synced lines, or plain lines with zero timing. */
  lines: LyricLine[];
  synced: boolean;
  /** Display text per line after script conversion. */
  texts: string[];
  /** Romanization per line (null where not applicable). */
  romanized: (string | null)[];
  /** Translation per line (null where there is none). */
  translation: (string | null)[];
}

// pear-desktop's key and format, so stars carry over.
const starKey = (videoId: string) => `ytmd-sl-starred-${videoId}`;

const NON_LATIN = /[^\p{Script=Latin}\p{P}\p{N}\s]/u;

const translationKey = (options: Options) =>
  options.translation ? `${options.translation.enabled}:${options.translation.targetLanguage}` : "off";

/** The target language as the page sees it (the API resolves `auto` on the host). */
function pageTargetLanguage(options: Options) {
  const target = options.translation?.targetLanguage ?? "auto";
  if (target !== "auto") return target;
  const documentLanguage = typeof document === "undefined" ? undefined : document.documentElement?.lang;
  const browserLanguage = typeof navigator === "undefined" ? undefined : navigator.language;
  return (documentLanguage || browserLanguage || "en").replace("_", "-") || "en";
}

export class LyricsStore {
  track: Track | null = null;
  providers = initialProviders();
  /** The provider in the picker; kept from track to track. */
  selected: ProviderId;
  /** Whether the user switched provider by hand for this track. */
  manual = false;
  /** The provider always shown for this track. */
  starred: ProviderId | null = null;
  /** The custom search saved for this track, if any. */
  customQuery: CustomQuery | null = null;
  /** The selected provider's lyrics, when it has some. */
  shown: Shown | null = null;

  #options: Options;
  #backend: Backend;
  #priority: ProviderId[];
  #listeners = new Set<() => void>();
  #generation = 0;
  #shownKey = "";
  /** Invalidates async romanization and translation when the shown lyrics change. */
  #run = 0;
  /** Whether lyrics are wanted (the tab is open); searches wait until then. */
  #active: boolean;
  /** The track (by generation) whose searches have started. */
  #searched = -1;

  constructor(backend: Backend, options: Options, active = true) {
    this.#backend = backend;
    this.#options = options;
    this.#priority = resolvePriority(options.priority);
    this.#active = active;
    this.selected = options.preferred === "auto" ? this.#priority[0]! : options.preferred;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  get loading() {
    return PROVIDERS.some((id) => this.providers[id].status === "loading");
  }

  /** The selected provider's search. */
  get current(): ProviderState {
    return this.providers[this.selected];
  }

  setOptions(options: Options) {
    const previous = this.#options;
    this.#options = options;
    this.#priority = resolvePriority(options.priority);
    if (previous.inexact !== options.inexact) return void this.load(this.track, true);
    if (
      previous.romanize !== options.romanize ||
      previous.chinese !== options.chinese ||
      translationKey(previous) !== translationKey(options)
    ) {
      this.#shownKey = "";
    }
    this.#update();
  }

  load(track: Track | null, force = false) {
    if (!force && track?.videoId === this.track?.videoId) return;
    ++this.#generation;
    this.track = track;
    this.providers = initialProviders();
    this.manual = false;
    this.starred = track ? readStar(track.videoId) : null;
    this.customQuery = null;
    this.selected = this.starred ?? (this.#options.preferred === "auto" ? this.#priority[0]! : this.#options.preferred);
    this.#shownKey = "";
    this.shown = null;
    this.#emit();
    this.#searchAll();
  }

  /** While inactive, a track's lyrics are only looked up once they become wanted. */
  setActive(active: boolean) {
    this.#active = active;
    this.#searchAll();
  }

  #searchAll() {
    const { track } = this;
    if (!this.#active || !track || this.#searched === this.#generation) return;
    this.#searched = this.#generation;
    const generation = this.#generation;

    if (!this.#backend.customQuery) {
      for (const id of this.#priority) void this.#search(id, track, generation);
      return;
    }

    void (async () => {
      let custom: CustomQuery | null = null;
      try {
        custom = (await this.#backend.customQuery?.(track.videoId)) ?? null;
      } catch (error) {
        console.warn("[pear:synced-lyrics] could not read the custom query", error);
      }
      if (generation !== this.#generation) return;
      this.customQuery = custom;
      this.#emit();
      for (const id of this.#priority) void this.#search(id, track, generation);
    })();
  }

  retry(provider: ProviderId) {
    if (!this.track) return;
    this.providers = { ...this.providers, [provider]: { status: "loading" } };
    this.#emit();
    void this.#search(provider, this.track, this.#generation);
  }

  /** Switches to a provider by hand (the picker's arrows and dots). */
  select(provider: ProviderId) {
    this.manual = true;
    this.selected = provider;
    this.#update();
  }

  /** Moves the picker by `step` providers, wrapping around. */
  step(step: number) {
    const index = PROVIDERS.indexOf(this.selected);
    this.select(PROVIDERS[(index + step + PROVIDERS.length) % PROVIDERS.length]!);
  }

  /** Stars the selected provider for this track, or unstars it. */
  toggleStar() {
    if (!this.track) return;
    this.starred = this.starred === this.selected ? null : this.selected;
    writeStar(this.track.videoId, this.starred);
    this.#emit();
    this.#update();
  }

  /** Saves a custom search for this track and searches again with it. */
  async saveCustomQuery(query: CustomQuery) {
    const track = this.track;
    if (!track) return;
    const text = query.query.trim();
    if (!text) return;
    const value: CustomQuery = { query: text, ...(query.artist?.trim() ? { artist: query.artist.trim() } : {}) };
    try {
      await this.#backend.setCustomQuery?.(track.videoId, value);
    } catch (error) {
      console.warn("[pear:synced-lyrics] could not save the custom query", error);
    }
    this.customQuery = value;
    this.load(track, true);
  }

  /** Removes the track's custom search and searches again with the track's own metadata. */
  async clearCustomQuery() {
    const track = this.track;
    if (!track) return;
    try {
      await this.#backend.removeCustomQuery?.(track.videoId);
    } catch (error) {
      console.warn("[pear:synced-lyrics] could not remove the custom query", error);
    }
    this.customQuery = null;
    this.load(track, true);
  }

  /** The provider to follow automatically: the starred/priority/preferred one, else the richest result. */
  choose(): ProviderId {
    const results: Partial<Record<ProviderId, LyricResult | null>> = {};
    for (const id of PROVIDERS) {
      const state = this.providers[id];
      results[id] = state.status === "done" ? state.result : null;
    }
    return pickProvider({
      priority: this.#priority,
      results,
      usePriorityList: this.#options.usePriorityList ?? false,
      preferSynced: this.#options.preferSynced ?? true,
      preferred: this.#options.preferred,
      starred: this.starred,
    });
  }

  #rank(provider: ProviderId) {
    const state = this.providers[provider];
    return state.status === "done" ? resultRank(state.result) : 0;
  }

  async #search(provider: ProviderId, track: Track, generation: number) {
    const custom = this.customQuery;
    const query: SearchQuery = {
      videoId: track.videoId,
      title: custom?.query ?? track.title,
      artist: custom ? (custom.artist ?? "") : track.artist,
      durationSeconds: track.durationSeconds,
      inexact: this.#options.inexact,
    };
    if (track.album) query.album = track.album;
    if (custom) {
      query.alternativeTitle = custom.query;
    } else {
      const details = this.#backend.details?.(track.videoId);
      if (details?.alternativeTitle && details.alternativeTitle !== track.title) query.alternativeTitle = details.alternativeTitle;
      if (details?.tags.length) query.tags = details.tags;
    }
    let state: ProviderState;
    try {
      state = { status: "done", result: await this.#backend.search(provider, query) };
    } catch (error) {
      // Searches run in the host; the message is the provider's, without the IPC wrapper.
      state = { status: "error", message: remoteErrorMessage(error) };
    }
    if (generation !== this.#generation) return;
    this.providers = { ...this.providers, [provider]: state };
    this.#update();
  }

  #update() {
    if (this.starred && this.#rank(this.starred) > 0) this.selected = this.starred;
    else if (!this.manual) {
      const auto = this.choose();
      // Only move to something better, so the picker doesn't jump between equals.
      if (auto && (this.#options.usePriorityList || auto === this.#options.preferred || this.#rank(auto) > this.#rank(this.selected))) {
        this.selected = auto;
      }
    }
    const provider = this.selected;
    const state = this.providers[provider];
    const result = state.status === "done" && resultRank(state.result) > 0 ? state.result : null;
    if (!result) {
      this.shown = null;
      this.#shownKey = "";
      ++this.#run;
      return this.#emit();
    }
    const key = `${this.track?.videoId}:${provider}`;
    if (key === this.#shownKey) return this.#emit();
    this.#shownKey = key;

    const synced = !!result.lines?.length;
    const lines = synced ? result.lines! : (result.plain ?? "").split("\n").map((text) => ({ startMs: 0, endMs: 0, text: text.trim() }));
    const texts = lines.map((line) => line.text);
    const target = pageTargetLanguage(this.#options);
    const translation = this.#options.translation;
    const official =
      translation?.enabled && isChineseTarget(translation.targetLanguage, target) ? officialTranslation(result, texts) : null;
    this.shown = {
      provider,
      result,
      lines,
      synced,
      texts,
      romanized: texts.map(() => null),
      translation: official ?? texts.map(() => null),
    };
    const run = ++this.#run;
    this.#emit();
    void this.#transform(run, result, texts);
    void this.#translate(run, result, lines, target);
  }

  async #transform(run: number, result: LyricResult, original: string[]) {
    const { chinese, romanize } = this.#options;
    try {
      let texts = original;
      if (chinese !== "off") {
        texts = await this.#backend.convertChinese(original, chinese);
        if (run !== this.#run || !this.shown) return;
        this.shown = { ...this.shown, texts };
        this.#emit();
      }
      if (romanize) {
        const official = result.romanization?.length === texts.length ? result.romanization : null;
        const romanized: (string | null)[] = official ? [...official] : texts.map(() => null);
        const missing = texts.map((text, i) => (romanized[i] ? "" : text));
        if (missing.some((text) => NON_LATIN.test(text))) {
          const filled = await this.#backend.romanize(missing);
          missing.forEach((text, i) => {
            if (text && filled[i]) romanized[i] = filled[i]!;
          });
        }
        if (run !== this.#run || !this.shown) return;
        this.shown = { ...this.shown, romanized };
        this.#emit();
      }
    } catch (error) {
      console.warn("[pear:synced-lyrics] romanization failed", error);
    }
  }

  async #translate(run: number, result: LyricResult, lines: LyricLine[], target: string) {
    const options = this.#options.translation;
    const track = this.track;
    if (!options?.enabled || !this.#backend.translate || !track) return;
    try {
      const response = await this.#backend.translate({
        videoId: track.videoId,
        title: result.title || track.title,
        artists: result.artists.length ? result.artists : [track.artist],
        lines: lines.map((line) => line.text),
        language: target,
      });
      if (run !== this.#run || !this.shown) return;
      if (!response.lines.length || response.lines.length !== lines.length) return;
      this.shown = { ...this.shown, translation: response.lines };
      this.#emit();
    } catch (error) {
      // Translation is decoration: a failure must leave the lyrics untouched.
      console.warn("[pear:synced-lyrics] translation failed", error);
    }
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}

function initialProviders(): Record<ProviderId, ProviderState> {
  return Object.fromEntries(PROVIDERS.map((id) => [id, { status: "loading" }])) as Record<ProviderId, ProviderState>;
}

/**
 * The official translation, aligned to the source lines: by timestamp for timed
 * lyrics, then by index, then from a plain-lyrics block.
 */
function officialTranslation(result: LyricResult, sourceTexts: readonly string[]) {
  const translation: LyricTranslation | undefined = result.translation;
  if (!translation) return null;

  if (result.lines?.length && translation.lines?.length) {
    const byTime = alignSyncedTranslations(result.lines, translation.lines);
    if (byTime) return byTime;
    const byIndex = alignIndexTranslations(
      result.lines.map((line) => line.text),
      translation.lines.map((line) => line.text),
    );
    if (byIndex) return byIndex;
  }

  if (translation.plain?.trim()) {
    return alignIndexTranslations(sourceTexts, splitTranslatedLyrics(translation.plain));
  }
  return null;
}

/** Pair each source line with the closest translation, accepting at least 60% of them. */
function alignSyncedTranslations(source: readonly LyricLine[], translation: readonly LyricLine[]): string[] | null {
  const output = source.map(() => "");
  const translated = translation.filter((line) => line.text.trim());
  const sourceTextLines = source.filter((line) => line.text.trim()).length;
  let matches = 0;
  let index = 0;

  for (const [sourceIndex, sourceLine] of source.entries()) {
    if (!sourceLine.text.trim()) continue;
    while (index < translated.length) {
      const current = translated[index]!;
      const next = translated[index + 1];
      if (!next) break;
      const currentDelta = Math.abs(current.startMs - sourceLine.startMs);
      const nextDelta = Math.abs(next.startMs - sourceLine.startMs);
      if (nextDelta >= currentDelta) break;
      index += 1;
    }
    const match = translated[index];
    if (!match) break;
    if (Math.abs(match.startMs - sourceLine.startMs) <= 350) {
      output[sourceIndex] = match.text.trim();
      matches += 1;
      index += 1;
    }
  }

  const comparable = Math.min(sourceTextLines, translated.length);
  return matches >= 3 && matches / Math.max(1, comparable) >= 0.6 ? output : null;
}

/** Align a translation list by line index, skipping empty source lines when the counts differ. */
function alignIndexTranslations(source: readonly string[], translation: readonly string[]): string[] | null {
  const output = source.map(() => "");
  const sourceIndexes = source.flatMap((line, index) => (line.trim() ? [index] : []));
  const nonEmpty = translation.map((line) => line.trim()).filter(Boolean);

  if (translation.length === source.length && nonEmpty.length >= Math.min(3, sourceIndexes.length)) {
    return translation.map((line) => line.trim());
  }
  if (nonEmpty.length === sourceIndexes.length) {
    sourceIndexes.forEach((sourceIndex, i) => {
      output[sourceIndex] = nonEmpty[i]!;
    });
    return output;
  }
  return null;
}

function splitTranslatedLyrics(plain: string) {
  const parsed = parseLrc(plain);
  if (parsed.some((line) => line.text.trim())) return parsed.map((line) => line.text);
  return plain.split(/\r?\n/).map((line) => line.replace(/^\[\d+:\d+[.:]\d+\]\s*/, "").trim());
}

// localStorage can be unavailable (or throw); a forgotten star is harmless.
function readStar(videoId: string): ProviderId | null {
  try {
    const value = JSON.parse(localStorage.getItem(starKey(videoId)) ?? "null") as unknown;
    if (!value || typeof value !== "object" || !("provider" in value)) return null;
    return (PROVIDERS as readonly unknown[]).includes(value.provider) ? (value.provider as ProviderId) : null;
  } catch {
    return null;
  }
}

function writeStar(videoId: string, provider: ProviderId | null) {
  try {
    if (provider) localStorage.setItem(starKey(videoId), JSON.stringify({ provider }));
    else localStorage.removeItem(starKey(videoId));
  } catch {}
}
