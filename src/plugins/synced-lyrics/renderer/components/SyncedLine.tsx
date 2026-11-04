import {
  createEffect,
  For,
  Show,
  createSignal,
  createMemo,
  onCleanup,
} from 'solid-js';
import { type VirtualizerHandle } from 'virtua/solid';

import { type LineLyrics, type LyricWord } from '@/plugins/synced-lyrics/types';

import { _ytAPI } from '..';
import { config, currentTime, getPlaybackTime } from '../renderer';
import { lyricsStore } from '../store';
import { getLineTranslation } from '../translation-store';
import {
  canonicalize,
  convertChineseCharacter,
  romanize,
  simplifyUnicode,
} from '../utils';

interface SyncedLineProps {
  scroller: VirtualizerHandle;
  index: number;

  line: LineLyrics;
  status: 'upcoming' | 'current' | 'previous';
}

const EmptyLine = (props: SyncedLineProps) => {
  const states = createMemo(() => {
    const defaultText = config()?.defaultTextString ?? '';
    return Array.isArray(defaultText) ? defaultText : [defaultText];
  });

  const index = createMemo(() => {
    const progress = currentTime() - props.line.timeInMs;
    const total = props.line.duration;

    const percentage = Math.min(1, progress / total);
    return Math.max(0, Math.floor((states().length - 1) * percentage));
  });

  return (
    <div
      class={`synced-line ${props.status}`}
      onClick={() => {
        _ytAPI?.seekTo((props.line.timeInMs + 10) / 1000);
      }}
    >
      <div class="description ytmusic-description-shelf-renderer" dir="auto">
        <yt-formatted-string
          text={{
            runs: [
              {
                text: config()?.showTimeCodes ? `[${props.line.time}] ` : '',
              },
            ],
          }}
        />

        <div class="text-lyrics">
          <span>
            <span>
              <Show
                fallback={
                  <yt-formatted-string
                    text={{ runs: [{ text: states()[0] }] }}
                  />
                }
                when={states().length > 1}
              >
                <yt-formatted-string
                  text={{
                    runs: [
                      {
                        text: states().at(
                          props.status === 'current' ? index() : -1,
                        )!,
                      },
                    ],
                  }}
                />
              </Show>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
};

export const SyncedLine = (props: SyncedLineProps) => {
  const text = createMemo(() => {
    let line = props.line.text;
    const convertChineseText = config()?.convertChineseCharacter;
    if (convertChineseText && convertChineseText !== 'disabled') {
      line = convertChineseCharacter(line, convertChineseText);
    }
    return line.trim();
  });

  const [romanization, setRomanization] = createSignal('');
  createEffect(() => {
    const input = canonicalize(text());
    if (!config()?.romanization) return;

    romanize(input)
      .then((result) => {
        setRomanization(canonicalize(result));
      })
      .catch(() => {
        // Romanization is best-effort — keep the previous value on failure
      });
  });

  // The list is [lyricsPicker, ...lines], so the lyric line index is `props.index - 1`.
  const translation = createMemo(() => {
    if (!config()?.translation?.enabled) return '';
    const videoId = lyricsStore.videoId;
    if (!videoId) return '';
    const lyricIndex = props.index - 1;
    return getLineTranslation(videoId, lyricIndex) ?? '';
  });

  // Timed words let every effect step each word on as it is sung.
  const timedWords = () => Boolean(props.line.words?.length);
  const hasContent = () => Boolean(text() || props.line.background?.length);

  /** Word element per timing, filled in by the karaoke loop below. */
  const wordElements = new Map<LyricWord, HTMLElement>();

  // Timed words light up as they are sung, on animation frames between the
  // player's ~4 Hz progress ticks so each word lands on time.
  createEffect(() => {
    const line = props.line;
    const status = props.status;
    const words = [...(line.words ?? []), ...(line.background ?? [])];
    if (!words.length || status !== 'current') return;

    const sung = new Map<LyricWord, boolean>();
    let frame = 0;

    const tick = () => {
      const time = getPlaybackTime();

      for (const word of words) {
        const element = wordElements.get(word);
        if (!element) continue;

        const isSung = time >= word.timeInMs;
        if (sung.get(word) !== isSung) {
          sung.set(word, isSung);
          element.classList.toggle('sung', isSung);
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const wordSpans = (words: LyricWord[]) => (
    <For each={words}>
      {(word) => {
        const trimmed = word.text.trimEnd();
        return (
          <>
            <span
              class="lyrics-word"
              ref={(element: HTMLElement) => wordElements.set(word, element)}
            >
              {trimmed}
            </span>
            {trimmed === word.text ? undefined : ' '}
          </>
        );
      }}
    </For>
  );

  return (
    <Show fallback={<EmptyLine {...props} />} when={hasContent()}>
      <div
        class={`synced-line ${props.status}${
          timedWords() ? ' word-synced' : ''
        }${props.line.alignment === 'end' ? ' singer-right' : ''}${
          props.line.rtl ? ' rtl-text' : ''
        }`}
        onClick={() => {
          _ytAPI?.seekTo((props.line.timeInMs + 10) / 1000);
        }}
      >
        <div class="description ytmusic-description-shelf-renderer">
          <yt-formatted-string
            text={{
              runs: [
                {
                  text: config()?.showTimeCodes ? `[${props.line.time}] ` : '',
                },
              ],
            }}
          />
          <div
            class="text-lyrics"
            ref={(div: HTMLDivElement) => {
              // TODO: Investigate the animation, even though the duration is properly set, all lines have the same animation duration
              // guard against non-finite durations (the last line has duration: Infinity)
              const duration = Number.isFinite(props.line.duration)
                ? props.line.duration
                : 0;
              div.style.setProperty(
                '--lyrics-duration',
                `${duration / 1000}s`,
                'important',
              );
            }}
            style={{ 'display': 'flex', 'flex-direction': 'column' }}
          >
            <Show
              fallback={
                <span dir="auto">
                  <For each={text().split(' ')}>
                    {(word, index) => {
                      return (
                        <span
                          style={{
                            'transition-delay': `${index() * 0.05}s`,
                            'animation-delay': `${index() * 0.05}s`,
                          }}
                        >
                          <yt-formatted-string
                            text={{
                              runs: [{ text: `${word} ` }],
                            }}
                          />
                        </span>
                      );
                    }}
                  </For>
                </span>
              }
              when={timedWords()}
            >
              <span class="lyrics-words" dir={props.line.rtl ? 'rtl' : 'auto'}>
                {wordSpans(props.line.words!)}
              </span>
            </Show>

            <Show when={props.line.background?.length}>
              <span
                class="background-vocals"
                dir={props.line.rtl ? 'rtl' : 'auto'}
              >
                {wordSpans(props.line.background!)}
              </span>
            </Show>

            <Show
              when={
                config()?.romanization &&
                simplifyUnicode(text()) !== simplifyUnicode(romanization())
              }
            >
              <span class="romaji" dir="auto">
                <For each={romanization().split(' ')}>
                  {(word, index) => {
                    return (
                      <span
                        style={{
                          'transition-delay': `${index() * 0.05}s`,
                          'animation-delay': `${index() * 0.05}s`,
                        }}
                      >
                        <yt-formatted-string
                          text={{
                            runs: [{ text: `${word} ` }],
                          }}
                        />
                      </span>
                    );
                  }}
                </For>
              </span>
            </Show>

            <Show
              when={
                translation() &&
                simplifyUnicode(text()) !== simplifyUnicode(translation())
              }
            >
              <span class="translation" dir="auto">
                <For each={translation().split(' ')}>
                  {(word, index) => {
                    return (
                      <span
                        style={{
                          'transition-delay': `${index() * 0.05}s`,
                          'animation-delay': `${index() * 0.05}s`,
                        }}
                      >
                        <yt-formatted-string
                          text={{
                            runs: [{ text: `${word} ` }],
                          }}
                        />
                      </span>
                    );
                  }}
                </For>
              </span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
