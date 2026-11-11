import { describe, expect, test } from "vitest";
import { canHandle, HANDLE_COOLDOWN_MS, RESUME_WINDOW_MS } from "../gate.ts";

const now = 1_000_000;

describe("multi-device prompt gates", () => {
  test("a prompt right after playback was active is handled", () => {
    expect(canHandle(now, now - 5_000, 0)).toBe(true);
  });

  test("a prompt with no recent playback is left alone (a deliberate pause)", () => {
    expect(canHandle(now, now - RESUME_WINDOW_MS, 0)).toBe(false);
    expect(canHandle(now, now - RESUME_WINDOW_MS - 1, 0)).toBe(false);
    expect(canHandle(now, 0, 0)).toBe(false);
  });

  test("a second prompt inside the cooldown is left alone", () => {
    expect(canHandle(now, now - 5_000, now - 1_000)).toBe(false);
    expect(canHandle(now, now - 5_000, now - HANDLE_COOLDOWN_MS)).toBe(true);
  });
});
