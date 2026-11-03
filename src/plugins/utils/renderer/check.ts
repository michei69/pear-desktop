type NavigationEndpoint = HTMLAnchorElement & {
  data?: {
    watchEndpoint?: { videoId?: string };
    addToPlaylistEndpoint?: { videoId?: string; playlistId?: string };
    clickTrackingParams?: string;
  };
};

const getNavigationEndpoints = () =>
  document.querySelectorAll<NavigationEndpoint>(
    'tp-yt-paper-listbox #navigation-endpoint',
  );

export const isMusicOrVideoTrack = () =>
  Array.from(getNavigationEndpoints()).some(
    (endpoint) =>
      Boolean(endpoint.data?.addToPlaylistEndpoint?.videoId) ||
      Boolean(endpoint.data?.watchEndpoint?.videoId),
  );

export const isAlbumOrPlaylist = () =>
  Array.from(getNavigationEndpoints()).some((endpoint) =>
    Boolean(endpoint.data?.addToPlaylistEndpoint?.playlistId),
  );

export const isPlayerMenu = (menu?: HTMLElement | null) => {
  return (
    menu?.parentElement as
      | (HTMLElement & {
          ytEventForwardingBehavior: {
            forwarder_: {
              eventSink: HTMLElement;
            };
          };
        })
      | null
  )?.ytEventForwardingBehavior?.forwarder_?.eventSink?.matches(
    'ytmusic-menu-renderer.ytmusic-player-bar',
  );
};
