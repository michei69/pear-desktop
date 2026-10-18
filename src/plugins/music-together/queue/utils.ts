import type { VideoData } from '../types';
import type {
  ItemPlaylistPanelVideoRenderer,
  PlaylistPanelVideoWrapperRenderer,
  QueueItem,
} from '@/types/datahost-get-state';

/**
 * Whether two owner lists describe the same tracks in the same order. Only the
 * video ids matter here: a repeated `SYNC_QUEUE` that just refreshes owner ids
 * must not trigger another `/music/get_queue` fetch.
 */
export const hasSameVideoIds = (a: VideoData[], b: VideoData[]) =>
  a.length === b.length &&
  a.every((item, index) => item.videoId === b[index]?.videoId);

export const mapQueueItem = <T>(
  map: (item?: ItemPlaylistPanelVideoRenderer) => T,
  array: QueueItem[],
): T[] =>
  array
    .map((item) => {
      if ('playlistPanelVideoWrapperRenderer' in item) {
        const keys = Object.keys(
          item.playlistPanelVideoWrapperRenderer!.primaryRenderer,
        ) as (keyof PlaylistPanelVideoWrapperRenderer['primaryRenderer'])[];
        return item.playlistPanelVideoWrapperRenderer!.primaryRenderer[keys[0]];
      }
      if ('playlistPanelVideoRenderer' in item) {
        return item.playlistPanelVideoRenderer;
      }

      console.error('Music Together: Unknown item', item);
      return undefined;
    })
    .map(map);
