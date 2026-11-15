import type { DataConnection } from "peerjs";
import type { YTPlayerApi } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ConnectionLike, ConnectionListener, ConnectionMode } from "../connection.ts";
import { accountFromMenu } from "../account.ts";
import { Queue } from "../queue.ts";
import { Together, type TogetherEnvironment } from "../together.ts";
import type { ConnectionEventMap, ConnectionEventUnion, Permission } from "../types.ts";
import { fakeQueue } from "./queue-fake.ts";

// An in-memory PeerJS: the host sees each guest's connection, guests see the host.
class Network {
  host: FakeConnection | undefined;
  guests: FakeConnection[] = [];
}

class FakeConnection implements ConnectionLike {
  mode: ConnectionMode = "disconnected";
  listeners: ConnectionListener[] = [];
  connectionListeners: ((connection?: DataConnection) => void)[] = [];
  constructor(
    public id: string,
    protected network: Network,
  ) {}
  waitForReady() {
    // An open signalling socket is not a session: markHost claims the role.
    this.network.host ??= this;
    return Promise.resolve(this.id);
  }
  markHost() {
    if (this.mode === "disconnected") this.mode = "host";
  }
  async connect() {
    this.mode = "guest";
    if (this.network.host === this) this.network.host = undefined;
    this.network.guests.push(this);
  }
  disconnect() {
    this.mode = "disconnected";
    if (this.network.host === this) this.network.host = undefined;
  }
  async broadcast<Event extends keyof ConnectionEventMap>(type: Event, payload: ConnectionEventMap[Event], after?: ConnectionEventUnion[]) {
    this.sendRaw(structuredClone({ type, payload, ...(after ? { after } : {}) }));
  }
  on(listener: ConnectionListener) {
    this.listeners.push(listener);
  }
  onConnections(listener: (connection?: DataConnection) => void) {
    this.connectionListeners.push(listener);
  }
  /** Delivers an event to the other side, malformed or not, as PeerJS would. */
  sendRaw(event: unknown) {
    const targets = this.mode === "host" ? this.network.guests : this.network.host ? [this.network.host] : [];
    for (const target of targets) {
      const conn = this.mode === "host" ? null : ({ peer: this.id, open: true } as never);
      for (const listener of target.listeners) void listener(structuredClone(event) as ConnectionEventUnion, conn);
    }
  }
  /** What PeerJS reports when one guest's data connection closes. */
  peerCloses(peer: string) {
    for (const listener of this.connectionListeners) listener({ peer, open: false } as DataConnection);
  }
}

/** YTM's player API, reduced to what the session drives. */
class FakePlayer {
  state = 1;
  time = 0;
  listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  addEventListener(type: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((it) => it !== listener),
    );
  }
  emit(type: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(type) ?? []) listener(...args);
  }
  getPlayerState() {
    return this.state;
  }
  getCurrentTime() {
    return this.time;
  }
  seekTo(seconds: number) {
    this.time = seconds;
  }
  playVideo() {
    this.state = 1;
  }
  pauseVideo() {
    this.state = 2;
  }
  asApi() {
    return this as unknown as YTPlayerApi;
  }
}

/** A `tp-yt-paper-progress` element and the slider it belongs to. */
const progressBar = (sliderId: string) => ({
  _update: (_value?: number) => {},
  closest: (selector: string) => (selector === "tp-yt-paper-slider" ? { id: sliderId } : null),
});

beforeEach(() => {
  // YTM's /music/get_queue answers with queue items for the ids.
  const app = {
    networkManager: {
      fetch: async (_: string, body: { videoIds: string[] }) => ({
        queueDatas: body.videoIds.map((videoId) => ({ content: { playlistPanelVideoRenderer: { videoId } } })),
      }),
    },
  };
  vi.stubGlobal("document", { querySelector: () => app, querySelectorAll: () => [] });
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
});
afterEach(async () => {
  // Let the queue work the tests queued drain while the page stubs still exist.
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

function environment(
  network: Network,
  id: string,
  queue: ReturnType<typeof fakeQueue>,
  toasts: string[],
  options: { player?: FakePlayer; permission?: Permission } = {},
): TogetherEnvironment {
  return {
    createConnection: () => new FakeConnection(id, network),
    queueElement: () => queue.element,
    player: () => options.player?.asApi() ?? null,
    toast: (message) => toasts.push(message),
    t: (_key, fallback = "", vars) => fallback.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? "")),
    account: () => null,
    name: () => id,
    defaultPermission: () => options.permission ?? "playlist",
    log: { warn() {}, error() {} },
  };
}

