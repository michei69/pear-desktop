import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isTypingTarget, patchMethod } from "../src/util.ts";

describe("patchMethod", () => {
  test("stacks wrappers: the newest runs first and the original runs once", () => {
    const calls: string[] = [];
    const target = {
      greet(name: string) {
        calls.push(`original:${name}`);
        return `hello ${name}`;
      },
    };
    const original = target.greet;

    const unpatchA = patchMethod(target, "greet", (greet) => (name) => {
      calls.push("a");
      return greet(name);
    });
    const unpatchB = patchMethod(target, "greet", (greet) => (name) => {
      calls.push("b");
      return greet(name).toUpperCase();
    });

    expect(target.greet("x")).toBe("HELLO X");
    expect(calls).toEqual(["b", "a", "original:x"]);
    // Removing one wrapper leaves the other one working.
    unpatchA();
    calls.length = 0;
    expect(target.greet("y")).toBe("HELLO Y");
    expect(calls).toEqual(["b", "original:y"]);
    // The last removal restores the original method itself.
    unpatchB();
    expect(target.greet).toBe(original);
  });

  test("a wrapper that was already removed doesn't touch the stack again", () => {
    const target = { count: () => 0 };
    const original = target.count;
    const unpatchA = patchMethod(target, "count", (count) => () => count() + 1);
    unpatchA();
    expect(target.count).toBe(original);
    unpatchA();
    expect(target.count).toBe(original);

    const unpatchB = patchMethod(target, "count", (count) => () => count() + 2);
    unpatchA();
    expect(target.count()).toBe(2);
    unpatchB();
    expect(target.count).toBe(original);
  });

  test("separate objects and methods keep separate stacks", () => {
    const first = { value: () => "first" };
    const second = { value: () => "second" };
    const unpatchA = patchMethod(first, "value", (value) => () => `${value()} a`);
    const unpatchB = patchMethod(second, "value", (value) => () => `${value()} b`);

    expect(first.value()).toBe("first a");
    expect(second.value()).toBe("second b");
    unpatchA();
    unpatchB();
    expect(first.value()).toBe("first");
    expect(second.value()).toBe("second");
  });
});

describe("isTypingTarget", () => {
  class FakeElement {
    constructor(
      readonly tagName: string,
      readonly isContentEditable = false,
    ) {}
  }

  beforeEach(() => vi.stubGlobal("HTMLElement", FakeElement));
  afterEach(() => vi.unstubAllGlobals());

  const keyEvent = (target: unknown, path: unknown[]) => {
    const event = new Event("keydown");
    Object.defineProperty(event, "target", { value: target });
    Object.defineProperty(event, "composedPath", { value: () => path });
    return event;
  };

  test("recognises fields by their tag and contenteditable", () => {
    expect(isTypingTarget(new FakeElement("INPUT") as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement("TEXTAREA") as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement("SELECT") as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement("DIV", true) as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement("DIV") as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  test("finds the focused field through a shadow host that retargeted the event", () => {
    const host = new FakeElement("PEAR-SEARCH");
    const input = new FakeElement("INPUT");
    expect(isTypingTarget(keyEvent(host, [input, host]))).toBe(true);
    // Without the field in the path, the host itself decides.
    expect(isTypingTarget(keyEvent(host, [host]))).toBe(false);
  });
});
