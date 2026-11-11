import { describe, expect, test, vi } from "vitest";
import { PLAYING, resumeIfPlaying } from "../resume.ts";

const api = (state: number) => ({ getPlayerState: () => state, playVideo: vi.fn() });

describe("resumeIfPlaying", () => {
  test("resumes a player that was playing when the captions changed", () => {
    const player = api(PLAYING);
    resumeIfPlaying(player);
    expect(player.playVideo).toHaveBeenCalledOnce();
  });

  test("leaves a paused, buffering or ended video alone", () => {
    for (const state of [2, 3, 0, -1]) {
      const player = api(state);
      resumeIfPlaying(player);
      expect(player.playVideo).not.toHaveBeenCalled();
    }
  });
});
