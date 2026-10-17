import type { PlayerEvent, PlayerSnapshot, WireSongInfo } from './state';

/** v1 answered in whole seconds; the player API now reports floats. */
const wholeSeconds = (position: number) => Math.floor(position);

const songWithWholeSeconds = (song: WireSongInfo): WireSongInfo => ({
  ...song,
  ...(typeof song.elapsedSeconds === 'number' && {
    elapsedSeconds: wholeSeconds(song.elapsedSeconds),
  }),
});

/** The connect payload, with v1's whole-second positions. */
export const v1PlayerInfo = (snapshot: PlayerSnapshot) => ({
  type: 'PLAYER_INFO' as const,
  ...snapshot,
  position: wholeSeconds(snapshot.position),
  song: snapshot.song && songWithWholeSeconds(snapshot.song),
});

/**
 * Adapts one player event for v1: floors every position, and drops progress
 * ticks that do not change the reported second (v1 used to emit only when the
 * player bar's integer value moved).
 */
export const createV1EventAdapter = () => {
  let lastPosition: number | undefined;

  return (event: PlayerEvent): PlayerEvent | undefined => {
    switch (event.type) {
      case 'POSITION_CHANGED': {
        const position = wholeSeconds(event.position);
        if (position === lastPosition) return undefined;

        lastPosition = position;
        return { ...event, position };
      }
      case 'VIDEO_CHANGED':
        return {
          ...event,
          song: songWithWholeSeconds(event.song),
          position: wholeSeconds(event.position),
        };
      case 'PLAYER_STATE_CHANGED':
        return { ...event, position: wholeSeconds(event.position) };
      // v2's addition; v1 has never published the rating.
      case 'RATING_CHANGED':
        return undefined;
      default:
        return event;
    }
  };
};
