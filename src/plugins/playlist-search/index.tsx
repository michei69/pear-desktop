import { render } from 'solid-js/web';

import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import style from './style.css?inline';
import { SearchWrapper } from './templates/search-wrapper';
import { NoResultsMessage } from './templates/no-results-message';

// ported from https://chromewebstore.google.com/detail/playlist-searcher-for-you/hjjeeipclnojcnapbmpkokmhejhklflk

const SIDEBAR = 'sidebar';
const DIALOG = 'dialog';

export default createPlugin<
  unknown,
  unknown,
  {
    sidebarObserver: MutationObserver | null;
    dialogObserver: MutationObserver | null;
    isDialogVisible: boolean;

    start(): Promise<void>;
    stop(): Promise<void>;
    setupSidebarSearch(): void;
    setupDialogObserver(): void;
    setupDialogSearch(): void;
    resetDialogFilter(): void;
  }
>({
  name: () => t('plugins.playlist-search.name'),
  description: () => t('plugins.playlist-search.description'),
  authors: ["Milano Slesarik", "michei69"],
  addedVersion: '3.11.x',
  restartNeeded: false,
  stylesheets: [style],

  renderer: {
    sidebarObserver: null as MutationObserver | null,
    dialogObserver: null as MutationObserver | null,
    isDialogVisible: false,

    // biome-ignore lint/suspicious/useAwait: start has to be async
    async start() {
      this.setupSidebarSearch();

      this.sidebarObserver = new MutationObserver(() => {
        this.setupSidebarSearch();
      });
      this.sidebarObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      this.setupDialogObserver();
    },

    setupSidebarSearch() {
      const playlistSection = document.querySelector(
        'ytmusic-guide-section-renderer:nth-of-type(2)',
      );
      if (
        !playlistSection ||
        playlistSection.querySelector('#pear-pls-sidebar-search-input')
      ) {
        return;
      }

      const playlistsContainer = playlistSection.querySelector('#items');
      const newPlaylistButton = playlistSection.querySelector('#buttons');
      if (!playlistsContainer || !newPlaylistButton) {
        return;
      }

      const wrapper = document.createElement('div');
      const noResultsContainer = document.createElement('div');

      render(
        () => <SearchWrapper id={SIDEBAR} placeholder={t('plugins.playlist-search.templates.search-placeholder')} />,
        wrapper,
      );
      render(
        () => <NoResultsMessage id={SIDEBAR} text={t('plugins.playlist-search.templates.no-results')} />,
        noResultsContainer,
      );

      newPlaylistButton.insertAdjacentElement('afterend', wrapper.firstElementChild!);
      playlistsContainer.insertAdjacentElement('afterend', noResultsContainer.firstElementChild!);

      const searchInput = document.getElementById(
        'pear-pls-sidebar-search-input',
      ) as HTMLInputElement | null;
      if (!searchInput) return;

      const noResultsMessage = document.getElementById(
        'pear-pls-sidebar-no-results-message',
      );
      if (!noResultsMessage) return;

      searchInput.addEventListener('input', (event) => {
        const searchTerm = (
          event.target as HTMLInputElement
        ).value
          .toLowerCase()
          .trim();
        const playlistItems = playlistsContainer.querySelectorAll(
          'ytmusic-guide-entry-renderer',
        );
        let visibleCount = 0;

        playlistItems.forEach((item) => {
          const titleElement = item.querySelector('.title');
          if (titleElement) {
            const title = titleElement.textContent?.toLowerCase() ?? '';
            const isVisible = title.includes(searchTerm);
            (item as HTMLElement).style.display = isVisible ? '' : 'none';
            if (isVisible) visibleCount++;
          }
        });

        noResultsMessage.style.display =
          searchTerm && visibleCount === 0 ? 'block' : 'none';
      });
    },

    setupDialogObserver() {
      const checkDialog = () => {
        const dialogElement = document
          .querySelector('ytmusic-add-to-playlist-renderer')
          ?.closest('tp-yt-paper-dialog');

        const isNowVisible =
          dialogElement &&
          (dialogElement as HTMLElement).style.display !== 'none';

        if (isNowVisible && !this.isDialogVisible) {
          this.isDialogVisible = true;
          this.setupDialogSearch();
        } else if (!isNowVisible && this.isDialogVisible) {
          this.isDialogVisible = false;
          this.resetDialogFilter();
        }
      };

      this.dialogObserver = new MutationObserver(() => {
        checkDialog();
      });

      this.dialogObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributeFilter: ['style'],
      });
    },

    setupDialogSearch() {
      const dialog = document.querySelector(
        'ytmusic-add-to-playlist-renderer',
      );
      if (
        !dialog ||
        dialog.querySelector('#pear-pls-dialog-search-input')
      ) {
        return;
      }

      const heading = dialog.querySelector('.section-heading');
      const playlistsContainer = dialog.querySelector('#playlists');
      if (!heading || !playlistsContainer) {
        return;
      }

      const wrapper = document.createElement('div');
      const noResultsContainer = document.createElement('div');

      render(
        () => <SearchWrapper id={DIALOG} placeholder={t('plugins.playlist-search.templates.search-placeholder')} />,
        wrapper,
      );
      render(
        () => <NoResultsMessage id={DIALOG} text={t('plugins.playlist-search.templates.no-results')} />,
        noResultsContainer,
      );

      heading.insertAdjacentElement('afterend', wrapper.firstElementChild!);
      playlistsContainer.insertAdjacentElement('afterend', noResultsContainer.firstElementChild!);

      const searchInput = document.getElementById(
        'pear-pls-dialog-search-input',
      ) as HTMLInputElement | null;
      if (!searchInput) return;

      const noResultsMessage = document.getElementById(
        'pear-pls-dialog-no-results-message',
      );
      if (!noResultsMessage) return;

      const handleFilter = (event: Event) => {
        const searchTerm = (
          event.target as HTMLInputElement
        ).value
          .toLowerCase()
          .trim();
        const playlistItems = playlistsContainer.querySelectorAll(
          'ytmusic-playlist-add-to-option-renderer',
        );
        let visibleCount = 0;

        playlistItems.forEach((item) => {
          const titleElem = item.querySelector('#title');
          if (titleElem) {
            const title =
              titleElem.getAttribute('title')?.toLowerCase() ?? '';
            const isVisible = title.includes(searchTerm);
            (item as HTMLElement).style.display = isVisible
              ? ''
              : 'none';
            if (isVisible) visibleCount++;
          }
        });

        if (searchTerm && visibleCount === 0) {
          noResultsMessage.style.display = 'block';
          noResultsMessage.style.marginBottom = '4rem';
          (playlistsContainer as HTMLElement).style.display = 'none';
        } else {
          noResultsMessage.style.display = 'none';
          (playlistsContainer as HTMLElement).style.display = '';
        }
      };

      searchInput.addEventListener('input', handleFilter);
      searchInput.focus();
    },

    resetDialogFilter() {
      const searchInput = document.getElementById(
        'pear-pls-dialog-search-input',
      ) as HTMLInputElement | null;
      if (searchInput) {
        searchInput.value = '';
      }
      const noResultsMessage = document.getElementById(
        'pear-pls-dialog-no-results-message',
      );
      if (noResultsMessage) {
        noResultsMessage.style.display = 'none';
      }
      const playlistsContainer = document.getElementById('playlists');
      if (playlistsContainer) {
        playlistsContainer.style.display = '';
      }
    },

    // biome-ignore lint/suspicious/useAwait: start has to be async
    async stop() {
      this.sidebarObserver?.disconnect();
      this.dialogObserver?.disconnect();
      document
        .querySelectorAll('[id^="pear-pls-"]')
        .forEach((el) => el.remove());
    },
  },
});
