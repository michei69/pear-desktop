import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { NowPlaying, Track } from "@pear/sdk";
import { type Ctx, clearSessionCookies, downloadWhileListening, isDue } from "../host.ts";

const track = (durationSeconds: number): Track => ({
  videoId: "aaaaaaaaaaa",
  title: "Song",
  artist: "Artist",
  url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=aaaaaaaaaaa",
  durationSeconds,
  mediaType: "audio",
});

const playing = (durationSeconds: number, positionSeconds: number): NowPlaying => ({
  track: track(durationSeconds),
  status: "playing",
  positionSeconds,
  volume: 100,
  muted: false,
  repeat: "none",
  shuffle: false,
  like: "none",
  ad: false,
  updatedAt: Date.now(),
});

const config = (autoDownloadMode: "seconds" | "percent") =>
  ({ autoDownload: true, autoDownloadMode, autoDownloadSeconds: 20, autoDownloadPercent: 10 }) as unknown as Ctx["config"];

describe("automatic downloads", () => {
  test("a song of unknown duration (a live stream) is never due", () => {
    for (const mode of ["seconds", "percent"] as const) {
      expect(isDue(config(mode), track(0), 0)).toBe(false);
      expect(isDue(config(mode), track(0), 500)).toBe(false);
    }
  });

  test("near the end, or once partly played", () => {
    expect(isDue(config("seconds"), track(100), 0)).toBe(false);
    expect(isDue(config("seconds"), track(100), 85)).toBe(true);
    expect(isDue(config("percent"), track(100), 9)).toBe(false);
    expect(isDue(config("percent"), track(100), 10)).toBe(true);
  });

  test("queues each track once, and only once its threshold is reached", () => {
    const listeners: ((state: NowPlaying) => void)[] = [];
    const ctx = {
      config: config("seconds"),
      player: { on: (_event: string, listener: (state: NowPlaying) => void) => void listeners.push(listener) },
    } as unknown as Ctx;
    const downloaded: string[] = [];
    downloadWhileListening(ctx, (won) => downloaded.push(won.videoId));

    listeners[0]!(playing(0, 500));
    expect(downloaded).toEqual([]);
    listeners[0]!(playing(100, 85));
    expect(downloaded).toEqual(["aaaaaaaaaaa"]);
    listeners[0]!(playing(100, 95));
    expect(downloaded).toEqual(["aaaaaaaaaaa"]);
  });
});

describe("session cookies left by a crash", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("starting up removes the cookie folder, and nothing else", async () => {
    dir = mkdtempSync(join(tmpdir(), "pear-cookies-"));
    mkdirSync(join(dir, "downloader"));
    writeFileSync(join(dir, "downloader", "cookies-123-1.txt"), "SAPISID=secret");
    writeFileSync(join(dir, "downloads.json"), "{}");
    await clearSessionCookies(dir);
    expect(existsSync(join(dir, "downloader"))).toBe(false);
    expect(existsSync(join(dir, "downloads.json"))).toBe(true);
  });
});
