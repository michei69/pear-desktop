import { describe, expect, test } from "vitest";
import { buildLabel, channel, commit, copyright, defaultUpdateChannel, updatesSupported } from "../src/main/app-info.ts";

describe("build metadata", () => {
  test("unbaked builds are development builds", () => {
    expect(channel).toBe("dev");
    expect(commit).toBe("");
    expect(buildLabel()).toBe("dev");
    expect(updatesSupported()).toBe(false);
    expect(defaultUpdateChannel()).toBe("stable");
  });

  test("labels carry the channel and commit, except for stable", () => {
    expect(buildLabel("beta", "1a2b3c4")).toBe("beta 1a2b3c4");
    expect(buildLabel("dev", "1a2b3c4")).toBe("dev 1a2b3c4");
    expect(buildLabel("stable", "1a2b3c4")).toBe("stable");
    expect(buildLabel("beta", "")).toBe("beta");
  });

  test("beta builds follow the beta channel and support updates", () => {
    expect(updatesSupported("stable")).toBe(true);
    expect(updatesSupported("beta")).toBe(true);
    expect(defaultUpdateChannel("beta")).toBe("beta");
    expect(defaultUpdateChannel("stable")).toBe("stable");
  });

  test("copyright names the upstream author and this fork's maintainer", () => {
    expect(copyright).toContain("th-ch");
    expect(copyright).toContain("michei69");
  });
});
