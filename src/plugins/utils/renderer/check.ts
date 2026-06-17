export const isMusicOrVideoTrack = () => {
  const elements = document.querySelectorAll<
    HTMLAnchorElement & {
      data: {
        watchEndpoint: {
          videoId: string;
        };
        addToPlaylistEndpoint: {
          videoId: string;
        };
        clickTrackingParams: string;
      };
    }
  >('tp-yt-paper-listbox #navigation-endpoint');
  console.log('[check] isMusicOrVideoTrack: found', elements.length, '#navigation-endpoint elements in tp-yt-paper-listbox');
  for (const menuSelector of elements) {
    const hasAddVid = !!menuSelector?.data?.addToPlaylistEndpoint?.videoId;
    const hasWatchVid = !!menuSelector?.data?.watchEndpoint?.videoId;
    console.log('[check] isMusicOrVideoTrack item:', { hasData: !!menuSelector?.data, hasAddVid, hasWatchVid });
    if (hasAddVid || hasWatchVid) {
      return true;
    }
  }
  return false;
};

export const isAlbumOrPlaylist = () => {
  const elements = document.querySelectorAll<
    HTMLAnchorElement & {
      data: {
        addToPlaylistEndpoint: {
          playlistId: string;
        };
        clickTrackingParams: string;
      };
    }
  >('tp-yt-paper-listbox #navigation-endpoint');
  console.log('[check] isAlbumOrPlaylist: found', elements.length, '#navigation-endpoint elements in tp-yt-paper-listbox');
  for (const menuSelector of elements) {
    const hasPlaylistId = !!menuSelector?.data?.addToPlaylistEndpoint?.playlistId;
    console.log('[check] isAlbumOrPlaylist item:', { hasData: !!menuSelector?.data, hasPlaylistId });
    if (hasPlaylistId) {
      return true;
    }
  }
  return false;
};

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
