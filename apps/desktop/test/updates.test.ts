import { describe, expect, test, vi } from "vitest";
import { isNewerVersion, newerRelease, RELEASES_URL, shouldCheck, withRetry } from "../src/main/updates.ts";

vi.mock("electron", () => ({}));

describe("isNewerVersion", () => {
  test.each([
    ["v4.0.1", "4.0.0", true],
    ["4.1.0", "4.0.9", true],
    ["v5.0.0", "4.12.3", true],
    ["4.10.0", "4.9.0", true],
    ["v4.0.0", "4.0.0", false],
    ["v3.11.0", "4.0.0", false],
    ["4.0", "4.0.0", false],
    // A release is newer than its own prereleases, never the other way round.
    ["v4.0.0", "4.0.0-beta.1", true],
    ["v4.0.0-beta.2", "4.0.0", false],
    ["v4.0.0-beta.10", "4.0.0-beta.9", true],
    ["v4.0.0-rc.1", "4.0.0-beta.3", true],
    ["v4.0.0-beta", "4.0.0-beta.1", false],
    ["v4.0.0+build.7", "4.0.0", false],
    ["nightly", "4.0.0", false],
    ["", "4.0.0", false],
  ])("%s vs %s -> %s", (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });
});

test("only packaged builds with the option on check", () => {
  expect(shouldCheck({ packaged: true, enabled: true })).toBe(true);
  expect(shouldCheck({ packaged: false, enabled: true })).toBe(false);
  expect(shouldCheck({ packaged: true, enabled: false })).toBe(false);
});

describe("newerRelease", () => {
  const github = (body: unknown, status = 200) =>
    vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

  test("asks GitHub for the fork's latest release on the stable channel", async () => {
    const fetch = github({ tag_name: "v4.2.0", html_url: "https://github.com/michei69/pear-desktop/releases/tag/v4.2.0" });
    expect(await newerRelease("4.0.0", fetch)).toEqual({
      version: "4.2.0",
      url: "https://github.com/michei69/pear-desktop/releases/tag/v4.2.0",
    });
    expect(fetch.mock.calls[0]![0]).toBe("https://api.github.com/repos/michei69/pear-desktop/releases/latest");
  });

  test("stable ignores prereleases, drafts and older releases", async () => {
    expect(await newerRelease("4.0.0", github({ tag_name: "v4.0.0" }))).toBeUndefined();
    expect(await newerRelease("4.0.0", github({ tag_name: "v4.1.0", prerelease: true }))).toBeUndefined();
    expect(await newerRelease("4.0.0", github({ tag_name: "v4.1.0", draft: true }))).toBeUndefined();
    expect(await newerRelease("4.0.0", github({ message: "Not Found" }))).toBeUndefined();
  });

  test("the beta channel picks the newest release, prerelease or not", async () => {
    const fetch = github([
      { tag_name: "v4.0.0", html_url: "https://github.com/michei69/pear-desktop/releases/tag/v4.0.0" },
      { tag_name: "v4.1.0-beta.7", prerelease: true, html_url: "https://github.com/michei69/pear-desktop/releases/tag/v4.1.0-beta.7" },
      { tag_name: "v4.1.0-beta.10", prerelease: true, html_url: "https://github.com/michei69/pear-desktop/releases/tag/v4.1.0-beta.10" },
      { tag_name: "v9.0.0", draft: true, prerelease: true },
    ]);
    expect(await newerRelease("4.0.0", fetch, "beta")).toEqual({
      version: "4.1.0-beta.10",
      url: "https://github.com/michei69/pear-desktop/releases/tag/v4.1.0-beta.10",
    });
    expect(fetch.mock.calls[0]![0]).toBe("https://api.github.com/repos/michei69/pear-desktop/releases?per_page=20");
  });

  test("links to the releases page unless GitHub names one on the repository", async () => {
    expect((await newerRelease("4.0.0", github({ tag_name: "v4.1.0", html_url: "https://evil.example/" })))?.url).toBe(RELEASES_URL);
    expect((await newerRelease("4.0.0", github({ tag_name: "v4.1.0" })))?.url).toBe(RELEASES_URL);
  });

  test("errors (rate limits, offline) reject, for the caller to log", async () => {
    await expect(newerRelease("4.0.0", github({ message: "rate limited" }, 403))).rejects.toThrow("403");
  });
});

test("withRetry retries a transient failure", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const result = withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error("offline");
    return "ok";
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await result).toBe("ok");
  expect(calls).toBe(3);
  vi.useRealTimers();
});
