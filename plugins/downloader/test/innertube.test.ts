import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { InnertubeSession } from "@pear/sdk/innertube";
import { afterEach, describe, expect, test } from "vitest";
import { YTNodes } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";
import { type ConvertJob, FFMPEG_MISSING } from "../convert.ts";
import { InnertubeEngine, type BuiltInJobOptions } from "../engines/innertube.ts";
import type { Progress } from "../engines/types.ts";
import { DEFAULT_TEMPLATE } from "../ytdlp.ts";

/** What the site streams: ten bytes, fetched in one part. */
const STREAM = "0123456789";

interface FakeSong {
  videoId: string;
  title: string;
  artist?: string;
  /** `audio/webm; codecs="opus"` by default. */
  mime?: string;
  itag?: number;
}

interface FakeList {
  id: string;
  title: string;
}

/** A YTM session answering for `songs`, as the built-in engine asks it. */
function fakeSession(songs: readonly FakeSong[], list?: FakeList) {
  const byId = new Map(songs.map((song) => [song.videoId, song]));
  const item = (song: FakeSong) => ({
    is: (type: unknown) => type === YTNodes.MusicResponsiveListItem,
    as: () => ({ id: song.videoId, title: song.title }),
    id: song.videoId,
    title: song.title,
  });
  const yt = {
    session: { logged_in: false, player: undefined },
    music: {
      getInfo: async (videoId: string) => {
        const song = byId.get(videoId)!;
        return {
          basic_info: { id: videoId, title: song.title, author: song.artist ?? "Artist", duration: 100, thumbnail: [] },
          playability_status: { status: "OK" },
          chooseFormat: () => ({
            itag: song.itag ?? 251,
            mime_type: song.mime ?? 'audio/webm; codecs="opus"',
            content_length: STREAM.length,
            decipher: async () => "https://stream.example/audio",
          }),
        };
      },
      getPlaylist: async () => ({
        items: songs.map(item),
        has_continuation: false,
        header: list ? { title: { text: list.title } } : undefined,
      }),
    },
    getBasicInfo: async () => {
      throw new Error("no TV client");
    },
  };
  return {
    get: async () => yt,
    poToken: async () => undefined,
    playerResponse: () => undefined,
  } as unknown as InnertubeSession;
}

function fakeProgress() {
  const seen = { named: [] as string[], partials: [] as string[], items: [] as unknown[], songs: [] as unknown[] };
  const progress: Progress = {
    named: (label) => void seen.named.push(label),
    item: (index, count, title) => void seen.items.push({ index, count, title }),
    download: () => {},
    converting: () => {},
    songs: (songs) => void seen.songs.push(songs),
    song: (update) => void seen.songs.push(update),
    partial: (file) => void seen.partials.push(file),
  };
  return { progress, seen };
}

/** A converter that records its jobs; `run` does the conversion, writing the output by default. */
function fakeConverter(
  run: (job: ConvertJob) => Promise<void> = async (job) => {
    await writeFile(job.output, "converted");
  },
) {
  const jobs: ConvertJob[] = [];
  const converter = {
    kind: "native" as const,
    convert: async (job: ConvertJob) => {
      jobs.push(job);
      await run(job);
    },
  };
  return { converter, jobs };
}

/** A conversion that fails as it does with no usable ffmpeg. */
const missingFfmpeg = () => async () => {
  throw Object.assign(new Error(FFMPEG_MISSING), { code: "ENOENT" });
};

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function options(folder: string, patch: Partial<BuiltInJobOptions> = {}): BuiltInJobOptions {
  return {
    folder,
    format: "source",
    template: DEFAULT_TEMPLATE,
    playlistFolders: true,
    playlistLimit: 0,
    skipExisting: false,
    archive: false,
    squareCover: false,
    replayGain: false,
    lyrics: false,
    lyricsFile: false,
    offline: false,
    exportFiles: true,
    ...patch,
  };
}

interface SetupOptions {
  songs: readonly FakeSong[];
  list?: FakeList;
  config?: Partial<BuiltInJobOptions>;
  /** What the converter does; writes the output by default. */
  convert?: (job: ConvertJob) => Promise<void>;
  /** The stream's server, for tests that count requests. */
  fetch?: () => Promise<Response>;
}

function setup({ songs, list, config = {}, convert, fetch }: SetupOptions) {
  dir = mkdtempSync(join(tmpdir(), "pear-innertube-"));
  const warnings: string[] = [];
  const { converter, jobs: converted } = fakeConverter(convert);
  const opts = options(dir, config);
  const engine = new InnertubeEngine({
    session: fakeSession(songs, list),
    jobOptions: () => opts,
    converter: () => converter,
    cover: async () => undefined,
    fetch: fetch ?? (async () => new Response(STREAM)),
    lyrics: async () => undefined,
    log: { warn: (...args) => void warnings.push(args.join(" ")) },
  });
  const { progress, seen } = fakeProgress();
  const download = (target: { videoId: string; playlistId?: string; items?: number[] }) =>
    engine.download({ id: 1, label: "Label", target }, progress, new AbortController().signal);
  return { engine, download, converted, warnings, seen };
}

