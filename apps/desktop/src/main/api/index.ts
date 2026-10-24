// The core API server: a local REST API + WebSocket to control playback and
// read what's playing (compatible with pear-desktop's v1 clients), plus the
// RPC methods plugins expose. Off until enabled in settings.

import { randomBytes } from "node:crypto";
import { type NowPlaying } from "@pear/sdk";
import type { ApiServerConfig } from "@pear/sdk/core-config";
import type { CoreState } from "@pear/sdk/protocol";
import { toJsonSchema } from "@pear/sdk/rpc";
import { errorMessage } from "@pear/sdk/util";
import type { SongDetails } from "@pear/sdk/song-details";
import { type BrowserWindow, dialog } from "electron";
import type { WebSocket } from "ws";
import type { Settings } from "../config.ts";
import type { PageRequests } from "../page-requests.ts";
import type { PlayerMirror } from "../player.ts";
import type { PluginHost } from "../plugins.ts";
import { signToken } from "./jwt.ts";
import { createMcpTools } from "./mcp-tools.ts";
import { createOperations, type Operations } from "./operations.ts";
import { PlayerState, playerInfoV1, playerInfoV2 } from "./player-state.ts";
import { createRoutes } from "./routes.ts";
import { startServer } from "./server.ts";
import type { Backend, RpcInfo } from "./types.ts";
import { createV2Routes } from "./v2.ts";
import { runCommand, type WsCommandActions } from "./ws-commands.ts";

export interface ApiServerEnvironment {
  settings: Settings;
  plugins: PluginHost;
  player: PlayerMirror;
  requests: PageRequests;
  window: BrowserWindow;
  /** Tells the settings overlay about config and status changes. */
  publish(state: CoreState): void;
}

type Running = Awaited<ReturnType<typeof startServer>>;

/** The "allow this client?" dialog's buttons. */
const ALLOW_BUTTON = 0;
const DENY_BUTTON = 1;
/** Of the generated token secret. */
const SECRET_BYTES = 32;

const networkKey = (c: ApiServerConfig) =>
  JSON.stringify([c.enabled, c.hostname, c.port, c.useHttps && c.certPath, c.useHttps && c.keyPath]);

const log = {
  info: (...args: unknown[]) => console.info("[pear:api]", ...args),
  error: (...args: unknown[]) => console.error("[pear:api]", ...args),
};

export class ApiServer {
  #env: ApiServerEnvironment;
  #server: Running | undefined;
  #listeningOn: string | undefined;
  #status: string | undefined;
  #error: string | undefined;
  #socketsV1 = new Set<WebSocket>();
  #socketsV2 = new Set<WebSocket>();
  #details: SongDetails | undefined;
  #dialogs = new AbortController();
  #generation = 0;
  readonly #playerState: PlayerState;
  readonly #operations: Operations;
  readonly #actions: WsCommandActions;
  #lastLyrics: (Record<string, unknown> & { videoId?: string }) | undefined;
  #lastTranslation: (Record<string, unknown> & { videoId?: string }) | undefined;

