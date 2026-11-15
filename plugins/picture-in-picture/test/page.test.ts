import { describe, expect, it } from "vitest";
import { takeDoubleClick } from "../page.tsx";

type Player = Parameters<typeof takeDoubleClick>[0];

describe("takeDoubleClick", () => {
  it("replaces the Polymer controller prototype's handler, not the element's proxy", () => {
    const original = () => {};
    const prototype = { onDoubleClick: original };
    const controller = Object.create(prototype) as object;
    const elementProxy = () => {};
    const player = { onDoubleClick: elementProxy, polymerController: controller } as unknown as Player;

    const undo = takeDoubleClick(player);
    expect(prototype.onDoubleClick).not.toBe(original);
    expect((player as unknown as { onDoubleClick: () => void }).onDoubleClick).toBe(elementProxy);

    undo?.();
    expect(prototype.onDoubleClick).toBe(original);
  });

  it("falls back to the element's handler on older builds", () => {
    const original = () => {};
    const player = { onDoubleClick_: original } as unknown as Player;

    const undo = takeDoubleClick(player);
    expect(player?.onDoubleClick_).not.toBe(original);

    undo?.();
    expect(player?.onDoubleClick_).toBe(original);
  });

  it("does nothing when the player has no handler yet", () => {
    expect(takeDoubleClick({} as unknown as Player)).toBeUndefined();
    expect(takeDoubleClick(null)).toBeUndefined();
  });
});
