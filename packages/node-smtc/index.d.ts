import EventEmitter from 'node:events';

type SMTCRepeatMode = 'none' | 'track' | 'list';
type SMTCPlaybackStatus = 'playing' | 'paused' | 'stopped' | 'changing' | 'closed';

interface SMTCPlayerEvents {
    play:           [];
    pause:          [];
    next:           [];
    previous:       [];
    stop:           [];
    shuffle:        [value: boolean];
    repeat:         [value: SMTCRepeatMode];
    positionchange: [positionMs: number];
}

declare class SMTCPlayer extends EventEmitter {
    /** Start SMTC session. Idempotent. */
    start(): void;

    /** Stop SMTC session. Tears down background thread. Safe to call multiple times. */
    stop(): void;

    setArtist(value: string): void;
    setAlbumArtist(value: string): void;
    setTitle(value: string): void;
    setAlbumTitle(value: string): void;

    /** Set thumbnail from filesystem path. */
    setThumbnail(path: string): void;

    /** Set the app identity string shown in the SMTC UI (e.g. "com.michei69.pear-desktop"). */
    setAppMediaId(id: string): void;

    /** Toggle shuffle. */
    setShuffle(enabled: boolean): void;

    /** Set playback status. */
    setPlaybackStatus(status: SMTCPlaybackStatus): void;

    /** Set auto-repeat mode. */
    setAutoRepeat(mode: SMTCRepeatMode): void;

    /** Set media start time in milliseconds. */
    setStartTime(ms: number): void;

    /** Set minimum seekable position in milliseconds. */
    setMinSeekTime(ms: number): void;

    /** Set current playback position in milliseconds. */
    setPosition(ms: number): void;

    /** Set maximum seekable position in milliseconds. */
    setMaxSeekTime(ms: number): void;

    /** Set end time (total duration) in milliseconds. */
    setEndTime(ms: number): void;

    on<K extends keyof SMTCPlayerEvents>(event: K, listener: (...args: SMTCPlayerEvents[K]) => void): this;
    off<K extends keyof SMTCPlayerEvents>(event: K, listener: (...args: SMTCPlayerEvents[K]) => void): this;
}

export default SMTCPlayer;
