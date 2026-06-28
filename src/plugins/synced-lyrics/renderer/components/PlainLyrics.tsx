import { createEffect, createMemo, createSignal, Show } from 'solid-js';

import { config } from '../renderer';
import { lyricsStore } from '../store';
import { getLineTranslation } from '../translation-store';
import {
  canonicalize,
  convertChineseCharacter,
  romanize,
  simplifyUnicode,
} from '../utils';

interface PlainLyricsProps {
  line: string;
  index: number;
}

export const PlainLyrics = (props: PlainLyricsProps) => {
  const [romanization, setRomanization] = createSignal('');
  const text = createMemo(() => {
    let line = props.line;
    const convertChineseText = config()?.convertChineseCharacter;
    if (convertChineseText && convertChineseText !== 'disabled') {
      line = convertChineseCharacter(line, convertChineseText);
    }
    return line;
  });

  createEffect(() => {
    if (!config()?.romanization) return;

    const input = canonicalize(text());
    romanize(input).then((result) => {
      setRomanization(canonicalize(result));
    });
  });

  const translation = createMemo(() => {
    if (!config()?.translation?.enabled) return '';
    const videoId = lyricsStore.videoId;
    if (!videoId) return '';
    return getLineTranslation(videoId, props.index) ?? '';
  });

  return (
    <div
      class={`${
        props.line.match(/^\[.+\]$/s) ? 'lrc-header' : ''
      } text-lyrics description ytmusic-description-shelf-renderer`}
      style={{
        'display': 'flex',
        'flex-direction': 'column',
      }}
    >
      <yt-formatted-string
        text={{
          runs: [{ text: text() }],
        }}
      />
      <Show
        when={
          config()?.romanization &&
          simplifyUnicode(text()) !== simplifyUnicode(romanization())
        }
      >
        <yt-formatted-string
          class="romaji"
          text={{
            runs: [{ text: romanization() }],
          }}
        />
      </Show>
      <Show
        when={
          translation() &&
          simplifyUnicode(text()) !== simplifyUnicode(translation())
        }
      >
        <yt-formatted-string
          class="translation"
          text={{
            runs: [{ text: translation() }],
          }}
        />
      </Show>
    </div>
  );
};
