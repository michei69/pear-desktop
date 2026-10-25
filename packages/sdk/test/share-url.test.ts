import { describe, expect, test } from "vitest";
import { stripMusicSubdomain, stripSIParam } from "../src/share-url.ts";

describe("stripMusicSubdomain", () => {
  test.each([
    ["https://music.\u0079outube.com/watch?v=abc", "https://\u0079outube.com/watch?v=abc"],
    ["http://music.\u0079outube.com:443/watch", "http://\u0079outube.com:443/watch"],
    ["https://music.\u0079outube.com/playlist?list=PL1", "https://\u0079outube.com/playlist?list=PL1"],
    ["https://music.\u0079outube.com.evil.example/watch", "https://music.\u0079outube.com.evil.example/watch"],
    ["https://\u0079outube.com/watch?v=abc", "https://\u0079outube.com/watch?v=abc"],
  ])("%s -> %s", (url, expected) => {
    expect(stripMusicSubdomain(url)).toBe(expected);
  });
});

describe("stripSIParam", () => {
  test.each([
    ["https://\u0079outube.com/watch?v=abc&si=tracking", "https://\u0079outube.com/watch?v=abc"],
    ["https://\u0079outube.com/watch?si=tracking&v=abc", "https://\u0079outube.com/watch?v=abc"],
    ["https://\u0079outube.com/watch?v=abc&si=tracking&t=10", "https://\u0079outube.com/watch?v=abc&t=10"],
    ["https://\u0079outube.com/watch?si=tracking", "https://\u0079outube.com/watch"],
    ["https://\u0079outube.com/watch?v=abc", "https://\u0079outube.com/watch?v=abc"],
  ])("%s -> %s", (url, expected) => {
    expect(stripSIParam(url)).toBe(expected);
  });
});
