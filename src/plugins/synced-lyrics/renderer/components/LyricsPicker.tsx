/* eslint-disable stylistic/no-mixed-operators */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  onCleanup,
  onMount,
  type Setter,
  Show,
  Switch,
} from 'solid-js';

import * as z from 'zod';

import { IconChevronLeft } from '@mdui/icons/chevron-left.js';
import { IconChevronRight } from '@mdui/icons/chevron-right.js';
import { IconCheckCircle } from '@mdui/icons/check-circle.js';
import { IconWarning } from '@mdui/icons/warning.js';
import { IconError } from '@mdui/icons/error.js';
import { IconStar } from '@mdui/icons/star.js';
import { IconStarBorder } from '@mdui/icons/star-border.js';

import { LitElementWrapper } from '@/solit';

import {
  type ProviderName,
  ProviderNames,
  providerNames,
  ProviderNameSchema,
  type ProviderState,
} from '../../providers';
import {
  currentLyrics,
  hasLyricText,
  lyricsStore,
  setLyricsStore,
} from '../store';
import { isChineseTranslationTarget } from '../translation-store';
import { _ytAPI } from '../index';
import { config } from '../renderer';

import type { PlayerAPIEvents } from '@/types/player-api-events';

const LocalStorageSchema = z.object({
  provider: ProviderNameSchema,
});

export const providerIdx = createMemo(() =>
  providerNames.indexOf(lyricsStore.provider),
);

const shouldSwitchProvider = (providerData: ProviderState) => {
  if (providerData.state === 'error') return true;
  if (providerData.state === 'fetching') return true;
  return providerData.state === 'done' && !hasLyricText(providerData.data);
};

const providerBias = (p: ProviderName) => {
  const state = lyricsStore.lyrics[p];
  const data = state.data;
  const hasSyncedText = data?.lines?.some((line) => line.text.trim()) ?? false;
  const hasPlainText = Boolean(data?.lyrics?.trim());
  const hasOfficialTranslation = Boolean(
    data?.translation?.lines?.some((line) => line.text.trim()) ||
    data?.translation?.lyrics?.trim(),
  );
  const cfg = config();
  const wantsOfficialChineseTranslation = Boolean(
    cfg?.translation.enabled &&
    isChineseTranslationTarget(cfg.translation.targetLanguage),
  );

  return (
    (state.state === 'done' ? 1 : -1) +
    (hasLyricText(data) ? 2 : -2) +
    (hasOfficialTranslation && wantsOfficialChineseTranslation ? 3 : 0) +
    (hasSyncedText ? 2 : -1) +
    (hasSyncedText && p === ProviderNames.YTMusic ? 1 : 0) +
    (hasPlainText ? 1 : -1)
  );
};

const pickBestProvider = () => {
  const preferred = config()?.preferredProvider;
  if (preferred) {
    const data = lyricsStore.lyrics[preferred].data;
    if (hasLyricText(data)) {
      return { provider: preferred, force: true };
    }
  }

  const providers = Array.from(providerNames);
  providers.sort((a, b) => providerBias(b) - providerBias(a));

  return { provider: providers[0], force: false };
};

const [hasManuallySwitchedProvider, setHasManuallySwitchedProvider] =
  createSignal(false);

