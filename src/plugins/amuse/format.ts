import { MediaType } from '@/providers/song-info-data';

import type { AmuseSongInfo } from './types';
import type { SongInfo } from '@/providers/song-info';

export const toHumanTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
};

export const emptyQuery = (isAdvertisement = false): AmuseSongInfo => ({
  apiVersion: 2,
  player: {
    hasSong: false,
    isPaused: true,
    volumePercent: 0,
    seekbarCurrentPosition: 0,
    seekbarCurrentPositionHuman: '0:00',
    statePercent: 0,
    likeStatus: 'INDIFFERENT',
    repeatType: 'NONE',
    positionUpdatedAt: 0,
  },
  track: {
    author: '',
    title: '',
    album: '',
    cover: '',
    duration: 0,
    durationHuman: '0:00',
    url: '',
    id: '',
    isVideo: false,
    isAdvertisement,
    inLibrary: false,
    mediaType: MediaType.Audio,
    playlistId: null,
  },
});

export const formatSongInfo = (
  info: SongInfo,
  isAdvertisement: boolean,
  positionUpdatedAt: number,
): AmuseSongInfo => {
  if (!info.artist || !info.title) {
    return emptyQuery(isAdvertisement);
  }

  const elapsedSeconds = Math.floor(info.elapsedSeconds ?? 0);
  const duration = Math.floor(info.songDuration ?? 0);

  return {
    apiVersion: 2,
    player: {
      hasSong: true,
      isPaused: info.isPaused ?? false,
      volumePercent: 0,
      seekbarCurrentPosition: elapsedSeconds,
      seekbarCurrentPositionHuman: toHumanTime(elapsedSeconds),
      statePercent:
        duration > 0 ? Math.round((elapsedSeconds / duration) * 100) : 0,
      likeStatus: 'INDIFFERENT',
      repeatType: 'NONE',
      positionUpdatedAt,
    },
    track: {
      author: info.artist,
      title: info.title,
      album: info.album ?? '',
      cover: info.imageSrc ?? '',
      duration,
      durationHuman: toHumanTime(duration),
      url: info.url ?? '',
      id: info.videoId,
      isVideo:
        info.mediaType !== MediaType.Audio &&
        info.mediaType !== MediaType.OriginalMusicVideo,
      isAdvertisement,
      inLibrary: false,
      mediaType: info.mediaType ?? MediaType.Audio,
      playlistId: info.playlistId || null,
    },
  };
};
