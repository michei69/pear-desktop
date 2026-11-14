import type { Track } from "@pear/sdk";
import { vi } from "vitest";

export const track: Track = {
  videoId: "abc",
  title: "Song",
  artist: "Artist",
  album: "Album",
  artworkUrl: "https://img.test/a.jpg",
  durationSeconds: 200,
  url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc",
  mediaType: "audio",
};

/** What the plugin uses of @xhayper/discord-rpc's client, without the IPC. */
export class FakeClient {
  static readonly instances: FakeClient[] = [];
  readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly user = {
    setActivity: vi.fn((_activity: unknown) => Promise.resolve()),
    clearActivity: vi.fn(() => Promise.resolve()),
  };
  readonly login = vi.fn(() => Promise.resolve());
  destroyed = false;
  listenersRemoved = false;

  constructor() {
    FakeClient.instances.push(this);
  }

  on(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.handlers.get(event) ?? new Set();
    listeners.add(listener);
    this.handlers.set(event, listeners);
    return this;
  }

  emit(event: string) {
    for (const listener of this.handlers.get(event) ?? []) listener();
  }

  removeAllListeners() {
    this.listenersRemoved = true;
    this.handlers.clear();
    return this;
  }

  destroy() {
    this.destroyed = true;
    return Promise.resolve();
  }
}
