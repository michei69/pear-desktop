// Tuna's "lite mode": while the OBS web server source is unreachable, probe it
// with cheap OPTIONS requests instead of sending payloads, and retry a real POST
// later so a temporarily closed OBS cannot latch the plugin in probe mode.

import type { Logger } from "@pear/sdk";

/** How long a failed probe suppresses payloads before the real POST is retried. */
export const LITE_RETRY_MS = 30_000;

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Origin": "*",
};

export type Timer = ReturnType<typeof setTimeout>;

export interface LiteRequest {
  method: "OPTIONS" | "POST";
  headers: Record<string, string>;
  /** Reuse the connection for the ~1/s progress posts. */
  keepalive: true;
  body?: string;
}

export type LiteFetch = (url: string, request: LiteRequest) => Promise<unknown>;

export interface LiteOptions {
  /** Tuna's port; read for every request so a config change applies live. */
  port(): number;
  /** The full payload, built from the live state; undefined while there is no track. */
  body(): string | undefined;
  fetch: LiteFetch;
  setTimeout(fn: () => void, ms: number): Timer;
  clearTimeout(timer: Timer | undefined): void;
  log: Pick<Logger, "info">;
  retryMs?: number;
}

export interface LiteSender {
  /** Posts the current payload, or probes while Tuna is unreachable. */
  post(): void;
  /** Stops for good: no request after this, and a pending retry is cancelled. */
  stop(): void;
  readonly probing: boolean;
}

export function liteSender(options: LiteOptions): LiteSender {
  const { port, body, fetch, setTimeout: after, clearTimeout: cancel, log, retryMs = LITE_RETRY_MS } = options;
  let probing = false;
  let sending = false;
  /** Something changed while a request was out: send once more after it. */
  let resend = false;
  let retry: Timer | undefined;
  let stopped = false;

  const send = async () => {
    const payload = body();
    if (payload === undefined) return;
    const probe = probing;
    try {
      await fetch(`http://127.0.0.1:${port()}/`, {
        method: probe ? "OPTIONS" : "POST",
        headers: HEADERS,
        keepalive: true,
        ...(probe ? {} : { body: payload }),
      });
      if (stopped) return;
      if (probe) {
        cancel(retry);
        retry = undefined;
        probing = false;
        // The probe carried no payload: follow it with the real post.
        resend = true;
        log.info(`Tuna is reachable on port ${port()}`);
      }
    } catch {
      if (stopped) return;
      if (!probe) log.info(`Tuna isn't reachable on port ${port()}; waiting for it`);
      probing = true;
      // Do not latch lite mode forever: retry the real request later, then probe
      // again if that fails. The payload is built from the live state, so nothing
      // needs keeping for the retry.
      if (!retry) {
        retry = after(() => {
          retry = undefined;
          if (stopped) return;
          probing = false;
          post();
        }, retryMs);
      }
    }
  };

  // One request at a time; changes meanwhile are coalesced into one more.
  const post = () => {
    if (stopped) return;
    if (sending) {
      resend = true;
      return;
    }
    sending = true;
    void send().finally(() => {
      sending = false;
      if (!resend) return;
      resend = false;
      post();
    });
  };

  return {
    post,
    stop() {
      stopped = true;
      cancel(retry);
      retry = undefined;
      probing = false;
    },
    get probing() {
      return probing;
    },
  };
}
