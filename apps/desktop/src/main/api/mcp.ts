// The MCP endpoint: Streamable HTTP, stateless, JSON responses. Every POST is
// self-contained, so no session state or stream is kept; GET and DELETE have
// nothing to answer and report 405. Authentication and the `mcpEnabled` gate
// are the server's (the same token as the REST API).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpTool } from "./mcp-tools.ts";

export const MCP_PATH = "/mcp";
/** Shown by MCP clients in their server list. */
const SERVER_INFO = { name: "pear-desktop", version: "2.1.0" };
const MAX_BODY_BYTES = 1 << 20;
const FALLBACK_PROTOCOL = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

type JsonRpcResponse = { jsonrpc: "2.0"; id: unknown; result?: unknown; error?: { code: number; message: string } };

function readBody(req: IncomingMessage) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(new Error("body too large"));
      req.destroy();
    } else chunks.push(chunk);
  });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
  return promise;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const error = (id: unknown, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

async function handleCall(tools: readonly McpTool[], id: unknown, params: Record<string, unknown>): Promise<JsonRpcResponse> {
  const name = params.name;
  const args = isObject(params.arguments) ? params.arguments : {};
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) return error(id, -32602, `Unknown tool: ${String(name)}`);
  try {
    return { jsonrpc: "2.0", id, result: await tool.run(args) };
  } catch (cause) {
    return {
      jsonrpc: "2.0",
      id,
      result: { isError: true, content: [{ type: "text", text: cause instanceof Error ? cause.message : String(cause) }] },
    };
  }
}

async function handleMessage(tools: readonly McpTool[], message: JsonRpcRequest) {
  const { id, method, params } = message;
  const notification = id === undefined || id === null;
  const settings = isObject(params) ? params : {};

  if (typeof method !== "string") {
    return notification ? undefined : error(id, -32600, "Invalid Request");
  }
  if (method.startsWith("notifications/")) return undefined;

  if (notification) return undefined;

  switch (method) {
    case "initialize": {
      const requested = settings.protocolVersion;
      const protocolVersion = typeof requested === "string" ? requested : FALLBACK_PROTOCOL;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "Pear Desktop's player controls, queue, search, lyrics and config.",
        },
      } satisfies JsonRpcResponse;
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} } satisfies JsonRpcResponse;
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.input,
            ...(tool.readOnly ? { annotations: { readOnlyHint: true } } : {}),
          })),
        },
      } satisfies JsonRpcResponse;
    case "tools/call":
      return handleCall(tools, id, settings);
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }).end(JSON.stringify(body));
}

/** Answers one MCP request; the caller has already checked auth and the switch. */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, tools: readonly McpTool[]) {
  if (req.method !== "POST") {
    send(res, 405);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, error(null, -32700, "Parse error"));
    return;
  }

  if (Array.isArray(parsed)) {
    const responses = (await Promise.all(parsed.filter(isObject).map((message) => handleMessage(tools, message as JsonRpcRequest)))).filter(
      (response): response is JsonRpcResponse => response !== undefined,
    );
    send(res, responses.length ? 200 : 202, responses.length ? responses : undefined);
    return;
  }

  if (!isObject(parsed)) {
    send(res, 400, error(null, -32600, "Invalid Request"));
    return;
  }

  const response = await handleMessage(tools, parsed as JsonRpcRequest);
  send(res, response ? 200 : 202, response);
}

export { SERVER_INFO };
