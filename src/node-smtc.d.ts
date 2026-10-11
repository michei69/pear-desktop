/**
 * Optional win32-only dependency (see `.pnpmfile.cjs`): mirrors the surface
 * `src/index.ts` uses, since its own types are missing off Windows.
 */
declare module 'node-smtc' {
  export type SMTCRepeatMode = 'none' | 'track' | 'list';

  export interface SMTCPlayerEvents {
    play: [];
    pause: [];
    next: [];
    previous: [];
    shuffle: [];
    repeat: [];
    positionchange: [positionMs: number];
  }

  export default class SMTCPlayer {
    start(): void;
    stop(): void;
    setArtist(value: string): void;
    setAlbumArtist(value: string): void;
    setTitle(value: string): void;
    setAlbumTitle(value: string): void;
    setThumbnail(path: string): void;
    setAppMediaId(id: string): void;
    setShuffle(enabled: boolean): void;
    setPlaybackStatus(status: 'playing' | 'paused'): void;
    setAutoRepeat(mode: SMTCRepeatMode): void;
    setStartTime(ms: number): void;
    setMinSeekTime(ms: number): void;
    setPosition(ms: number): void;
    setMaxSeekTime(ms: number): void;
    setEndTime(ms: number): void;
    addListener<K extends keyof SMTCPlayerEvents>(
      event: K,
      listener: (...args: SMTCPlayerEvents[K]) => void,
    ): this;
  }
}
