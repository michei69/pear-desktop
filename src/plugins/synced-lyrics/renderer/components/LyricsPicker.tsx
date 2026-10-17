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

import { t } from '@/i18n';
import { getSongInfo } from '@/providers/song-info-front';
import { LitElementWrapper } from '@/solit';

import {
  hasLyricText,
  pickWithStar,
  type ProviderName,
  providerNames,
  type ProviderState,
  readStarredProvider,
  resolvePriority,
  writeStarredProvider,
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
  lyricsStore,
  refreshCurrentLyrics,
  setLyricsStore,
} from '../store';
import { isChineseTranslationTarget } from '../translation-store';

import type { PlayerAPIEvents } from '@/types/player-api-events';
import type { VideoDataChanged } from '@/types/video-data-changed';

/** Index of the active provider in `providerNames`, for the picker's ordering. */
export const providerIdx = runWithOwner(reactiveOwner, () => {
  const memo = createMemo(() => providerNames.indexOf(lyricsStore.provider));
  return memo;
})!;

const pickBestProvider = (starred: ProviderName | null): ProviderName => {
  const cfg = config();
  return (
    pickWithStar({
      priority: resolvePriority(cfg?.providerPriority),
      lyrics: lyricsStore.lyrics,
      preferSynced: cfg?.preferSynced ?? true,
      starred,
      usePriorityList: cfg?.usePriorityList ?? false,
      wantsOfficialTranslation: Boolean(
        cfg?.translation.enabled &&
        isChineseTranslationTarget(cfg.translation.targetLanguage),
      ),
    }) ?? providerNames[0]
  );
};

const shouldSwitchProvider = (providerData: ProviderState) => {
  if (providerData.state === 'error') return true;
  if (providerData.state === 'fetching') return true;
  return providerData.state === 'done' && !hasLyricText(providerData.data);
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
    loadCustomQueryForVideo(videoId());
  });

  createEffect(() => {
    const id = videoId();
    setStarredProvider(id === null ? null : readStarredProvider(id));
  });

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

  // A press starting inside the modal but released on the backdrop still fires
  // `click` on the backdrop; track where it began so a dragged text selection
  // does not close the modal.
  let pressedOnBackdrop = false;

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
      if (_ytAPI) {
        const vd = _ytAPI.getVideoData();
        if (vd?.video_id) setVideoId(vd.video_id);
        _ytAPI.addEventListener('videodatachange', videoDataChangeHandler);
      }

      // Also listen on the DOM: these events fire regardless of _ytAPI, covering
      // the mount-too-early race and events fired before this component existed.
      document.addEventListener('videodatachange', domVideoDataChangeHandler);
    });

    onCleanup(() => {
      _ytAPI?.removeEventListener('videodatachange', videoDataChangeHandler);
      document.removeEventListener('videodatachange', domVideoDataChangeHandler);
    });
  }

  createEffect(() => {
    // A manual pick (arrow buttons, dots) sticks for the rest of the song.
    if (videoId() === null || hasManuallySwitchedProvider()) return;

    // Nothing to pick from while every provider is still fetching or errored.
    if (
      providerNames.every((p) => shouldSwitchProvider(lyricsStore.lyrics[p]))
    ) {
      return;
    }

    // Re-decided on every result: providers answer in network order, so picking
    // once would let a fast lower-priority provider beat the user's first choice.
    const provider = pickBestProvider(starredProvider());
    if (provider !== lyricsStore.provider) setLyricsStore('provider', provider);
  });

  const chooseProvider = (provider: ProviderName) => {
    setHasManuallySwitchedProvider(true);
    setLyricsStore('provider', provider);
  };

  /**
   * Pin the provider showing now to this song, or unpin it. Starring is an
   * explicit override, so it also cancels a manual pick.
   */
  const toggleStar = () => {
    const id = videoId();
    const current = lyricsStore.provider;
    const next = starredProvider() === current ? null : current;

    if (id !== null) writeStarredProvider(id, next);

    setHasManuallySwitchedProvider(false);
    setStarredProvider(next);
  };

  const isStarred = (provider: ProviderName) => starredProvider() === provider;

  /** The star shows and toggles the pin for this song. */
  const starProps = (provider: ProviderName) => ({
    onClick: toggleStar,
    role: 'button',
    style: { padding: '5px' },
    title: t(
      isStarred(provider)
        ? 'plugins.synced-lyrics.menu.unstar-provider.tooltip'
        : 'plugins.synced-lyrics.menu.star-provider.tooltip',
    ),
  });

  const step = (offset: number) => {
    const idx = providerNames.indexOf(lyricsStore.provider);
    chooseProvider(
      providerNames[
        (idx + providerNames.length + offset) % providerNames.length
      ],
    );
  };

  return (
    <div class="lyrics-picker" ref={props.setStickRef}>
      <div class="lyrics-picker-left">
        <mdui-button-icon>
          <LitElementWrapper
            elementClass={IconChevronLeft}
            props={{
              onClick: () => step(-1),
              role: 'button',
              style: { padding: '5px' },
              title: t('plugins.synced-lyrics.menu.previous-provider.tooltip'),
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
                <mdui-button-icon tabindex={-1}>
                  <Show
                    fallback={
                      <LitElementWrapper
                        elementClass={IconStarBorder}
                        props={starProps(provider())}
                      />
                    }
                    when={isStarred(provider())}
                  >
                    <LitElementWrapper
                      elementClass={IconStar}
                      props={starProps(provider())}
                    />
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
                onClick={() => chooseProvider(providerNames[idx()])}
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
                title: t(
                  'plugins.synced-lyrics.menu.custom-search-button.tooltip',
                ),
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
              onClick: () => step(1),
              role: 'button',
              style: { padding: '5px' },
              title: t('plugins.synced-lyrics.menu.next-provider.tooltip'),
            }}
          />
        </mdui-button-icon>
      </div>

      <Show when={showSearchModal()}>
        <Portal>
          <div
            class="synced-lyrics-modal-backdrop"
            onClick={() => {
              if (pressedOnBackdrop) closeSearchModal();
            }}
            onMouseDown={(e) => {
              pressedOnBackdrop = e.target === e.currentTarget;
            }}
          >
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
