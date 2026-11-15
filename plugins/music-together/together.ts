// pear-desktop's Music Together session logic: hosting and joining over PeerJS,
// with YTM's own queue shared (queue.ts). Ported as is so pear-desktop and this
// app can be in the same session.

import type { DataConnection } from "peerjs";
import type { Logger, YTPlayerApi } from "@pear/sdk";
import type { Translate } from "@pear/sdk/i18n";
import type { ConnectionLike } from "./connection.ts";
import { createIgnoreGate } from "./ignore-gate.ts";
import { Queue, type QueueElement } from "./queue.ts";
import {
  type ConnectionEventMap,
  type ConnectionEventUnion,
  getDefaultProfile,
  type Permission,
  PERMISSIONS,
  type Account,
  type Profile,
  type VideoData,
} from "./types.ts";

/** What the session needs from the page, so tests can fake it. */
export interface TogetherEnvironment {
  createConnection(): ConnectionLike;
  queueElement(): QueueElement | null;
  player(): YTPlayerApi | null;
  /** YTM's toast. */
  toast(message: string): void;
  t: Translate;
  /** The signed-in account, as pear-desktop used for the user's profile; `null` when signed out. */
  account(): Account | null;
  /** The user's name for others (empty: "Guest 1234"). */
  name(): string;
  defaultPermission(): Permission;
  log: Pick<Logger, "warn" | "error">;
}

export type Mode = "disconnected" | "host" | "guest";

/** Seeks closer than this are left alone (pear-desktop's tolerance). */
const SEEK_TOLERANCE_S = 3;
/** The player reports progress several times a second; a 1 s cadence is plenty to notice drift. */
const PROGRESS_INTERVAL_MS = 1000;
const PLAYING = 1;
const PAUSED = 2;
/** How long hosting or joining waits for PeerJS (signalling server, then the host) before failing. */
const CONNECT_TIMEOUT_MS = 20_000;

/** What a guest's SYNC_PROGRESS may change on the host; the host's own changes rank above all. */
const PERMISSION_LEVEL: Record<Permission, number> = { "host-only": 0, playlist: 1, all: 2 };
const HOST_LEVEL = 3;
const CONTROLS_QUEUE = 1;
const CONTROLS_PLAYER = 2;

export class Together {
  connection: ConnectionLike | undefined;
  queue: Queue | undefined;
  permission: Permission;
  profiles: Record<string, Profile> = {};
  /** Hosting or joining is under way. */
  connecting = false;
  #env: TogetherEnvironment;
  #me: Omit<Profile, "id"> | undefined;
  /** Held while a remote edit is applied, so the player's echo is not sent back. */
  #gate = createIgnoreGate();
  /** The host's last progress broadcast, to hold its 1 s cadence. */
  #lastProgressAt = 0;
  /** The queue changed after a track loaded: share the follow-up change too. */
  #shareFollowUp = false;
  #rollback: (() => void)[] = [];
  #listeners = new Set<() => void>();
  /** Bumped by every host, join and stop: an attempt that sees another number was stopped or superseded. */
  #attempt = 0;

  constructor(env: TogetherEnvironment) {
    this.#env = env;
    this.permission = env.defaultPermission();
  }

  get mode(): Mode {
    return this.connection?.mode ?? "disconnected";
  }

  get id() {
    return this.connection?.id ?? "";
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }

  #profile(id: string): Profile {
    // A signed-in user shows their pear-desktop profile; guests get a generated one.
    const account = this.#env.account();
    if (account) return { id, ...account };
    if (!this.#me) {
      const name = this.#env.name().trim();
      const { id: _, ...me } = getDefaultProfile(id, Date.now().toString(), name || undefined);
      this.#me = me;
    }
    return { id, ...this.#me };
  }

