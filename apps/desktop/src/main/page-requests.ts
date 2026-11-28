// Host → page requests: the host asks a handler registered in the page
// (`ctx.host.handle` for plugins, the runtime's own for id "core") and awaits
// its answer, which comes back through the "plugin:respond" command.

import type { HostEvent } from "@pear/sdk/protocol";
import type { SongDetails } from "@pear/sdk/song-details";

const REQUEST_TIMEOUT_MS = 10_000;
/** The song details are extras; don't wait long for a page that isn't up. */
const DETAILS_TIMEOUT_MS = 5000;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class PageRequests {
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #send: (event: HostEvent) => void;
  /** The in-flight details request: every plugin reacting to one track change shares it. */
  #details: Promise<SongDetails | null> | undefined;

  constructor(send: (event: HostEvent) => void) {
    this.#send = send;
  }

  request<T = unknown>(id: string, event: string, payload?: unknown, options?: { timeout?: number }) {
    return new Promise<T>((resolve, reject) => {
      const requestId = this.#nextId++;
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`[pear] ${id}: page did not answer "${event}"`));
      }, options?.timeout ?? REQUEST_TIMEOUT_MS);
      this.#pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#send({ type: "plugin-request", id, event, payload, requestId });
    });
  }

  /**
   * The current track's extras, from the runtime's own handler; null if the page
   * doesn't answer. Discord, Lumia, Tuna, the scrobbler and the API server all
   * ask on the same player change, so concurrent asks share one round-trip.
   */
  songDetails(options?: { timeout?: number }): Promise<SongDetails | null> {
    if (this.#details) return this.#details;
    const timeout = options?.timeout ?? DETAILS_TIMEOUT_MS;
    const request = this.request<SongDetails | null>("core", "details", undefined, { timeout }).catch(() => null);
    this.#details = request;
    void request.then(() => {
      if (this.#details === request) this.#details = undefined;
    });
    return request;
  }

  /** Settles a request with the page's answer. */
  respond(requestId: number, ok: boolean, value: unknown) {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    this.#pending.delete(requestId);
    if (ok) pending.resolve(value);
    else pending.reject(new Error(String(value)));
  }
}
