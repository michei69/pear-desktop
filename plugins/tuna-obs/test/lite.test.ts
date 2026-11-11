import { describe, expect, it, vi } from "vitest";
import { LITE_RETRY_MS, liteSender, type LiteRequest } from "../lite.ts";

type Call = { url: string; request: LiteRequest };

/** A fake Tuna server: records requests, and can be closed or opened at will. */
function harness() {
  const calls: Call[] = [];
  const log = { info: vi.fn() };
  const delays: number[] = [];
  let reachable = false;
  let retry: (() => void) | undefined;

  const sender = liteSender({
    port: () => 1608,
    body: () => JSON.stringify({ data: { title: "Song" } }),
    fetch: async (url, request) => {
      calls.push({ url, request });
      if (!reachable) throw new Error("ECONNREFUSED");
    },
    setTimeout: (fn, ms) => {
      retry = fn;
      delays.push(ms);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {
      retry = undefined;
    },
    log,
  });

  return {
    sender,
    calls,
    delays,
    log,
    open: () => {
      reachable = true;
    },
    /** Runs the pending 30 s retry, as it would fire in the host. */
    fireRetry: () => {
      const pending = retry;
      retry = undefined;
      pending?.();
    },
    hasRetry: () => retry !== undefined,
    flush: async (times = 4) => {
      for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("Tuna lite mode", () => {
  it("probes while Tuna is down and retries the real request instead of latching", async () => {
    const tuner = harness();
    try {
      tuner.sender.post();
      await tuner.flush();

      // The first failure downgrades to the empty-payload probe...
      expect(tuner.calls[0]).toMatchObject({ url: "http://127.0.0.1:1608/", request: { method: "POST", keepalive: true } });
      expect(tuner.sender.probing).toBe(true);

      tuner.sender.post();
      await tuner.flush();
      expect(tuner.calls.at(-1)?.request.method).toBe("OPTIONS");

      // ...but a failed probe does not mute the plugin forever: the real request is retried.
      expect(tuner.hasRetry()).toBe(true);
      tuner.open();
      tuner.fireRetry();
      await tuner.flush();
      expect(tuner.calls.at(-1)?.request.method).toBe("POST");
      expect(tuner.calls.at(-1)?.request.body).toContain('"title":"Song"');
      expect(tuner.sender.probing).toBe(false);
    } finally {
      tuner.sender.stop();
    }
  });

  it("schedules the retry with the 30 s lite-mode delay", async () => {
    const tuner = harness();
    tuner.sender.post();
    await tuner.flush();
    expect(tuner.hasRetry()).toBe(true);
    expect(tuner.delays).toEqual([LITE_RETRY_MS]);
    expect(LITE_RETRY_MS).toBe(30_000);
    tuner.sender.stop();
  });

  it("re-posts the full payload after a successful probe", async () => {
    const tuner = harness();
    try {
      tuner.sender.post();
      await tuner.flush();
      expect(tuner.sender.probing).toBe(true);

      tuner.open();
      tuner.sender.post();
      await tuner.flush();
      const last = tuner.calls.at(-1);
      expect(tuner.sender.probing).toBe(false);
      expect(last?.request.method).toBe("POST");
      expect(last?.request.body).toContain('"title":"Song"');
      // The successful probe also cancels the armed retry.
      expect(tuner.hasRetry()).toBe(false);
    } finally {
      tuner.sender.stop();
    }
  });

  it("stops for good: no request after stop and the pending retry is cancelled", async () => {
    const tuner = harness();
    tuner.sender.post();
    await tuner.flush();
    expect(tuner.hasRetry()).toBe(true);

    const count = tuner.calls.length;
    tuner.sender.stop();
    expect(tuner.hasRetry()).toBe(false);
    expect(tuner.sender.probing).toBe(false);
    tuner.sender.post();
    await tuner.flush();
    expect(tuner.calls.length).toBe(count);
  });

  it("sends nothing while there is no track", async () => {
    const calls: Call[] = [];
    const sender = liteSender({
      port: () => 1608,
      body: () => undefined,
      fetch: async (url, request) => calls.push({ url, request }),
      setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
      log: { info: vi.fn() },
    });
    sender.post();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([]);
    sender.stop();
  });
});
