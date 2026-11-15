import { describe, expect, test } from "vitest";
import { parseVideoId } from "../video-id.ts";

describe("parseVideoId", () => {
  test("accepts bare ids, short links and watch urls", () => {
    expect(parseVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=dQw4w9WgXcQ&t=30")).toBe("dQw4w9WgXcQ");
  });

  test("rejects anything without a video id", () => {
    for (const input of [
      "",
      "not a url",
      "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/",
      "dQw4w9WgXc", // 10 characters
    ]) {
      expect(parseVideoId(input)).toBeUndefined();
    }
  });
});
