import { watch } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { watchPreloadBundle } from "../src/main/dev-reload.ts";

vi.mock("node:fs", () => ({ watch: vi.fn() }));

const watchMock = vi.mocked(watch);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  watchMock.mockReset();
});

test("only watches the preload bundle in electron-vite dev", () => {
  vi.stubEnv("NODE_ENV", "production");
  watchPreloadBundle(() => {});
  expect(watchMock).not.toHaveBeenCalled();
});

test("reloads once after the preload bundle is rewritten", () => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "development");
  let onChange: ((event: string, name: string) => void) | undefined;
  const watcher = { unref: vi.fn() };
  watchMock.mockImplementation(((...args: unknown[]) => {
    onChange = args[1] as (event: string, name: string) => void;
    return watcher;
  }) as never);
  const reload = vi.fn();

  watchPreloadBundle(reload);
  expect(watchMock).toHaveBeenCalledWith(expect.stringMatching(/[/\\]preload$/), expect.any(Function));
  expect(watcher.unref).toHaveBeenCalled();

  // The rebuild may write more than once; one debounced reload.
  onChange!("change", "index.cjs");
  onChange!("change", "index.cjs");
  vi.advanceTimersByTime(150);
  expect(reload).toHaveBeenCalledTimes(1);

  // Other files in the folder are not the bundle.
  onChange!("change", "index.cjs.map");
  vi.advanceTimersByTime(150);
  expect(reload).toHaveBeenCalledTimes(1);
});