  #putProfile(id: string, profile?: Profile) {
    const existing = this.profiles[id];
    if (profile === undefined) {
      if (!existing) return;
      delete this.profiles[id];
    } else {
      // Profiles are re-sent wholesale on every sync; rebuilding the queue and the
      // panel for an unchanged entry would re-decode every avatar image.
      if (existing?.name === profile.name && existing.handleId === profile.handleId && existing.thumbnail === profile.thumbnail) return;
      this.profiles[id] = profile;
    }
    this.queue?.syncQueueOwner();
    this.#emit();
  }

  #makeQueue() {
    const element = this.#env.queueElement();
    if (!element) return undefined;
    return new Queue({ queue: element, getProfile: (id) => this.profiles[id], t: this.#env.t });
  }

  /** Hosts a session; the id to share is `id`. */
  async host() {
    const attempt = this.#begin();
    try {
      const connection = this.#env.createConnection();
      this.connection = connection;
      const ready = await withTimeout(connection.waitForReady(), CONNECT_TIMEOUT_MS).catch(() => null);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      if (!ready) return this.#fail(this.#env.t("plugins.music-together.toast.host-failed", "Failed to host Music Together"));
      const queue = this.#makeQueue();
      if (!queue) return this.#fail(this.#env.t("plugins.music-together.toast.host-failed", "Failed to host Music Together"));
      this.queue = queue;
      // An open signalling socket is not a session: hosting is claimed once the
      // queue is ours, so a join still waiting for the host cannot look like one.
      connection.markHost();
      this.profiles = {};
      const me = this.#profile(connection.id);
      this.#putProfile(connection.id, me);
      queue.setOwner(me);
      queue.setVideoList(queue.videoDataFromQueue(), false);
      queue.syncQueueOwner();
      queue.initQueue();
      queue.injection();

      connection.onConnections((conn) => {
        // Closing it ourselves (stop) reports once more; that's not news.
        if (this.connection !== connection) return;
        // No connection: PeerJS itself went away, so the session is over.
        if (!conn) {
          this.#env.toast(this.#env.t("plugins.music-together.toast.disconnected", "Music Together disconnected"));
          return this.stop();
        }
        // One guest going away: the session stays, only that peer leaves.
        if (!conn.open) {
          this.#env.toast(
            this.#env.t("plugins.music-together.toast.user-disconnected", "{{name}} left Music Together", {
              name: this.profiles[conn.peer]?.name,
            }),
          );
          this.#putProfile(conn.peer, undefined);
        }
      });

      const listener = async (event: ConnectionEventUnion, conn?: DataConnection | null) => {
        this.#gate.hold();
        try {
          await this.#onHostEvent(event, conn ?? null, listener);
          if (event.after) {
            const now = event.after.shift();
            if (now) {
              now.after = event.after;
              await listener(now, conn);
            }
          }
        } finally {
          this.#gate.release();
        }
      };
      connection.on(listener);
      queue.on(listener);
      this.#startSync();
      return true;
    } finally {
      this.#end(attempt);
    }
  }

  /** Starts a host or join attempt, ending whatever session or attempt came before. */
  #begin() {
    if (this.connection) this.stop();
    this.connecting = true;
    this.#emit();
    return ++this.#attempt;
  }

  #end(attempt: number) {
    // A stopped or superseded attempt's `connecting` is no longer its own.
    if (attempt !== this.#attempt) return;
    this.connecting = false;
    this.#emit();
  }

  /**
   * Gives up an attempt that was stopped (or superseded) while it awaited. stop()
   * undid what it had set up by then; the connection may not be the current one.
   */
  #abandon(connection: ConnectionLike) {
    connection.disconnect();
    return false;
  }

  /** Whether a guest's change is refused; the guest then gets the host's queue back. */
  async #refuse(conn: DataConnection | null) {
    if (!conn || this.permission !== "host-only") return false;
    await this.connection?.broadcast("SYNC_QUEUE", { videoList: this.queue?.videoList ?? [] });
    return true;
  }

  async #onHostEvent(event: ConnectionEventUnion, conn: DataConnection | null, listener: (event: ConnectionEventUnion) => void) {
    const connection = this.connection!;
    const queue = this.queue!;
    switch (event.type) {
      case "CLEAR_QUEUE":
        if (await this.#refuse(conn)) return;
        queue.clear();
        await connection.broadcast("CLEAR_QUEUE", null);
        break;
      case "SET_INDEX":
        if (typeof event.payload?.index !== "number") {
          this.#env.log.warn('received "SET_INDEX" without an index');
          break;
        }
        queue.setIndex(event.payload.index);
        await connection.broadcast("SET_INDEX", { index: event.payload.index });
        break;
      case "ADD_SONGS":
        if (await this.#refuse(conn)) return;
        if (!Array.isArray(event.payload?.videoList)) {
          this.#env.log.warn('received "ADD_SONGS" without a list');
          break;
        }
        await this.#hostAddSongs(event, conn);
        break;
      case "REMOVE_SONG":
        if (await this.#refuse(conn)) return;
        if (typeof event.payload?.index !== "number") {
          this.#env.log.warn('received "REMOVE_SONG" without an index');
          break;
        }
        queue.removeVideo(event.payload.index);
        await connection.broadcast("REMOVE_SONG", event.payload);
        break;
      case "MOVE_SONG":
        if (await this.#refuse(conn)) return;
        if (typeof event.payload?.fromIndex !== "number" || typeof event.payload?.toIndex !== "number") {
          this.#env.log.warn('received "MOVE_SONG" without indices');
          break;
        }
        queue.moveItem(event.payload.fromIndex, event.payload.toIndex);
        await connection.broadcast("MOVE_SONG", event.payload);
        break;
      case "IDENTIFY": {
        const profile = event.payload?.profile;
        if (!conn || !profile || typeof profile !== "object") {
          this.#env.log.warn('received "IDENTIFY" without a profile or connection');
          break;
        }
        this.#env.toast(
          this.#env.t("plugins.music-together.toast.user-connected", "{{name}} joined Music Together", {
            name: profile.name,
          }),
        );
        this.#putProfile(conn.peer, profile);
        break;
      }
      case "SYNC_PROFILE":
        await connection.broadcast("SYNC_PROFILE", { profiles: this.profiles });
        break;
      case "PERMISSION":
        await connection.broadcast("PERMISSION", this.permission);
        break;
      case "SYNC_QUEUE": {
        await connection.broadcast("SYNC_QUEUE", { videoList: queue.videoList });
        // A guest joining mid-track needs the current position too: nothing polls
        // the player any more, so this is its one-shot sync.
        const player = this.#env.player();
        await connection.broadcast("SYNC_PROGRESS", {
          ...(player ? { progress: player.getCurrentTime(), state: player.getPlayerState() } : {}),
          ...this.#indexPayload(),
        });
        break;
      }
      case "SYNC_PROGRESS": {
        const level = conn ? PERMISSION_LEVEL[this.permission] : HOST_LEVEL;
        if (level >= CONTROLS_PLAYER) this.#applyProgress(event.payload);
        if (level >= CONTROLS_QUEUE) this.#followIndex(event.payload);
        break;
      }
      case "CONNECTION_CLOSED":
        queue.off(listener);
        break;
      default:
        this.#env.log.warn("unknown event", event);
        break;
    }
  }

  async #hostAddSongs(event: Extract<ConnectionEventUnion, { type: "ADD_SONGS" }>, conn: DataConnection | null) {
    const connection = this.connection!;
    const queue = this.queue!;
    const videoList = ownedVideos(event.payload.videoList, conn?.peer ?? connection.id);
    const applied = await queue.addVideos(videoList, event.payload.index);
    if (!applied) {
      // The rows could not be resolved here, so inserting them on the peers would
      // leave them with a track the host does not have.
      await connection.broadcast("SYNC_QUEUE", { videoList: queue.videoList });
      return;
    }
    await connection.broadcast("ADD_SONGS", { ...event.payload, videoList }, event.after);
    const after = event.after?.at(0);
    if (after?.type === "SET_INDEX") queue.setIndex(after.payload.index);
  }

  /** Selects the queue item another side is playing. */
  #followIndex(payload: ConnectionEventMap["SYNC_PROGRESS"]) {
    const queue = this.queue!;
    if (typeof payload?.index === "number" && queue.selectedIndex !== payload.index) queue.setIndex(payload.index);
  }

  #applyProgress(payload: { progress?: number; state?: number } | undefined) {
    const player = this.#env.player();
    if (!player) return;
    if (typeof payload?.progress === "number" && Math.abs(payload.progress - player.getCurrentTime()) > SEEK_TOLERANCE_S) {
      player.seekTo(payload.progress);
    }
    if (player.getPlayerState() !== payload?.state) {
      if (payload?.state === PAUSED) player.pauseVideo();
      if (payload?.state === PLAYING) player.playVideo();
    }
  }

  /** The current queue row as a `SYNC_PROGRESS` fragment; no row omits the index. */
  #indexPayload(): { index?: number } {
    const index = this.queue?.selectedIndex ?? -1;
    return index >= 0 ? { index } : {};
  }

  /** Joins the session hosted under `hostId` (the host's PeerJS id). */
  async join(hostId: string) {
    const attempt = this.#begin();
    const failed = () => this.#fail(this.#env.t("plugins.music-together.toast.join-failed", "Failed to join Music Together"));
    try {
      const connection = this.#env.createConnection();
      this.connection = connection;
      const ready = await withTimeout(connection.waitForReady(), CONNECT_TIMEOUT_MS).catch(() => null);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      if (!ready) return failed();
      this.profiles = {};
      const id = hostId.trim();
      if (!id) return failed();
      const connected = await withTimeout(connection.connect(id), CONNECT_TIMEOUT_MS).then(
        () => true,
        () => false,
      );
      if (attempt !== this.#attempt) return this.#abandon(connection);
      if (!connected) return failed();
      const queue = this.#makeQueue();
      if (!queue) return failed();
      this.queue = queue;
      connection.onConnections((conn) => {
        if (this.connection !== connection) return;
        if (!conn?.open) {
          this.#env.toast(this.#env.t("plugins.music-together.toast.disconnected", "Music Together disconnected"));
          this.stop();
        }
      });

      // Changes made in this window's YTM go to the host, which applies them for everyone.
      const queueListener = async (event: ConnectionEventUnion) => {
        this.#gate.hold();
        try {
          await this.#sendToHost(connection, event);
        } finally {
          this.#gate.release();
        }
      };
      // The host's changes, applied here.
      const listener = async (event: ConnectionEventUnion) => {
        this.#gate.hold();
        try {
          if (event.type === "CONNECTION_CLOSED") queue.off(queueListener);
          else await this.#applyFromHost(connection, queue, event);
        } finally {
          this.#gate.release();
        }
      };
      connection.on(listener);
      queue.on(queueListener);

      const me = this.#profile(connection.id);
      queue.injection();
      queue.setOwner(me);
      this.#watchSeeks();

      // Stopped while these went out: leave YTM's queue alone and start no sync.
      await connection.broadcast("IDENTIFY", { profile: me });
      if (attempt !== this.#attempt) return this.#abandon(connection);
      await connection.broadcast("SYNC_PROFILE", undefined);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      await connection.broadcast("PERMISSION", undefined);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      queue.clear();
      queue.syncQueueOwner();
      queue.initQueue();
      await connection.broadcast("SYNC_QUEUE", undefined);
      if (attempt !== this.#attempt) return this.#abandon(connection);
      this.#startSync();
      return true;
    } finally {
      this.#end(attempt);
    }
  }

  /** A guest's own queue change, sent to the host. */
  async #sendToHost(connection: ConnectionLike, event: ConnectionEventUnion) {
    switch (event.type) {
      case "CLEAR_QUEUE":
        return connection.broadcast("CLEAR_QUEUE", null);
      case "SET_INDEX":
        return connection.broadcast("SET_INDEX", { index: event.payload.index });
      case "ADD_SONGS":
        return connection.broadcast(
          "ADD_SONGS",
          { ...event.payload, videoList: ownedVideos(event.payload.videoList, connection.id) },
          event.after,
        );
      case "REMOVE_SONG":
        return connection.broadcast("REMOVE_SONG", event.payload);
      case "MOVE_SONG":
        return connection.broadcast("MOVE_SONG", event.payload);
      case "SYNC_PROGRESS":
        if (this.permission === "host-only") return connection.broadcast("SYNC_QUEUE", undefined);
        return connection.broadcast("SYNC_PROGRESS", event.payload);
    }
  }

  /** A change from the host, applied to this guest's queue and player. */
  async #applyFromHost(connection: ConnectionLike, queue: Queue, event: ConnectionEventUnion) {
    switch (event.type) {
      case "CLEAR_QUEUE":
        return queue.clear();
      case "SET_INDEX":
        if (typeof event.payload?.index !== "number") return;
        return queue.setIndex(event.payload.index);
      case "ADD_SONGS": {
        if (!Array.isArray(event.payload?.videoList)) return;
        const videoList = ownedVideos(event.payload.videoList, connection.id);
        await queue.addVideos(videoList, event.payload.index);
        const after = event.after?.at(0);
        if (after?.type === "SET_INDEX") queue.setIndex(after.payload.index);
        return;
      }
      case "REMOVE_SONG":
        if (typeof event.payload?.index !== "number") return;
        return queue.removeVideo(event.payload.index);
      case "MOVE_SONG":
        if (typeof event.payload?.fromIndex !== "number" || typeof event.payload?.toIndex !== "number") return;
        return queue.moveItem(event.payload.fromIndex, event.payload.toIndex);
      case "SYNC_QUEUE":
        if (Array.isArray(event.payload?.videoList)) queue.setVideoList(event.payload.videoList);
        return;
      case "SYNC_PROFILE": {
        const profiles = event.payload?.profiles;
        if (!profiles || typeof profiles !== "object") return;
        for (const [id, profile] of Object.entries(profiles)) if (profile) this.#putProfile(id, profile);
        return;
      }
      case "SYNC_PROGRESS":
        this.#applyProgress(event.payload);
        this.#followIndex(event.payload);
        return;
      case "PERMISSION":
        if (!event.payload || !PERMISSIONS.includes(event.payload)) return;
        this.permission = event.payload;
        this.#toastPermission(this.permission);
        this.#emit();
        return;
      default:
        this.#env.log.warn("unknown event", event);
        return;
    }
  }

  #toastPermission(permission: Permission) {
    this.#env.toast(
      this.#env.t("plugins.music-together.toast.permission-changed", 'Music Together permission changed to "{{permission}}"', {
        permission: this.permissionLabel(permission),
      }),
    );
  }

  /** A guest with full control seeking with YTM's progress bar tells the host. */
  #watchSeeks() {
    const progresses = Array.from(
      document.querySelectorAll<HTMLElement & { _update?: (...args: unknown[]) => void }>("tp-yt-paper-progress"),
    ).filter((el) => {
      // YTM's volume slider contains its own paper-progress track, so a volume
      // drag would be broadcast as a time position and seek the host: only the
      // seek bar may report a seek.
      const slider = el.closest("tp-yt-paper-slider");
      return !slider || slider.id === "progress-bar";
    });
    for (const progress of progresses) {
      const original = progress._update;
      if (!original) continue;
      progress._update = (...args: unknown[]) => {
        const now = args[0];
        const player = this.#env.player();
        const seeked = typeof now === "number" && !!player && Math.abs(now - player.getCurrentTime()) > SEEK_TOLERANCE_S;
        if (this.permission === "all" && seeked) {
          void this.connection?.broadcast("SYNC_PROGRESS", { progress: now, state: player.getPlayerState() });
        }
        original.call(progress, ...args);
      };
      this.#rollback.push(() => (progress._update = original));
    }
  }

  /**
   * The host's position goes out while playing and on every play/pause or seek;
   * guests with control send their own play/pause. Nothing polls the player.
   */
  #startSync() {
    const player = this.#env.player();
    if (!player) return;
    // Play/pause is a state change: report it at once, position included.
    const onState = () => {
      if (this.#gate.active) return;
      const state = player.getPlayerState();
      if (state !== PLAYING && state !== PAUSED) return;
      if (this.connection?.mode === "host") {
        this.#lastProgressAt = Date.now();
        void this.connection.broadcast("SYNC_PROGRESS", { progress: player.getCurrentTime(), state, ...this.#indexPayload() });
        return;
      }
      if (this.connection?.mode !== "guest" || this.permission !== "all") return;
      void this.connection.broadcast("SYNC_PROGRESS", { state });
    };
    // Paused playback reports progress too, but nothing needs syncing then.
    const onProgress = (seconds: number) => {
      if (this.#gate.active) return;
      if (this.connection?.mode !== "host" || player.getPlayerState() !== PLAYING) return;
      const now = Date.now();
      if (now - this.#lastProgressAt < PROGRESS_INTERVAL_MS) return;
      this.#lastProgressAt = now;
      void this.connection.broadcast("SYNC_PROGRESS", { progress: seconds, state: PLAYING, ...this.#indexPayload() });
    };
    // The host shares its queue as YTM loads new tracks into it. Autoplay and
    // radio append rows that never arrive as ADD_SONGS, so the rendered list is
    // sent on every track change.
    const onVideoData = (name: string) => {
      if (name !== "dataloaded" && !this.#shareFollowUp) return;
      if (this.connection?.mode !== "host" || !this.queue) return;
      const connection = this.connection;
      const queue = this.queue;
      const videoList = queue.videoDataFromQueue();
      queue.setVideoList(videoList, false);
      queue.syncQueueOwner();
      void connection.broadcast("SYNC_QUEUE", { videoList });
      // `selectedIndex` is -1 when YTM has no current row; sending that
      // would clear the guest's selection, so only a real row is synced.
      const { index } = this.#indexPayload();
      if (index !== undefined) void connection.broadcast("SYNC_PROGRESS", { index });
      this.#shareFollowUp = name === "dataloaded";
    };
    player.addEventListener("onStateChange", onState);
    player.addEventListener("onVideoProgress", onProgress);
    player.addEventListener("videodatachange", onVideoData);
    this.#rollback.push(() => {
      player.removeEventListener("onStateChange", onState);
      player.removeEventListener("onVideoProgress", onProgress);
      player.removeEventListener("videodatachange", onVideoData);
    });
  }

  /** The host changes what guests may do. */
  async setPermission(permission: Permission) {
    this.permission = permission;
    await this.connection?.broadcast("PERMISSION", permission);
    this.#toastPermission(permission);
    this.#emit();
  }

  permissionLabel(permission: Permission) {
    switch (permission) {
      case "host-only":
        return this.#env.t("plugins.music-together.menu.permission.host-only", "Only the host can control playlist and player");
      case "playlist":
        return this.#env.t("plugins.music-together.menu.permission.playlist", "Allow guests to control playlist");
      case "all":
        return this.#env.t("plugins.music-together.menu.permission.all", "Allow guests to control playlist and player");
    }
  }

  stop() {
    this.#attempt++;
    this.connecting = false;
    const connection = this.connection;
    this.connection = undefined;
    // Even "disconnected": a host or join still waiting for PeerJS has a Peer that would keep reconnecting.
    connection?.disconnect();
    // A hold or latches from the session must not mute the next one.
    this.#gate.reset();
    this.#lastProgressAt = 0;
    this.#shareFollowUp = false;
    this.queue?.rollbackInjection();
    this.queue?.removeQueueOwner();
    this.queue = undefined;
    for (const rollback of this.#rollback.splice(0)) rollback();
    this.profiles = {};
    this.permission = this.#env.defaultPermission();
    this.#emit();
  }

  #fail(message: string) {
    this.#env.toast(message);
    this.stop();
    return false;
  }
}

/** A peer's song list with fallen-back owners; rows that are not tracks are dropped. */
function ownedVideos(videoList: readonly VideoData[], ownerId: string): VideoData[] {
  return videoList
    .filter((video): video is VideoData => !!video && typeof video.videoId === "string" && video.videoId.length > 0)
    .map((video) => ({ ...video, ownerId: video.ownerId ?? ownerId }));
}

/** `promise`, or a rejection after `ms`: PeerJS may never open, e.g. without a signalling server. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
