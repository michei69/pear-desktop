import type { Innertube } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";
import { describe, expect, it, vi } from "vitest";
import { chooseAudioFormat, downloadAttempts, downloadAudio, mimeTypeOf, playableInfo, sniffAudioMime, type TrackInfo } from "../source.ts";

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
const MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74]);

/** A player response with the status the tests need; the streams come later. */
const response = (status = "OK"): TrackInfo =>
  ({ playability_status: { status, reason: status === "OK" ? undefined : "Sign in" } }) as unknown as TrackInfo;

function fakeClient(answers: { music?: () => Promise<TrackInfo>; tv?: () => Promise<TrackInfo>; ios?: () => Promise<TrackInfo> }) {
  const getInfo = vi.fn((_videoId: string, _options?: { po_token?: string }) => (answers.music ?? (async () => response()))());
  const getBasicInfo = vi.fn((_videoId: string, options: { client?: string }) => {
    if (options.client === "TV_EMBEDDED") return answers.tv ? answers.tv() : Promise.resolve(response("LOGIN_REQUIRED"));
    return answers.ios ? answers.ios() : Promise.resolve(response("LOGIN_REQUIRED"));
  });
  return { client: { music: { getInfo }, getBasicInfo } as unknown as Innertube, getInfo, getBasicInfo };
}

describe("the stream the crossfade asks for", () => {
  it("asks a premium account for audio-only first, everyone else for the muxed stream", () => {
    expect(downloadAttempts(true)[0]).toEqual({ type: "audio", format: "any" });
    expect(downloadAttempts(false)).toEqual([
      { type: "video+audio", format: "mp4" },
      { type: "video+audio", format: "any" },
    ]);
    // Never a refused audio-only request on a non-premium account.
    expect(downloadAttempts(false).some((attempt) => attempt.type === "audio")).toBe(false);
  });
});

describe("a playable player response", () => {
  it("takes the music client's answer when it is playable", async () => {
    const info = response();
    const { client, getBasicInfo } = fakeClient({ music: async () => info });
    await expect(playableInfo(client, "id")).resolves.toBe(info);
    expect(getBasicInfo).not.toHaveBeenCalled();
  });

  it("asks the music client with the track's PO token", async () => {
    const { client, getInfo } = fakeClient({});
    await playableInfo(client, "id", "po-token");
    expect(getInfo).toHaveBeenCalledWith("id", { po_token: "po-token" });
  });

  it("asks without one when the page had none", async () => {
    const { client, getInfo } = fakeClient({});
    await playableInfo(client, "id");
    expect(getInfo).toHaveBeenCalledWith("id", {});
  });

  it("falls back to the TV client for an age-restricted song", async () => {
    const tv = response();
    const { client, getInfo, getBasicInfo } = fakeClient({
      music: async () => response("LOGIN_REQUIRED"),
      tv: async () => tv,
    });
    await expect(playableInfo(client, "id")).resolves.toBe(tv);
    expect(getInfo).toHaveBeenCalledWith("id", {});
    expect(getBasicInfo).toHaveBeenNthCalledWith(1, "id", { client: "TV_EMBEDDED" });
  });

  it("falls back to the iOS client when the session's clients refuse the track", async () => {
    const ios = response();
    const { client, getBasicInfo } = fakeClient({ music: async () => response("LOGIN_REQUIRED"), ios: async () => ios });
    await expect(playableInfo(client, "id")).resolves.toBe(ios);
    expect(getBasicInfo).toHaveBeenNthCalledWith(2, "id", { client: "IOS" });
  });

  it("reports the site's refusal when every client refuses", async () => {
    const { client } = fakeClient({
      music: async () => response("LOGIN_REQUIRED"),
      tv: async () => response("UNPLAYABLE"),
      ios: async () => response("ERROR"),
    });
    await expect(playableInfo(client, "id")).rejects.toThrow("[ERROR] Sign in");
  });
});

describe("the audio bytes", () => {
  /** A response whose format streams `chunks`; `download` counts the attempts. */
  function downloadOf(chunks: Uint8Array[], mime = "audio/webm; codecs=opus") {
    const download = vi.fn(async () =>
      (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
    );
    const format = { mime_type: mime, itag: 251 };
    const chooseFormat = vi.fn(() => format);
    const info = { chooseFormat, download } as unknown as TrackInfo;
    return { info, download, chooseFormat };
  }

  it("skips an audio-only attempt a non-premium account cannot stream", async () => {
    const { info, download, chooseFormat } = downloadOf([WEBM]);
    const audio = await downloadAudio(info, false);
    expect(audio.mimeType).toBe("audio/webm; codecs=opus");
    expect([...audio.bytes]).toEqual([...WEBM]);
    expect(chooseFormat).toHaveBeenCalledWith({ type: "video+audio", format: "mp4", quality: "best" });
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("asks a premium account for audio-only first", async () => {
    const { info, chooseFormat } = downloadOf([WEBM]);
    await downloadAudio(info, true);
    expect(chooseFormat).toHaveBeenNthCalledWith(1, { type: "audio", format: "any", quality: "best" });
  });

  it("keeps its mime type or sniffs the container's", () => {
    expect(mimeTypeOf({ mime_type: "audio/mp4" }, WEBM)).toBe("audio/mp4");
    expect(mimeTypeOf({ mime_type: "" }, WEBM)).toBe("audio/webm");
    expect(mimeTypeOf({}, MP4)).toBe("video/mp4");
    expect(sniffAudioMime(WEBM)).toBe("audio/webm");
    expect(sniffAudioMime(MP4)).toBe("video/mp4");
  });

  it("tries the next stream when one yields nothing, and reports the last failure", async () => {
    const { info, download } = downloadOf([]);
    await expect(downloadAudio(info, false)).rejects.toThrow("the audio stream was empty");
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("chooses the first format the account may play", () => {
    const chosen = { mime_type: "audio/mp4", itag: 140 };
    const chooseFormat = vi.fn(({ type }: { type: string }) => {
      if (type === "audio") throw new Error("refused");
      return chosen;
    });
    const info = { chooseFormat } as unknown as TrackInfo;
    expect(chooseAudioFormat(info, true)).toBe(chosen);
    expect(chooseFormat).toHaveBeenCalledTimes(2);
  });
});
