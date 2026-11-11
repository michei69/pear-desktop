// YTM page styles pear-desktop injected into every window (src/music-player.css).
// Only the platform-independent player-page fixes: the nav-bar drag region and
// its height belong to the in-app menu plugin, and the traffic-light rules are
// macOS-only (MAC_TITLE_BAR_CSS in main-window.ts).

export const PLAYER_PAGE_CSS = `
/* The cast button cannot work in Electron. */
ytmusic-cast-button { display: none !important; }

/* Useless inaccessible buttons on the video player's top-right corner. */
.ytp-chrome-top-buttons { display: none !important; }

/* Image selection gets in the way of dragging the page's artwork. */
img { -webkit-user-select: none; user-select: none; }

/* Video player alignment (pear-desktop's music-player.css). */
#av-id { padding-bottom: 0; }
#av-id ~ #player.ytmusic-player-page:not([player-ui-state='FULLSCREEN']) {
  margin-top: auto !important;
  margin-bottom: auto !important;
  margin-left: var(--ytmusic-player-page-vertical-padding);
  margin-right: var(--ytmusic-player-page-vertical-padding);
  max-height: calc(100% - (var(--ytmusic-player-page-vertical-padding) * 2));
  max-width: calc(100% - (var(--ytmusic-player-page-vertical-padding) * 2));
}
`;