describe("the built-in engine's output", () => {
  test("As streamed keeps the streamed container, not .opus/.m4a", async () => {
    const { download, converted } = setup({ songs: [{ videoId: "aaaaaaaaaaa", title: "Song", artist: "Artist" }] });
    const result = await download({ videoId: "aaaaaaaaaaa" });
    expect(converted[0]!.ext).toBe("webm");
    expect(basename(result.files[0]!)).toBe("Artist - Song.webm");
    expect(readFileSync(result.files[0]!, "utf8")).toBe("converted");
  });

  test("As streamed names an AAC stream .m4a", async () => {
    const { download, converted } = setup({
      songs: [{ videoId: "aaaaaaaaaaa", title: "Song", artist: "Artist", mime: 'audio/mp4; codecs="mp4a.40.2"' }],
    });
    const result = await download({ videoId: "aaaaaaaaaaa" });
    expect(converted[0]!.ext).toBe("m4a");
    expect(basename(result.files[0]!)).toBe("Artist - Song.m4a");
  });

  test("names the job after the list, and a single song after its artist and title", async () => {
    const list = setup({
      songs: [{ videoId: "aaaaaaaaaaa", title: "One" }],
      list: { id: "PLtest", title: "My List" },
      config: { format: "mp3" },
    });
    await list.download({ videoId: "", playlistId: "PLtest" });
    expect(list.seen.named).toContain("My List");

    const single = setup({ songs: [{ videoId: "aaaaaaaaaaa", title: "Song", artist: "Artist" }] });
    await single.download({ videoId: "aaaaaaaaaaa" });
    expect(single.seen.named).toEqual(["Song"]);
  });
});

describe("existing playlist folders", () => {
  const songs: FakeSong[] = [
    { videoId: "aaaaaaaaaaa", title: "One", artist: "Artist" },
    { videoId: "bbbbbbbbbbb", title: "Two", artist: "Artist" },
  ];

  test("a whole list into a folder that is there already is refused, as pear-desktop refused", async () => {
    const { download, converted } = setup({ songs, list: { id: "PLtest", title: "My List" }, config: { format: "mp3" } });
    mkdirSync(join(dir, "My List"));
    await expect(download({ videoId: "", playlistId: "PLtest" })).rejects.toThrow(/already exists/);
    expect(converted).toHaveLength(0);
  });

  test("skipping existing files merges into it instead", async () => {
    const { download } = setup({
      songs,
      list: { id: "PLtest", title: "My List" },
      config: { format: "mp3", skipExisting: true },
    });
    mkdirSync(join(dir, "My List"));
    const result = await download({ videoId: "", playlistId: "PLtest" });
    expect(result.error).toBeUndefined();
    expect(result.files).toEqual([join(dir, "My List", "Artist - One.mp3"), join(dir, "My List", "Artist - Two.mp3")]);
  });

  test("a resumed list continues into its own folder", async () => {
    const { download } = setup({ songs, list: { id: "PLtest", title: "My List" }, config: { format: "mp3" } });
    mkdirSync(join(dir, "My List"));
    const result = await download({ videoId: "", playlistId: "PLtest", items: [2] });
    expect(result.files).toEqual([join(dir, "My List", "Artist - Two.mp3")]);
  });
});

describe("no usable ffmpeg", () => {
  test("the stream already in the wanted container is kept instead of being failed and deleted", async () => {
    const { download, warnings } = setup({
      songs: [{ videoId: "aaaaaaaaaaa", title: "Song", artist: "Artist" }],
      convert: missingFfmpeg(),
    });
    const result = await download({ videoId: "aaaaaaaaaaa" });
    expect(warnings.join("\n")).toMatch(/no usable ffmpeg/);
    expect(result.files).toEqual([join(dir, "Artist - Song.webm")]);
    expect(readFileSync(join(dir, "Artist - Song.webm"), "utf8")).toBe(STREAM);
  });

  test("another container fails with the install guidance", async () => {
    const { download } = setup({
      songs: [{ videoId: "aaaaaaaaaaa", title: "Song", artist: "Artist" }],
      config: { format: "mp3" },
      convert: missingFfmpeg(),
    });
    await expect(download({ videoId: "aaaaaaaaaaa" })).rejects.toThrow(FFMPEG_MISSING);
  });
});

describe("temp files", () => {
  test("two songs with one title convert from different files", async () => {
    const songs: FakeSong[] = [
      { videoId: "aaaaaaaaaaa", title: "Same", artist: "Artist" },
      { videoId: "bbbbbbbbbbb", title: "Same", artist: "Artist" },
    ];
    const inputs: string[] = [];
    let both: () => void = () => {};
    const started = new Promise<void>((resolve) => (both = resolve));
    const { download } = setup({
      songs,
      list: { id: "PLtest", title: "My List" },
      config: { format: "mp3" },
      convert: async (job) => {
        inputs.push(job.input);
        if (inputs.length === 2) both();
        await started;
        await writeFile(job.output, "converted");
      },
    });
    await download({ videoId: "", playlistId: "PLtest" });
    expect(inputs).toHaveLength(2);
    expect(new Set(inputs).size).toBe(2);
  });

  test("a failed finish keeps the downloaded part, and the retry resumes from it", async () => {
    const song = { videoId: "aaaaaaaaaaa", title: "Song", artist: "Artist" };
    let fetched = 0;
    let failing = true;
    const { download } = setup({
      songs: [song],
      config: { format: "mp3" },
      convert: async (job) => {
        if (failing) throw new Error("the muxer gave up");
        await writeFile(job.output, "converted");
      },
      fetch: async () => {
        fetched++;
        return new Response(STREAM);
      },
    });
    await expect(download({ videoId: "aaaaaaaaaaa" })).rejects.toThrow("the muxer gave up");
    const part = join(dir, ".pear-aaaaaaaaaaa-251.part");
    expect(existsSync(part)).toBe(true);
    expect(readFileSync(part, "utf8")).toBe(STREAM);

    failing = false;
    const result = await download({ videoId: "aaaaaaaaaaa" });
    expect(fetched).toBe(1);
    expect(result.files).toEqual([join(dir, "Artist - Song.mp3")]);
    expect(existsSync(part)).toBe(false);
  });
});