  constructor(env: ApiServerEnvironment) {
    this.#env = env;
    this.#playerState = new PlayerState(() => env.player.state);
    this.#operations = createOperations({
      state: () => env.player.state,
      details: () => this.#details,
      control: (action) => env.player.control(action),
      page: (event, payload) => env.requests.request("core", event, payload),
      playerState: this.#playerState,
      plugins: env.plugins,
      settings: env.settings,
      emit: (name, payload) => this.pageEvent(name, payload),
    });
    this.#actions = {
      next: this.#operations.nextVideo,
      previous: this.#operations.previousVideo,
      play: this.#operations.play,
      pause: this.#operations.pause,
      setSpeed: this.#operations.setPlaybackSpeed,
      seek: this.#operations.seekTo,
      setShuffle: this.#operations.setShuffle,
      setRepeat: this.#operations.setRepeat,
      setVolume: this.#operations.setVolume,
      setMute: this.#operations.setMute,
      rate: this.#operations.setLikeState,
    };

    this.#playerState.subscribe((event) => {
      const message = { ...event };
      // v1 never got RATING_CHANGED; adding it would break existing clients.
      if (event.type !== "RATING_CHANGED") this.#broadcast(this.#socketsV1, message);
      this.#broadcast(this.#socketsV2, message);
      if (event.type === "VIDEO_CHANGED") this.#lastTranslation = undefined;
    });

    // A client that connects before the next change still gets the current song.
    this.#playerState.update(env.player.state, env.player.state);
    env.player.on("change", (state, previous) => this.#onPlayerChange(state, previous));
  }

  get #config() {
    return this.#env.settings.core("apiServer");
  }

  state(): CoreState {
    return {
      config: this.#config,
      ...(this.#status ? { status: this.#status } : {}),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  /** Applies the current config: (re)binds only when the address changes; auth applies per request. */
  async apply() {
    const config = this.#config;
    const key = networkKey(config);
    if (key === this.#listeningOn) return this.#publish();
    this.stop();
    this.#listeningOn = key;
    if (!config.enabled) return this.#publish();
    if (!config.secret) this.#env.settings.setCore("apiServer", { secret: randomBytes(SECRET_BYTES).toString("base64url") });

    const generation = ++this.#generation;
    try {
      const server = await this.#start(config);
      if (generation !== this.#generation) return server.close();
      this.#server = server;
      this.#status = `${config.useHttps ? "https" : "http"}://${config.hostname}:${config.port}`;
      log.info(`listening on ${this.#status}`);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#error = `couldn't start: ${errorMessage(error)}`;
      log.error(this.#error);
    }
    this.#publish();
  }

  stop() {
    this.#generation++;
    this.#listeningOn = undefined;
    this.#status = undefined;
    this.#error = undefined;
    this.#dialogs.abort();
    this.#dialogs = new AbortController();
    if (!this.#server) return;
    this.#playerState.notifyStopped();
    this.#server.close();
    this.#server = undefined;
    this.#socketsV1.clear();
    this.#socketsV2.clear();
  }

  /** A plugin's `ctx.api.broadcast`. */
  broadcastPluginEvent(plugin: string, event: string, data: unknown) {
    const message = { type: "PLUGIN_EVENT", plugin, event, data };
    this.#broadcast(this.#socketsV1, message);
    this.#broadcast(this.#socketsV2, message);
  }

  /**
   * A page-surface event (the `api:page-event` bridge command): lyrics and
   * translation pushes. The last payload is cached so a socket that joins later
   * catches up without waiting for the next change.
   */
  pageEvent(name: string, payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const data = payload as Record<string, unknown> & { videoId?: string };
    if (name === "lyrics") {
      this.#lastLyrics = data;
      this.#broadcast(this.#socketsV2, { type: "LYRICS_CHANGED", ...data });
    } else if (name === "translation") {
      this.#lastTranslation = data;
      this.#broadcast(this.#socketsV2, { type: "TRANSLATION_UPDATED", ...data });
    }
  }

  #publish() {
    this.#env.publish(this.state());
  }

  #broadcast(sockets: Set<WebSocket>, data: object) {
    if (sockets.size === 0) return;
    const message = JSON.stringify(data);
    for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(message);
  }

  async #fetchDetails(videoId: string) {
    // Null while the page runtime isn't up; song info then just lacks the extras.
    const result = await this.#env.requests.songDetails();
    if (result?.videoId === videoId) this.#details = result;
  }

  #onPlayerChange(state: NowPlaying, previous: NowPlaying) {
    if (!this.#server) return;
    // The mirror's changes drive volume, position, modes and rating; the song
    // (re)publication waits for the page's extras.
    this.#playerState.update(state, previous);
    if (state.track && state.track.videoId !== previous.track?.videoId) {
      const videoId = state.track.videoId;
      void this.#fetchDetails(videoId).then(() => {
        if (this.#env.player.state.track?.videoId !== videoId) return;
        this.#playerState.setDetails(this.#details);
        this.#playerState.emitVideoChanged(undefined, 0);
      });
    }
  }

  #rpcMethods(): RpcInfo[] {
    return this.#env.plugins.rpcMethods().map(({ plugin, name, method }) => ({
      plugin,
      name,
      ...(method.summary ? { summary: method.summary } : {}),
      input: inputSchema(method.input),
    }));
  }

  #start(config: ApiServerConfig) {
    const { settings, player } = this.#env;
    this.#playerState.update(player.state, player.state);
    if (player.state.track) {
      const videoId = player.state.track.videoId;
      void this.#fetchDetails(videoId).then(() => {
        if (player.state.track?.videoId === videoId) this.#playerState.setDetails(this.#details);
      });
    }
    // The page owns the playback rate; seed the cached value so the first
    // PLAYER_INFO is accurate even before the API sets one.
    void this.#env.requests
      .request<number>("core", "speed")
      .then((speed) => {
        if (Number.isFinite(speed)) this.#playerState.setSpeed(speed);
      })
      .catch(() => undefined);
    const { hostname, port, useHttps, certPath, keyPath } = config;
    return startServer({
      hostname,
      port,
      ...(useHttps && certPath && keyPath ? { https: { certPath, keyPath } } : {}),
      routes: [...createRoutes(this.#backend()), ...createV2Routes(this.#operations)],
      rpcMethods: () => this.#rpcMethods(),
      mcp: {
        enabled: () => settings.core("apiServer").mcpEnabled === true,
        tools: () => createMcpTools(this.#operations),
      },
      auth: () => {
        const current = settings.core("apiServer");
        return {
          authStrategy: current.authStrategy,
          secret: current.secret,
          authorizedClients: current.authorizedClients,
        };
      },
      onSocket: (socket, path) => {
        if (path.endsWith("/ws") && path.includes("/v2/")) return this.#onV2Socket(socket);
        this.#socketsV1.add(socket);
        socket.on("close", () => this.#socketsV1.delete(socket));
        socket.send(JSON.stringify(playerInfoV1(this.#playerState)));
      },
      onError: (error) => log.error(error),
    });
  }

  #onV2Socket(socket: WebSocket) {
    this.#socketsV2.add(socket);
    socket.on("close", () => this.#socketsV2.delete(socket));
    socket.on("message", (data) => runCommand(data.toString(), this.#actions));
    socket.send(JSON.stringify(playerInfoV2(this.#playerState)));

    // Catch the new socket up on what is already known, without waiting for the
    // next change. A payload for a known different song is stale.
    const currentVideoId = this.#playerState.song?.videoId;
    const isCurrent = (videoId: string | undefined) => currentVideoId === undefined || videoId === currentVideoId;
    if (this.#lastLyrics && isCurrent(this.#lastLyrics.videoId)) {
      socket.send(JSON.stringify({ type: "LYRICS_CHANGED", ...this.#lastLyrics }));
    }
    if (this.#lastTranslation && isCurrent(this.#lastTranslation.videoId)) {
      socket.send(JSON.stringify({ type: "TRANSLATION_UPDATED", ...this.#lastTranslation }));
    }
  }

  /** What the routes act on. */
  #backend(): Backend {
    const { player, requests, window, plugins } = this.#env;
    const page = <T>(event: string, payload?: unknown) => requests.request<T>("core", event, payload);
    return {
      state: () => player.state,
      details: () => this.#details,
      control: (action) => player.control(action),
      page,
      async setFullscreen(fullscreen) {
        window.setFullScreen(fullscreen);
        await page("fullscreen:set", fullscreen);
      },
      authorize: (id, remoteAddress) => this.#authorize(id, remoteAddress),
      rpcMethods: () => this.#rpcMethods(),
      async callRpc(plugin, method, body) {
        const result = await plugins.callRpc(plugin, method, body);
        if (!result.ok) return { status: result.status, body: { error: result.error } };
        return result.value === undefined ? { status: 204 } : { status: 200, body: result.value };
      },
    };
  }

  /** A token for the client, once it is (or the user makes it) an authorized one; null when denied. */
  async #authorize(id: string, remoteAddress: string) {
    if (id.includes(",")) return null;
    const { settings } = this.#env;
    if (!settings.core("apiServer").authorizedClients.includes(id)) {
      if (!(await this.#userAllows(id, remoteAddress))) return null;
      this.#addClient(id);
    }
    return signToken({ id, iat: Math.floor(Date.now() / 1000) }, settings.core("apiServer").secret);
  }

  async #userAllows(id: string, remoteAddress: string) {
    if (this.#config.authStrategy !== "AUTH_AT_FIRST") return true;
    // pear-desktop's translated texts (the keys its translators already filled in).
    const { t } = this.#env.plugins;
    const { response } = await dialog.showMessageBox(this.#env.window, {
      type: "question",
      title: t("plugins.api-server.dialog.request.title", "API authorization request"),
      message: t("plugins.api-server.dialog.request.message", "Allow {{ID}} ({{origin}}) to access the API?", {
        ID: id,
        origin: remoteAddress,
      }),
      detail: t("plugins.api-server.dialog.request.detail", "You can revoke access in the API server settings."),
      buttons: [t("plugins.api-server.dialog.request.buttons.allow", "Allow"), t("plugins.api-server.dialog.request.buttons.deny", "Deny")],
      defaultId: DENY_BUTTON,
      cancelId: DENY_BUTTON,
      signal: this.#dialogs.signal,
    });
    return response === ALLOW_BUTTON;
  }

  #addClient(id: string) {
    const { settings } = this.#env;
    const clients = settings.core("apiServer").authorizedClients;
    if (!clients.includes(id)) settings.setCore("apiServer", { authorizedClients: [...clients, id] });
    this.#publish();
  }
}

/** The input's JSON schema for the OpenAPI document; parts JSON schema can't express are left out. */
function inputSchema(input: Parameters<typeof toJsonSchema>[0]) {
  try {
    return toJsonSchema(input, { errorMode: "ignore" });
  } catch {
    return undefined;
  }
}
