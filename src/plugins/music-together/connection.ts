import {
  type BaseConnectionErrorType,
  type DataConnection,
  type DataConnectionErrorType,
  Peer,
  type PeerError,
  PeerErrorType,
  type PeerOptions,
} from 'peerjs';

import type { Permission, Profile, VideoData } from './types';

export type ConnectionEventMap = {
  CLEAR_QUEUE: null;
  ADD_SONGS: { videoList: VideoData[]; index?: number };
  REMOVE_SONG: { index: number };
  MOVE_SONG: { fromIndex: number; toIndex: number };
  SET_INDEX: { index: number };
  IDENTIFY: { profile: Profile } | undefined;
  SYNC_PROFILE: { profiles: Record<string, Profile> } | undefined;
  SYNC_QUEUE: { videoList: VideoData[] } | undefined;
  SYNC_PROGRESS:
    | { progress?: number; state?: number; index?: number }
    | undefined;
  PERMISSION: Permission | undefined;
  CONNECTION_CLOSED: null;
};
export type ConnectionEventUnion = {
  [Event in keyof ConnectionEventMap]: {
    type: Event;
    payload: ConnectionEventMap[Event];
    after?: ConnectionEventUnion[];
  };
}[keyof ConnectionEventMap];

type PromiseUtil<T> = {
  promise: Promise<T>;
  resolve: (id: T) => void;
  reject: (err: unknown) => void;
};

export type ConnectionListener = (
  event: ConnectionEventUnion,
  conn: DataConnection | null,
) => void;
export type ConnectionMode = 'host' | 'guest' | 'disconnected';

/**
 * ICE servers used to negotiate a WebRTC peer connection. Only hosts that
 * actually resolve belong here: the old `*.turn.peerjs.com` relays were
 * decommissioned and only spammed the console with `ERR_NAME_NOT_RESOLVED`.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  // STUN endpoints from Google, Cloudflare and freestun: the diagnostics NAT
  // check needs reflexive candidates from two different servers to tell an
  // open NAT from a symmetric one (see `classifyNat`).
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:freestun.net:3478' },
  {
    urls: 'turn:freestun.net:3478',
    username: 'free',
    credential: 'free',
  },
  // Open Relay Project (Metered) — free public TURN. The `443?transport=tcp`
  // entry tunnels the relay over TCP/443, so it gets through firewalls that
  // block UDP relaying.
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/** Peer options shared by a real session and the connection diagnostics. */
export const peerOptions = (): PeerOptions => ({
  debug: 0,
  config: {
    iceServers: ICE_SERVERS,
    sdpSemantics: 'unified-plan',
  },
});

const RECOVERABLE_PEER_ERRORS = new Set([
  PeerErrorType.Network,
  PeerErrorType.ServerError,
  PeerErrorType.SocketError,
  PeerErrorType.SocketClosed,
]);

export class Connection {
  private peer: Peer;
  private _mode: ConnectionMode = 'disconnected';
  private connections: Record<string, DataConnection> = {};

  private isDestroyed = false;
  private isReconnecting = false;
  private cleanedUp = false;

  private waitOpen: PromiseUtil<string> = {} as PromiseUtil<string>;
  private listeners: ConnectionListener[] = [];
  private connectionListeners: ((connection?: DataConnection) => void)[] = [];

  constructor() {
    this.peer = new Peer(peerOptions());

    this.waitOpen.promise = new Promise<string>((resolve, reject) => {
      this.waitOpen.resolve = resolve;
      this.waitOpen.reject = reject;
    });

    this.peer.on('open', (id) => {
      // An open signaling socket is not a session: hosting is claimed by the
      // plugin once it commits (`markHost`), joining by `connect`. Otherwise a
      // join that is still waiting for its host id reports `host`.
      this.waitOpen.resolve(id);
    });

    this.peer.on('connection', async (conn) => {
      // Only a host accepts dial-in peers. A guest's id is public, and a
      // second connection must not relabel the guest as host mid-session.
      if (this.isDestroyed || this._mode !== 'host') {
        try {
          conn.close();
        } catch {
          // ignore
        }
        return;
      }
      try {
        await this.registerConnection(conn);
      } catch {
        // ignore
      }
    });

    this.peer.on('disconnected', async () => {
      if (this.isDestroyed) return;
      console.warn('Music Together: lost server connection, reconnecting...');
      await this.reconnectLoop();
    });

    this.peer.on('close', () => this.cleanup());

    this.peer.on('error', async (err) => {
      if (!this.isDestroyed && RECOVERABLE_PEER_ERRORS.has(err.type)) {
        console.warn('Music Together: recoverable peer error', err.type);
        await this.reconnectLoop();
        return;
      }
      if (err.type === 'peer-unavailable') return;
      if (err.type === 'unavailable-id') {
        console.warn(
          'Music Together: id no longer available, staying on existing connections.',
        );
        this.isReconnecting = false;
        return;
      }

      console.error('Music Together: fatal peer error', err);
      this.waitOpen.reject(err);
      // A fatal error tears the session down without the user asking, so the
      // plugin still has to be told (the explicit `disconnect()` below is
      // already announced and must not fire it twice).
      this.notifyClosed();
      this.disconnect();
    });
  }