const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Lets the session's messages, the queue-sync debounce and the syncs that follow land. */
const settle = async () => {
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 130));
  await flush(8);
};

/** Waits out the ignore gate, which opens one frame after a remote edit landed. */
const releaseGate = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("the user's profile", () => {
  // The header of YTM's /account/account_menu answer, as pear-desktop read it from the open menu.
  const menu = (header: unknown) => ({
    actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: header } } } } }],
  });

  test("is the signed-in account's name, handle and photo", () => {
    const header = {
      accountName: { runs: [{ text: "Ada Lovelace" }] },
      channelHandle: { runs: [{ text: "@ada" }] },
      accountPhoto: { thumbnails: [{ url: "https://lh3.example/ada=s48", width: 48, height: 48 }] },
    };
    expect(accountFromMenu(menu(header))).toEqual({ handleId: "@ada", name: "Ada Lovelace", thumbnail: "https://lh3.example/ada=s48" });
    // No channel: the name stands in for the handle, as in pear-desktop.
    expect(accountFromMenu(menu({ accountName: { runs: [{ text: "Ada" }] } }))).toEqual({ handleId: "Ada", name: "Ada", thumbnail: "" });
    expect(accountFromMenu({ actions: [] })).toBeNull();
    expect(accountFromMenu(undefined)).toBeNull();
  });

  test("falls back to the name setting when signed out", async () => {
    const network = new Network();
    const signedIn = new Together({
      ...environment(network, "host-id", fakeQueue(), []),
      account: () => ({ handleId: "@ada", name: "Ada", thumbnail: "photo" }),
    });
    expect(await signedIn.host()).toBe(true);
    expect(signedIn.profiles["host-id"]).toEqual({ id: "host-id", handleId: "@ada", name: "Ada", thumbnail: "photo" });

    const guest = new Together(environment(network, "guest-id", fakeQueue(), []));
    expect(await guest.join("host-id")).toBe(true);
    expect(guest.profiles["guest-id"]).toMatchObject({ id: "guest-id", name: "guest-id" });
    expect(guest.profiles["guest-id"]?.thumbnail).toContain("ui-avatars.com");
  });
});

