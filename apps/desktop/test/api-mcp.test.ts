import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleMcpRequest } from "../src/main/api/mcp.ts";
import type { McpTool } from "../src/main/api/mcp-tools.ts";

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

const tools: McpTool[] = [
  { name: "ping", description: "Answer pong.", input: { type: "object" }, readOnly: true, run: async () => text("pong") },
  {
    name: "echo",
    description: "Echo the text back.",
    input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: async (args) => text(String(args.text)),
  },
  { name: "fail", description: "Fail on purpose.", input: { type: "object" }, run: async () => ({ ...text("nope"), isError: true }) },
];

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start() {
  const server = createServer((req, res) => void handleMcpRequest(req, res, tools));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

const rpc = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });

describe("MCP endpoint", () => {
  it("handshakes, lists tools and calls one", async () => {
    const url = await start();
    const init = await rpc(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(init.status).toBe(200);
    const initialized = await init.json();
    expect(initialized.result.protocolVersion).toBe("2025-06-18");
    expect(initialized.result.capabilities.tools).toBeTruthy();

    const list = await (await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["ping", "echo", "fail"]);
    expect(list.result.tools[0].annotations).toEqual({ readOnlyHint: true });

    const call = await (
      await rpc(url, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } })
    ).json();
    expect(call.result).toEqual(text("hi"));
  });

  it("reports tool failures as results and unknown methods as errors", async () => {
    const url = await start();
    const failed = await (await rpc(url, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "fail" } })).json();
    expect(failed.result).toMatchObject({ isError: true, content: [{ type: "text", text: "nope" }] });

    const unknown = await (await rpc(url, { jsonrpc: "2.0", id: 5, method: "nope" })).json();
    expect(unknown.error.code).toBe(-32601);
  });

  it("accepts notifications without a body and rejects other methods", async () => {
    const url = await start();
    const notification = await rpc(url, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");

    expect((await fetch(url, { method: "GET" })).status).toBe(405);
    const malformed = await fetch(url, { method: "POST", body: "not json" });
    expect(malformed.status).toBe(400);
  });
});
