import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NowPlaying } from "@pear/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import { startSmtc } from "../src/main/smtc.ts";
import { smtcDisabledFeatures } from "../src/main/startup-tasks.ts";

const artwork = vi.hoisted(() => ({ artworkImage: vi.fn() }));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", isPackaged: false },
  session: {},
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }), createEmpty: () => ({ isEmpty: () => true }) },
  protocol: {},
  BrowserWindow: class {},
  dialog: {},
  shell: {},
}));

vi.mock("@pear/sdk/artwork", () => ({ artworkImage: artwork.artworkImage }));

/** The system media controls: records what `startSmtc` asks of it. */
const mediaControls = vi.hoisted(() => ({
  setArtist: vi.fn(),
  setAlbumArtist: vi.fn(),
  setAlbumTitle: vi.fn(),
  setTitle: vi.fn(),
  setStartTime: vi.fn(),
  setMinSeekTime: vi.fn(),
  setMaxSeekTime: vi.fn(),
  setEndTime: vi.fn(),
  setPosition: vi.fn(),
  setShuffle: vi.fn(),
  setAutoRepeat: vi.fn(),
  setPlaybackStatus: vi.fn(),
  setThumbnail: vi.fn(),
  setAppMediaId: vi.fn(),
  on: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

class FakeAddon {
  setArtist = mediaControls.setArtist;
  setAlbumArtist = mediaControls.setAlbumArtist;
  setAlbumTitle = mediaControls.setAlbumTitle;
  setTitle = mediaControls.setTitle;
  setStartTime = mediaControls.setStartTime;
  setMinSeekTime = mediaControls.setMinSeekTime;
  setMaxSeekTime = mediaControls.setMaxSeekTime;
  setEndTime = mediaControls.setEndTime;
  setPosition = mediaControls.setPosition;
  setShuffle = mediaControls.setShuffle;
  setAutoRepeat = mediaControls.setAutoRepeat;
  setPlaybackStatus = mediaControls.setPlaybackStatus;
  setThumbnail = mediaControls.setThumbnail;
  setAppMediaId = mediaControls.setAppMediaId;
  on = mediaControls.on;
  start = mediaControls.start;
  stop = mediaControls.stop;
}

const playing = (artworkUrl: string): NowPlaying => ({
  track: {
    videoId: "abc",
    title: "Song",
    artist: "Artist",
    album: "Album",
    artworkUrl,
    durationSeconds: 200,
    url: "https://example.test/watch?v=abc",
    mediaType: "audio",
  },
  status: "playing",
  positionSeconds: 3,
  volume: 100,
  muted: false,
  repeat: "none",
  shuffle: false,
  like: "none",
  ad: false,
  updatedAt: Date.now(),
});

function fakePlayer(state: NowPlaying) {
  return { state, on: vi.fn(() => () => {}), control: vi.fn() } as unknown as Parameters<typeof startSmtc>[1];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

let folder: string | undefined;

afterEach(() => {
  artwork.artworkImage.mockReset();
  vi.clearAllMocks();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = undefined;
});

describe("Chromium's media session and SMTC", () => {
  test("is only switched off when the optional addon really loaded", () => {
    // The fallback matters: with forceSmtc on and the addon missing, Windows keeps its media keys.
    expect(smtcDisabledFeatures(false)).toEqual([]);
    expect(smtcDisabledFeatures(true)).toEqual(["HardwareMediaKeyHandling", "MediaSessionService"]);
  });
});

describe("SMTC artwork", () => {
  test("writes the cover decoded by the shared cache and points the system at it", async () => {
    folder = mkdtempSync(join(tmpdir(), "pear-smtc-"));
    const thumbnailPath = join(folder, "thumbnail.png");
    artwork.artworkImage.mockResolvedValue({ isEmpty: () => false, toPNG: () => Buffer.from("png") });
    const stop = startSmtc(FakeAddon as never, fakePlayer(playing("https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=query")), {
      appMediaId: "app",
      thumbnailPath,
    });
    try {
      await vi.waitFor(() => expect(readFileSync(thumbnailPath)).toEqual(Buffer.from("png")));
      expect(artwork.artworkImage).toHaveBeenCalledWith("https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=query");
      expect(mediaControls.setThumbnail).toHaveBeenCalledWith(thumbnailPath);
    } finally {
      stop();
    }
  });

  test("an empty decode leaves the previous thumbnail alone", async () => {
    folder = mkdtempSync(join(tmpdir(), "pear-smtc-"));
    const thumbnailPath = join(folder, "thumbnail.png");
    artwork.artworkImage.mockResolvedValue({ isEmpty: () => true, toPNG: () => Buffer.from("png") });
    const stop = startSmtc(FakeAddon as never, fakePlayer(playing("https://i.ytimg.com/vi/empty/hqdefault.jpg")), {
      appMediaId: "app",
      thumbnailPath,
    });
    try {
      await flush();
      expect(mediaControls.setThumbnail).not.toHaveBeenCalled();
      expect(existsSync(thumbnailPath)).toBe(false);
    } finally {
      stop();
    }
  });

  test("a failed cover fetch still publishes the metadata", async () => {
    artwork.artworkImage.mockRejectedValue(new Error("offline"));
    const stop = startSmtc(FakeAddon as never, fakePlayer(playing("https://i.ytimg.com/vi/broken/hqdefault.jpg")), { appMediaId: "app" });
    try {
      await flush();
      expect(mediaControls.setTitle).toHaveBeenCalledWith("Song");
      expect(mediaControls.setThumbnail).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