describe("pear-desktop's Music Together", () => {
  test("YTM's own queue changes go to the session instead of the queue", () => {
    const queue = fakeQueue(["a"]);
    const shared = new Queue({ queue: queue.element, getProfile: () => undefined, t: (_k, f = "") => f });
    const events: ConnectionEventUnion[] = [];
    shared.on((event) => events.push(event));
    shared.setOwner({ id: "me", handleId: "", name: "Me", thumbnail: "" });
    shared.injection();
    queue.userAdds("b");
    expect(events).toEqual([{ type: "ADD_SONGS", payload: { videoList: [{ videoId: "b", ownerId: "me" }] } }]);
    expect(queue.ids()).toEqual(["a"]);
    // Autoplay is off during a session.
    queue.store.dispatch({ type: "ADD_AUTOMIX_ITEMS", payload: {} });
    shared.rollbackInjection();
    queue.userAdds("c");
    expect(queue.ids()).toEqual(["a", "c"]);
  });

  test("a guest's song reaches the host's queue and every guest's, with its owner", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const guestQueue = fakeQueue();
    const toasts: string[] = [];
    const host = new Together(environment(network, "host-id", hostQueue, toasts));
    const guest = new Together(environment(network, "guest-id", guestQueue, []));
    expect(await host.host()).toBe(true);
    expect(await guest.join("host-id")).toBe(true);
    await settle();
    // The guest got the host's queue and identified itself.
    expect(guestQueue.ids()).toEqual(["a"]);
    expect(toasts).toContain("guest-id joined Music Together");
    expect(Object.keys(guest.profiles).sort()).toEqual(["guest-id", "host-id"]);

    guestQueue.userAdds("b");
    await settle();
    expect(hostQueue.ids()).toEqual(["a", "b"]);
    expect(host.queue!.videoList.at(-1)).toEqual({ videoId: "b", ownerId: "guest-id" });
    expect(guestQueue.ids()).toEqual(["a", "b"]);
    host.stop();
    guest.stop();
  });

  test("an album added from a menu is mirrored and broadcast for every row", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a", "b"]);
    const guestQueue = fakeQueue();
    const host = new Together(environment(network, "host-id", hostQueue, []));
    const guest = new Together(environment(network, "guest-id", guestQueue, []));
    await host.host();
    await guest.join("host-id");
    await settle();

    // YTM's "Add to queue" from an album menu: several ADD_ITEMS rows in one dispatch.
    hostQueue.userAdds(["x", "y"], 2);
    await settle();
    expect(hostQueue.ids()).toEqual(["a", "b", "x", "y"]);
    expect(host.queue!.videoList.map((video) => video.videoId)).toEqual(["a", "b", "x", "y"]);
    expect(guestQueue.ids()).toEqual(["a", "b", "x", "y"]);
    host.stop();
    guest.stop();
  });

  test("one guest's dropped connection leaves the session running", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const guestQueue = fakeQueue();
    const toasts: string[] = [];
    const host = new Together(environment(network, "host-id", hostQueue, toasts));
    const guest = new Together(environment(network, "guest-id", guestQueue, []));
    await host.host();
    await guest.join("host-id");
    await settle();
    expect(Object.keys(host.profiles).sort()).toEqual(["guest-id", "host-id"]);

    // A network blip closes that guest's data connection; PeerJS reports the peer, not the session.
    network.host!.peerCloses("guest-id");
    await settle();
    expect(host.mode).toBe("host");
    expect(host.queue).toBeDefined();
    expect(host.profiles["guest-id"]).toBeUndefined();
    expect(toasts).toContain("guest-id left Music Together");
    expect(toasts).not.toContain("Music Together disconnected");
    host.stop();
    guest.stop();
  });

  test("with host-only, a guest's change is refused and the host's queue sent back", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const guestQueue = fakeQueue();
    const host = new Together(environment(network, "host-id", hostQueue, []));
    const guest = new Together(environment(network, "guest-id", guestQueue, []));
    await host.host();
    await guest.join("host-id");
    await host.setPermission("host-only");
    await settle();
    expect(guest.permission).toBe("host-only");
    guestQueue.userAdds("b");
    await settle();
    expect(hostQueue.ids()).toEqual(["a"]);
    expect(guestQueue.ids()).toEqual(["a"]);
    host.stop();
    guest.stop();
  });

  test("a malformed peer event is ignored instead of dropping the session", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a", "b"]);
    const host = new Together(environment(network, "host-id", hostQueue, []));
    const guest = new Together(environment(network, "guest-id", fakeQueue(), []));
    await host.host();
    await guest.join("host-id");
    await settle();
    const fromGuest = network.guests[0]!;

    // A guest that sends frames without their payload must not throw inside the
    // async listener, and must not touch the queue.
    fromGuest.sendRaw({ type: "SET_INDEX" });
    fromGuest.sendRaw({ type: "ADD_SONGS" });
    fromGuest.sendRaw({ type: "ADD_SONGS", payload: { videoList: "nope" } });
    fromGuest.sendRaw({ type: "REMOVE_SONG", payload: { index: -1 } });
    fromGuest.sendRaw({ type: "MOVE_SONG", payload: { fromIndex: -1, toIndex: 0 } });
    fromGuest.sendRaw({ type: "MOVE_SONG", payload: {} });
    fromGuest.sendRaw({ type: "IDENTIFY" });
    await settle();

    expect(host.mode).toBe("host");
    expect(hostQueue.ids()).toEqual(["a", "b"]);
    expect(host.queue!.videoList.map((video) => video.videoId)).toEqual(["a", "b"]);
    host.stop();
    guest.stop();
  });

  test("a guest's volume drag does not seek the host, but the seek bar does", async () => {
    const network = new Network();
    const hostPlayer = new FakePlayer();
    const guestPlayer = new FakePlayer();
    const hostQueue = fakeQueue(["a"]);
    const host = new Together(environment(network, "host-id", hostQueue, [], { player: hostPlayer, permission: "all" }));
    const guest = new Together(environment(network, "guest-id", fakeQueue(), [], { player: guestPlayer }));

    // YTM's volume slider contains its own paper-progress track; the seek bar is #progress-bar.
    const volume = progressBar("volume-slider");
    const seek = progressBar("progress-bar");
    vi.stubGlobal("document", {
      querySelector: () => undefined,
      querySelectorAll: (selector: string) => (selector === "tp-yt-paper-progress" ? [volume, seek] : []),
    });

    await host.host();
    await guest.join("host-id");
    await settle();
    expect(guest.permission).toBe("all");

    guestPlayer.time = 0;
    hostPlayer.time = 0;
    (volume._update as (value: number) => void)(50);
    await settle();
    expect(hostPlayer.time).toBe(0);

    (seek._update as (value: number) => void)(50);
    await settle();
    expect(hostPlayer.time).toBe(50);
    host.stop();
    guest.stop();
  });

  test("the host's play/pause reaches the guests at once", async () => {
    const network = new Network();
    const hostPlayer = new FakePlayer();
    const guestPlayer = new FakePlayer();
    const host = new Together(environment(network, "host-id", fakeQueue(["a"]), [], { player: hostPlayer }));
    const guest = new Together(environment(network, "guest-id", fakeQueue(), [], { player: guestPlayer }));
    await host.host();
    await guest.join("host-id");
    await settle();
    // Play/pause is only reported once the host is no longer applying a guest edit.
    await releaseGate();
    expect(guestPlayer.state).toBe(1);

    hostPlayer.state = 2;
    hostPlayer.emit("onStateChange");
    await settle();
    expect(guestPlayer.state).toBe(2);

    // Nothing polls the player: a guest that is already in that state hears nothing
    // until the next real change.
    hostPlayer.state = 1;
    hostPlayer.emit("onStateChange");
    await settle();
    expect(guestPlayer.state).toBe(1);
    host.stop();
    guest.stop();
  });

  test("stopping while hosting waits for PeerJS destroys the peer and sets nothing up", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const toasts: string[] = [];
    const connection = new PendingConnection("host-id", network);
    const host = new Together({ ...environment(network, "host-id", hostQueue, toasts), createConnection: () => connection });
    const hosting = host.host();
    expect(host.connecting).toBe(true);
    host.stop();
    expect(connection.disconnects).toBe(1);
    expect(host.connecting).toBe(false);
    connection.open();
    expect(await hosting).toBe(false);
    // No queue injection: YTM's own changes apply as usual.
    hostQueue.userAdds("b");
    expect(hostQueue.ids()).toEqual(["a", "b"]);
    expect(host.queue).toBeUndefined();
    expect(toasts).toEqual([]);
  });

  test("a guest stopped while joining leaves YTM's queue alone", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const guestQueue = fakeQueue(["mine"]);
    const guest = new Together(environment(network, "guest-id", guestQueue, []));
    // The guest stops while its IDENTIFY is on the way to the host.
    const host = new Together({ ...environment(network, "host-id", hostQueue, []), toast: () => guest.stop() });
    await host.host();
    expect(await guest.join("host-id")).toBe(false);
    await settle();
    expect(guestQueue.ids()).toEqual(["mine"]);
    expect(guest.mode).toBe("disconnected");
    host.stop();
  });

  test("a join still waiting for PeerJS is not connected as a host", async () => {
    const network = new Network();
    const connection = new PendingConnection("guest-id", network);
    const guest = new Together({ ...environment(network, "guest-id", fakeQueue(), []), createConnection: () => connection });
    const joining = guest.join("host-id");
    await settle();
    // An open signalling socket is not a session: only connect() claims the guest role.
    expect(guest.mode).toBe("disconnected");
    connection.open();
    expect(await joining).toBe(true);
    expect(guest.mode).toBe("guest");
    guest.stop();
  });

  test("hosting fails after a while when PeerJS never opens", async () => {
    vi.useFakeTimers();
    try {
      const network = new Network();
      const toasts: string[] = [];
      const connection = new PendingConnection("host-id", network);
      const host = new Together({ ...environment(network, "host-id", fakeQueue(), toasts), createConnection: () => connection });
      const hosting = host.host();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await hosting).toBe(false);
      expect(toasts).toEqual(["Failed to host Music Together"]);
      expect(connection.disconnects).toBe(1);
      expect(host.connecting).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A connection whose PeerJS peer opens only when told to. */
class PendingConnection extends FakeConnection {
  disconnects = 0;
  #open!: () => void;
  #ready = new Promise<void>((resolve) => (this.#open = resolve));
  open() {
    this.#open();
  }
  override async waitForReady() {
    await this.#ready;
    return super.waitForReady();
  }
  override disconnect() {
    this.disconnects++;
    super.disconnect();
  }
}