export const LyricsPicker = (props: {
  setStickRef: Setter<HTMLElement | null>;
}) => {
  const [videoId, setVideoId] = createSignal<string | null>(null);
  const [starredProvider, setStarredProvider] =
    createSignal<ProviderName | null>(null);

  createEffect(() => {
    const id = videoId();
    if (id === null) {
      setStarredProvider(null);
      return;
    }

    const key = `ytmd-sl-starred-${id}`;
    const value = localStorage.getItem(key);
    if (!value) {
      setStarredProvider(null);
      return;
    }

    const parsedValue = (() => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })();
    const parseResult = LocalStorageSchema.safeParse(parsedValue);
    if (parseResult.success) {
      setLyricsStore('provider', parseResult.data.provider);
      setStarredProvider(parseResult.data.provider);
    } else {
      setStarredProvider(null);
    }
  });

  const toggleStar = () => {
    const id = videoId();
    if (id === null) return;

    const key = `ytmd-sl-starred-${id}`;

    setStarredProvider((starredProvider) => {
      if (lyricsStore.provider === starredProvider) {
        localStorage.removeItem(key);
        return null;
      }

      const provider = lyricsStore.provider;
      localStorage.setItem(key, JSON.stringify({ provider }));

      return provider;
    });
  };

  const videoDataChangeHandler = (
    name: string,
    { videoId }: PlayerAPIEvents['videodatachange']['value'],
  ) => {
    setVideoId(videoId);

    if (name !== 'dataloaded') return;
    setHasManuallySwitchedProvider(false);
  };

  // prettier-ignore
  {
    onMount(() => _ytAPI?.addEventListener('videodatachange', videoDataChangeHandler));
    onCleanup(() => _ytAPI?.removeEventListener('videodatachange', videoDataChangeHandler));
  }

  createEffect(() => {
    if (!hasManuallySwitchedProvider()) {
      const starred = starredProvider();
      if (starred !== null) {
        setLyricsStore('provider', starred);
        return;
      }

      const allProvidersFailed = providerNames.every((p) =>
        shouldSwitchProvider(lyricsStore.lyrics[p]),
      );
      if (allProvidersFailed) return;

      const { provider, force } = pickBestProvider();
      if (
        force ||
        providerBias(lyricsStore.provider) < providerBias(provider)
      ) {
        setLyricsStore('provider', provider);
      }
    }
  });

  const next = () => {
    setHasManuallySwitchedProvider(true);
    setLyricsStore('provider', (prevProvider) => {
      const idx = providerNames.indexOf(prevProvider);
      return providerNames[(idx + 1) % providerNames.length];
    });
  };

  const previous = () => {
    setHasManuallySwitchedProvider(true);
    setLyricsStore('provider', (prevProvider) => {
      const idx = providerNames.indexOf(prevProvider);
      return providerNames[
        (idx + providerNames.length - 1) % providerNames.length
      ];
    });
  };

  return (
    <div class="lyrics-picker" ref={props.setStickRef}>
      <div class="lyrics-picker-left">
        <mdui-button-icon>
          <LitElementWrapper
            elementClass={IconChevronLeft}
            props={{
              onClick: previous,
              role: 'button',
              style: { padding: '5px' },
            }}
          />
        </mdui-button-icon>
      </div>

      <div class="lyrics-picker-content">
        <div class="lyrics-picker-content-label">
          <Index each={providerNames}>
            {(provider) => (
              <div
                class="lyrics-picker-item"
                style={{
                  transform: `translateX(${providerIdx() * -100 - 5}%)`,
                }}
                tabindex="-1"
              >
                <Switch>
                  <Match
                    when={
                      // prettier-ignore
                      currentLyrics().state === 'fetching'
                    }
                  >
                    <tp-yt-paper-spinner-lite
                      active
                      class="loading-indicator style-scope"
                      style={{ padding: '5px', transform: 'scale(0.5)' }}
                      tabindex="-1"
                    />
                  </Match>
                  <Match when={currentLyrics().state === 'error'}>
                    <LitElementWrapper
                      elementClass={IconError}
                      props={{ style: { padding: '5px', scale: '0.8' } }}
                    />
                  </Match>
                  <Match
                    when={
                      currentLyrics().state === 'done' &&
                      hasLyricText(currentLyrics().data)
                    }
                  >
                    <LitElementWrapper
                      elementClass={IconCheckCircle}
                      props={{ style: { padding: '5px', scale: '0.8' } }}
                    />
                  </Match>
                  <Match
                    when={
                      currentLyrics().state === 'done' &&
                      !hasLyricText(currentLyrics().data)
                    }
                  >
                    <LitElementWrapper
                      elementClass={IconWarning}
                      props={{ style: { padding: '5px', scale: '0.8' } }}
                    />
                  </Match>
                </Switch>
                <yt-formatted-string
                  class="description ytmusic-description-shelf-renderer"
                  text={{ runs: [{ text: provider() }] }}
                />
                <mdui-button-icon onClick={toggleStar} tabindex={-1}>
                  <Show
                    fallback={
                      <LitElementWrapper elementClass={IconStarBorder} />
                    }
                    when={starredProvider() === provider()}
                  >
                    <LitElementWrapper elementClass={IconStar} />
                  </Show>
                </mdui-button-icon>
              </div>
            )}
          </Index>
        </div>

        <ul class="lyrics-picker-content-dots">
          <For each={providerNames}>
            {(_, idx) => (
              <li
                class="lyrics-picker-dot"
                onClick={() => setLyricsStore('provider', providerNames[idx()])}
                style={{
                  background: idx() === providerIdx() ? 'white' : 'black',
                }}
              />
            )}
          </For>
        </ul>
      </div>

      <div class="lyrics-picker-left">
        <mdui-button-icon>
          <LitElementWrapper
            elementClass={IconChevronRight}
            props={{
              onClick: next,
              role: 'button',
              style: { padding: '5px' },
            }}
          />
        </mdui-button-icon>
      </div>
    </div>
  );
};