  /* public */
  async waitForReady() {
    return this.waitOpen.promise;
  }

  /** Claims the host role once the plugin has committed to hosting. */
  markHost() {
    if (!this.isDestroyed && this._mode === 'disconnected') {
      this._mode = 'host';
    }
  }

  async connect(id: string) {
    this._mode = 'guest';
    const conn = this.peer.connect(id, {
      reliable: true,
    });

    const unavailable = new Promise<never>((_, reject) => {
      const onError = (err: PeerError<`${PeerErrorType}`>) => {
        if (err.type === 'peer-unavailable') {
          this.peer.off('error', onError);
          reject(err);
        }
      };
      this.peer.on('error', onError);
      conn.once('open', () => this.peer.off('error', onError));
      conn.once('close', () => this.peer.off('error', onError));
    });

    await Promise.race([this.registerConnection(conn), unavailable]);
    return conn;
  }

  disconnect() {
    if (this.isDestroyed) return;

    this.isDestroyed = true;
    this.isReconnecting = false;
    this._mode = 'disconnected';

    this.getConnections().forEach((conn) =>
      conn.close({
        flush: true,
      }),
    );

    if (!this.peer.destroyed) this.peer.destroy();
    else this.cleanup();
  }

  /* utils */
  public get id() {
    return this.peer.id;
  }

  public get mode() {
    return this._mode;
  }

  public getConnections() {
    return Object.values(this.connections);
  }

  public async broadcast<Event extends keyof ConnectionEventMap>(
    type: Event,
    payload: ConnectionEventMap[Event],
    after?: ConnectionEventUnion[],
  ) {
    await Promise.all(
      this.getConnections().map(
        (conn) => conn.send({ type, payload, after }) ?? Promise.resolve(),
      ),
    );
  }

  public on(listener: ConnectionListener) {
    if (!this.listeners.includes(listener)) {
      this.listeners.push(listener);
    }
  }

  public onConnections(listener: (connections?: DataConnection) => void) {
    this.connectionListeners.push(listener);
  }

  /* privates */
  private async reconnectLoop() {
    if (this.isDestroyed || this.isReconnecting || this.peer.destroyed) return;
    this.isReconnecting = true;

    let attempt = 0;
    while (
      !this.isDestroyed &&
      this.peer.disconnected &&
      !this.peer.destroyed
    ) {
      attempt += 1;
      const factor = 2 ** (attempt - 1);
      const backoff = Math.min(30_000, 1_000 * factor);
      console.warn(`Music Together: reconnect attempt ${attempt}...`);
      try {
        this.peer.reconnect();
      } catch (err) {
        console.error('Music Together: reconnect() threw', err);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, backoff));
    }

    this.isReconnecting = false;
  }

  private notifyClosed() {
    for (const listener of this.listeners) {
      listener({ type: 'CONNECTION_CLOSED', payload: null }, null);
    }
    this.listeners = [];

    this.connectionListeners.forEach((listener) => listener());
    this.connectionListeners = [];
  }

  private cleanup() {
    // The peer emits `close` at least once per teardown; notify the session
    // listeners only on the first, remote-initiated one. An explicit
    // `disconnect()` is already announced by the plugin, so re-firing the
    // transition there only duplicates toasts and queue rollbacks.
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    this._mode = 'disconnected';
    this.connections = {};

    if (this.isDestroyed) {
      this.listeners = [];
      this.connectionListeners = [];
    } else {
      this.notifyClosed();
    }
  }

  private async registerConnection(conn: DataConnection) {
    return new Promise<DataConnection>((resolve, reject) => {
      conn.on('open', () => {
        this.connections[conn.connectionId] = conn;
        resolve(conn);
        this.connectionListeners.forEach((listener) => listener(conn));

        conn.on('data', (data) => {
          if (
            !data ||
            typeof data !== 'object' ||
            !('type' in data) ||
            !('payload' in data) ||
            !data.type
          ) {
            console.warn('Music Together: Invalid data', data);
            return;
          }

          for (const listener of this.listeners) {
            listener(data as ConnectionEventUnion, conn);
          }
        });
      });

      const onClose = (
        err?: PeerError<`${DataConnectionErrorType | BaseConnectionErrorType}`>,
      ) => {
        if (conn.open) {
          conn.close();
        }

        const wasOpen = Object.hasOwn(this.connections, conn.connectionId);
        delete this.connections[conn.connectionId];

        if (wasOpen && !this.isDestroyed) {
          this.connectionListeners.forEach((listener) => listener(conn));
        }
        if (err) {
          reject(err);
        } else if (!wasOpen) {
          reject(new Error('Music Together: connection closed before opening'));
        }
      };
      conn.on('error', onClose);
      conn.on('close', onClose);
    });
  }
}
