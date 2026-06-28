/* oxlint-disable @stylistic/no-mixed-operators */
import { IconCheckCircle } from '@mdui/icons/check-circle.js';
import { IconChevronLeft } from '@mdui/icons/chevron-left.js';
import { IconChevronRight } from '@mdui/icons/chevron-right.js';
import { IconError } from '@mdui/icons/error.js';
import { IconSearch } from '@mdui/icons/search.js';
import { IconStarBorder } from '@mdui/icons/star-border.js';
import { IconStar } from '@mdui/icons/star.js';
import { IconWarning } from '@mdui/icons/warning.js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  onCleanup,
  onMount,
  runWithOwner,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import * as z from 'zod';

import { getSongInfo } from '@/providers/song-info-front';
import { LitElementWrapper } from '@/solit';

import {
  type ProviderName,
  ProviderNames,
  providerNames,
  ProviderNameSchema,
  type ProviderState,
} from '../../providers';
import {
  customQuery,
  loadCustomQueryForVideo,
  removeCustomQuery,
  saveCustomQuery,
} from '../custom-query-store';
import { _ytAPI } from '../index';
import { reactiveOwner } from '../reactive-root';
import { config } from '../renderer';
import {
  clearSearchCacheForVideo,
  currentLyrics,
  hasLyricText,
  lyricsStore,
  refreshCurrentLyrics,
  setLyricsStore,
} from '../store';
import { isChineseTranslationTarget } from '../translation-store';

import type { PlayerAPIEvents } from '@/types/player-api-events';
import type { VideoDataChanged } from '@/types/video-data-changed';

const LocalStorageSchema = z.object({
  provider: ProviderNameSchema,
});

export const providerIdx = runWithOwner(reactiveOwner, () =>
  createMemo(() => providerNames.indexOf(lyricsStore.provider)),
)!;

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
      loadCustomQueryForVideo(null);
      return;
    }

    const key = `ytmd-sl-starred-${id}`;
    const value = localStorage.getItem(key);
    if (!value) {
      setStarredProvider(null);
    } else {
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
    }

    loadCustomQueryForVideo(id);
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

  // Custom query modal
  const [showSearchModal, setShowSearchModal] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchArtist, setSearchArtist] = createSignal('');

  const openSearchModal = () => {
    const info = getSongInfo();
    const existing = customQuery();
    setSearchQuery(existing?.query || info?.title || '');
    setSearchArtist(
      existing?.artist ??
        (info?.artist || currentLyrics()?.data?.artists?.[0] || ''),
    );
    setShowSearchModal(true);
  };

  const closeSearchModal = () => setShowSearchModal(false);

  const submitCustomQuery = (e: Event) => {
    e.preventDefault();
    const id = videoId();
    if (!id) return;

    const q = searchQuery().trim();
    if (!q) return;

    saveCustomQuery(id, {
      query: q,
      artist: searchArtist().trim() || undefined,
    });
    loadCustomQueryForVideo(id);
    clearSearchCacheForVideo(id);
    refreshCurrentLyrics('custom-query-change');
    closeSearchModal();
  };

  const clearCustomQueryAction = () => {
    const id = videoId();
    if (!id) return;
    removeCustomQuery(id);
    loadCustomQueryForVideo(id);
    clearSearchCacheForVideo(id);
    refreshCurrentLyrics('custom-query-change');
    closeSearchModal();
  };

  const handleVideoData = (videoId: string, name: string) => {
    setVideoId(videoId);

    if (name !== 'dataloaded') return;
    setHasManuallySwitchedProvider(false);
  };

  const videoDataChangeHandler = (
    name: string,
    { videoId }: PlayerAPIEvents['videodatachange']['value'],
  ) => handleVideoData(videoId, name);

  const domVideoDataChangeHandler = (e: Event) => {
    const detail = (e as CustomEvent<VideoDataChanged>).detail;
    if (!detail?.videoData?.videoId) return;
    handleVideoData(detail.videoData.videoId, detail.name);
  };

  // prettier-ignore
  {
    onMount(() => {
      // Register on _ytAPI if already available, and get current videoId
      if (_ytAPI) {
        const vd = _ytAPI.getVideoData();
        if (vd?.video_id) setVideoId(vd.video_id);
        _ytAPI.addEventListener('videodatachange', videoDataChangeHandler);
      }

      // Always listen for DOM videodatachange events — these dispatch
      // regardless of _ytAPI availability, covering both the mount-too-early
      // race and events that fired before this component existed.
      document.addEventListener('videodatachange', domVideoDataChangeHandler);
    });

    onCleanup(() => {
      _ytAPI?.removeEventListener('videodatachange', videoDataChangeHandler);
      document.removeEventListener('videodatachange', domVideoDataChangeHandler);
    });
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

      <Show when={config()?.showCustomSearchButton !== false}>
        <div class="lyrics-picker-right">
          <mdui-button-icon>
            <LitElementWrapper
              elementClass={IconSearch}
              props={{
                onClick: openSearchModal,
                role: 'button',
                style: { padding: '5px' },
                title: 'Custom search query',
              }}
            />
          </mdui-button-icon>
        </div>
      </Show>

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

      <Show when={showSearchModal()}>
        <Portal>
          <div class="synced-lyrics-modal-backdrop" onClick={closeSearchModal}>
            <form
              class="synced-lyrics-modal"
              onClick={(e) => e.stopPropagation()}
              onSubmit={submitCustomQuery}
            >
              <span class="synced-lyrics-modal-title">Custom search query</span>

              <label class="synced-lyrics-modal-label">
                Title / search query
                <input
                  class="synced-lyrics-modal-input"
                  onInput={(e) =>
                    setSearchQuery((e.target as HTMLInputElement).value)
                  }
                  placeholder="Song title to search for…"
                  type="text"
                  value={searchQuery()}
                />
              </label>

              <label class="synced-lyrics-modal-label">
                Artist
                <input
                  class="synced-lyrics-modal-input"
                  onInput={(e) =>
                    setSearchArtist((e.target as HTMLInputElement).value)
                  }
                  placeholder="(optional)"
                  type="text"
                  value={searchArtist()}
                />
              </label>

              <div class="synced-lyrics-modal-actions">
                <button
                  class="synced-lyrics-modal-btn synced-lyrics-modal-btn--secondary"
                  onClick={closeSearchModal}
                  type="button"
                >
                  Cancel
                </button>

                <Show when={customQuery()}>
                  <button
                    class="synced-lyrics-modal-btn synced-lyrics-modal-btn--danger"
                    onClick={clearCustomQueryAction}
                    type="button"
                  >
                    Clear saved query
                  </button>
                </Show>

                <button
                  class="synced-lyrics-modal-btn synced-lyrics-modal-btn--primary"
                  disabled={!searchQuery().trim()}
                  type="submit"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </Portal>
      </Show>
    </div>
  );
};
