import { toJsonSchema, v } from "@pear/sdk/rpc";
import { describe, expect, it } from "vitest";
import { createMcpTools } from "../src/main/api/mcp-tools.ts";
import type { Operations } from "../src/main/api/operations.ts";

// The tools are bound to operations the tests never call: only their schemas are read.
const tools = createMcpTools({} as unknown as Operations);
const tool = (name: string) => tools.find((entry) => entry.name === name)!;

describe("MCP tool schemas", () => {
  it("publishes every tool's input as JSON schema", () => {
    for (const entry of tools) {
      const schema = toJsonSchema(entry.input, { errorMode: "ignore" });
      expect(schema, entry.name).toMatchObject({ type: "object" });
    }
  });

  it("rejects the arguments the operations would turn into NaN or undefined", () => {
    expect(v.safeParse(tool("set_volume").input, { volume: "loud" }).success).toBe(false);
    expect(v.safeParse(tool("set_volume").input, { volume: 50 }).success).toBe(true);
    expect(v.safeParse(tool("move_in_queue").input, {}).success).toBe(false);
    expect(v.safeParse(tool("move_in_queue").input, { index: 1, toIndex: 0 }).success).toBe(true);
    expect(v.safeParse(tool("play_video").input, {}).success).toBe(false);
    expect(v.safeParse(tool("delete_feature_flags").input, {}).success).toBe(false);
    // No-argument tools accept an empty call.
    expect(v.safeParse(tool("play").input, {}).success).toBe(true);
  });
});
