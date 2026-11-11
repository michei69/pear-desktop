import { describe, expect, test } from "vitest";
import { type Command, isCommandLine, matchCommands, tokenize } from "../commands.ts";

const command = (name: string, args?: Command["args"], description = `${name} description`): Command => ({
  name,
  ...(args ? { args } : {}),
  description,
  run: () => {},
});

const commands: Command[] = [
  command("settings"),
  command("play", [{ name: "url" }], "Play a video"),
  command("playlist", [{ name: "id" }, { name: "index", optional: true }]),
  command("search", [{ name: "query" }]),
];

const texts = (value: string) => matchCommands(value, commands).map((row) => row.text);

describe("matchCommands", () => {
  test("a bare slash lists every command", () => {
    expect(texts("/")).toEqual(["/play <url>", "/playlist <id> [index]", "/search <query>", "/settings"]);
  });

  test("a partial name filters by prefix", () => {
    expect(texts("/pl")).toEqual(["/play <url>", "/playlist <id> [index]"]);
  });

  test("a fully typed name previews its arguments as placeholders", () => {
    const [row] = matchCommands("/play", commands);
    expect(row!.text).toBe("/play <url>");
    expect(row!.args).toEqual(["<url>"]);
    expect(row!.description).toBe("Play a video");
  });

  test("typed arguments replace their placeholders, left to right", () => {
    expect(texts("/play sOmEiD")).toEqual(["/play sOmEiD"]);
    expect(texts("/playlist PL123")).toEqual(["/playlist PL123 [index]"]);
    expect(texts("/playlist PL123 4")).toEqual(["/playlist PL123 4"]);
  });

  test("a trailing space keeps the placeholder visible while typing", () => {
    expect(texts("/play ")).toEqual(["/play <url>"]);
  });

  test("arguments past the declared ones are ignored", () => {
    expect(texts("/play a b c")).toEqual(["/play a"]);
  });

  test("an unknown name with arguments matches nothing", () => {
    expect(texts("/nope x")).toEqual([]);
    expect(texts("/nope")).toEqual([]);
  });

  test("optional arguments render as [name]", () => {
    const [row] = matchCommands("/playlist", commands);
    expect(row!.text).toBe("/playlist <id> [index]");
  });

  test("the exact name sorts before longer names sharing its prefix", () => {
    expect(matchCommands("/play", commands).map((row) => row.name)).toEqual(["play", "playlist"]);
  });
});

describe("isCommandLine", () => {
  test("only a leading slash is a command line", () => {
    expect(isCommandLine("/play")).toBe(true);
    expect(isCommandLine("play")).toBe(false);
    expect(isCommandLine("")).toBe(false);
  });
});

describe("tokenize", () => {
  test("drops the slash and splits on whitespace", () => {
    expect(tokenize("/play a b")).toEqual(["play", "a", "b"]);
    expect(tokenize("/")).toEqual([""]);
  });
});
