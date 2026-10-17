import {
  hasLyricText,
  providerNames,
  type ProviderName,
  type ProviderState,
} from '@/plugins/synced-lyrics/providers';

import type { LineLyrics, LyricResult } from '@/plugins/synced-lyrics/types';

/** One line of synced lyrics, minus the UI-only `status` field. */
export type LyricsLine = Pick<
  LineLyrics,
  'time' | 'timeInMs' | 'duration' | 'text'
>;

/** One provider's lyrics for the current song. */
export type LyricsProviderResult = {
  provider: ProviderName;
  state: ProviderState['state'];
  title: string;
  artists: string[];
  lyrics?: string;
  lines?: LyricsLine[];
  translation?: {
    lyrics?: string;
    lines?: LyricsLine[];
    language?: string;
    provider?: string;
  };
};

/** Every provider that found lyrics, plus the one the UI is showing. */
export type LyricsReply = {
  videoId: string | null;
  activeProvider: ProviderName | null;
  providers: LyricsProviderResult[];
};

/** Synced lines as the API reports them: no UI-only `status` field. */
const lyricLines = (lines?: LineLyrics[]) =>
  lines?.map(({ time, timeInMs, duration, text }) => ({
    time,
    timeInMs,
    duration,
    text,
  }));

/** A provider's result, or nothing when it found no lyrics at all. */
const lyricsProvider = (
  provider: ProviderName,
  state: ProviderState['state'],
  data: LyricResult | null,
): LyricsProviderResult | undefined => {
  if (!hasLyricText(data)) return undefined;

  const result = data as LyricResult;
  const translation = result.translation;
  const translationLines = lyricLines(translation?.lines);

  return {
    provider,
    state,
    title: result.title,
    artists: result.artists,
    ...(result.lyrics && { lyrics: result.lyrics }),
    ...(result.lines?.length && { lines: lyricLines(result.lines) }),
    // Only carry a translation that has something in it.
    ...((translationLines?.length || translation?.lyrics) && {
      translation: { ...translation, lines: translationLines },
    }),
  };
};

/**
 * Every provider's lyrics, for the current song or for `videoId` — what
 * `GET /video/lyrics` answers with, and what `LYRICS_CHANGED` broadcasts. The
 * store is imported dynamically: it has top-level Solid side effects, so with
 * the plugin off it must not be evaluated at all.
 */
export const getLyricsReply = async (
  videoId?: string,
): Promise<LyricsReply | null> => {
  try {
    if (!(await window.mainConfig.plugins.isEnabled('synced-lyrics'))) {
      return null;
    }

    const store = await import('@/plugins/synced-lyrics/renderer/store');
    const target = videoId ?? store.currentLyricsVideoId();
    const states = videoId
      ? await store.lyricsForVideo(videoId)
      : await store.allProviderLyrics();
    const chosen = videoId ? store.pickProvider(videoId, states) : null;

    return {
      videoId: target,
      activeProvider:
        target === null
          ? null
          : videoId
            ? chosen && hasLyricText(states[chosen]?.data)
              ? chosen
              : null
            : store.lyricsStore.provider,
      providers: providerNames.flatMap((provider) => {
        const state = states[provider];
        const entry =
          state && lyricsProvider(provider, state.state, state.data);

        return entry ? [entry] : [];
      }),
    };
  } catch (error) {
    console.error('[api-server] getLyrics failed:', error);
    return null;
  }
};
