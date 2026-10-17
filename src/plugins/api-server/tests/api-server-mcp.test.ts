/**
 * The MCP endpoint's protocol seam: the JSON-RPC handshake, the tool list, and
 * how a tool's answer (or failure) reaches the client.
 *
 * The tools themselves are built in `mcp-tools.ts` — they import Electron, so
 * these tests hand the endpoint fake tools instead of loading that module.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { expect, test } from '@playwright/test';

import { MCP_PATH, registerMcp } from '../backend/mcp';
import { defaultAPIServerConfig, type APIServerConfig } from '../config';

import type { McpTool, McpToolResult } from '../backend/mcp-tools';
import type { BackendContext } from '@/types/contexts';

const MCP_HEADERS = {
  'content-type': 'application/json',
  'accept': 'application/json, text/event-stream',
};

const text = (value: string): McpToolResult => ({
  content: [{ type: 'text', text: value }],
});

/** Stand-ins for the real tools; the endpoint must not care what they do. */
const testTools: McpTool[] = [
  {
    name: 'ping',
    description: 'Answer pong.',
    input: z.object({}),
    readOnly: true,
    run: () => Promise.resolve(text('pong')),
  },
  {
    name: 'echo',
    description: 'Echo the text back.',
    input: z.object({ text: z.string() }),
    run: (args) => Promise.resolve(text(String(args.text))),
  },
  {
    name: 'fail',
    description: 'Fail on purpose.',
    input: z.object({}),
    run: () => Promise.resolve({ ...text('nope'), isError: true }),
  },
  {
    name: 'throw',
    description: 'Throw on purpose.',
    input: z.object({}),
    run: () => Promise.reject(new Error('boom')),
  },
];

/** The parts of a JSON-RPC answer these tests read. */
type RpcAnswer = {
  result?: {
    content?: { type: string; text: string }[];
    isError?: boolean;
    capabilities?: { tools?: unknown };
    serverInfo?: { name?: string };
    tools?: {
      name: string;
      description?: string;
      annotations?: { readOnlyHint?: boolean };
      inputSchema?: { type?: string };
    }[];
  };
};

let config: APIServerConfig = { ...defaultAPIServerConfig, mcpEnabled: true };

const createTestApp = () => {
  const app = new OpenAPIHono();
  registerMcp(
    app,
    {
      getConfig: () => config,
    } as unknown as BackendContext<APIServerConfig>,
    testTools,
  );

  return app;
};

/** One JSON-RPC POST to the MCP endpoint. */
const rpc = async (app: OpenAPIHono, body: unknown) => {
  const response = await app.request(MCP_PATH, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  });

  const bodyText = await response.text();
  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');

  return {
    status: response.status,
    json: isJson ? (JSON.parse(bodyText) as RpcAnswer) : undefined,
  };
};

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
};

const callTool = (
  app: OpenAPIHono,
  name: string,
  args: Record<string, unknown> = {},
) =>
  rpc(app, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name, arguments: args },
  });

test.beforeEach(() => {
  config = { ...defaultAPIServerConfig, mcpEnabled: true };
});

// ------------------------------------------------------------- the switch ---

test('the MCP server is off by default', () => {
  expect(defaultAPIServerConfig.mcpEnabled).toBe(false);
});

test('the endpoint is not versioned', () => {
  expect(MCP_PATH).toBe('/mcp');
});

test('a disabled MCP server answers 404, even to a valid handshake', async () => {
  config = { ...defaultAPIServerConfig, mcpEnabled: false };

  const { status } = await rpc(createTestApp(), initialize);

  expect(status).toBe(404);
});

// ------------------------------------------------------------ the protocol ---

test('initialize reports the tools capability', async () => {
  const { status, json } = await rpc(createTestApp(), initialize);

  expect(status).toBe(200);
  expect(json?.result?.capabilities?.tools).toBeDefined();
  expect(json?.result?.serverInfo?.name).toBe('pear-desktop');
});

test('tools/list carries the names, descriptions and read-only hints', async () => {
  const { json } = await rpc(createTestApp(), {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  const tools = json?.result?.tools ?? [];

  expect(tools.map(({ name }) => name)).toEqual([
    'ping',
    'echo',
    'fail',
    'throw',
  ]);
  expect(tools.find(({ name }) => name === 'ping')?.description).toBe(
    'Answer pong.',
  );
  expect(tools.find(({ name }) => name === 'ping')?.annotations).toEqual({
    readOnlyHint: true,
  });
  expect(
    tools.find(({ name }) => name === 'echo')?.annotations,
  ).toBeUndefined();
  for (const { inputSchema } of tools) {
    expect(inputSchema?.type).toBe('object');
  }
});

test('a tool answer reaches the client as text', async () => {
  const { json } = await callTool(createTestApp(), 'ping');

  expect(json?.result?.content).toEqual([{ type: 'text', text: 'pong' }]);
});

test('validated arguments are handed to the tool', async () => {
  const { json } = await callTool(createTestApp(), 'echo', { text: 'hi' });

  expect(json?.result?.content).toEqual([{ type: 'text', text: 'hi' }]);
});

test('arguments that fail the input schema never reach the tool', async () => {
  // `echo` requires `text`; the handler would have returned "undefined".
  const { json } = await callTool(createTestApp(), 'echo');

  expect(json?.result?.isError).toBe(true);
  expect(json?.result?.content?.[0].text).toContain('text');
});

test('a tool error answer passes through', async () => {
  const { json } = await callTool(createTestApp(), 'fail');

  expect(json?.result?.isError).toBe(true);
  expect(json?.result?.content?.[0].text).toBe('nope');
});

test('a throwing tool becomes an error answer, not a broken response', async () => {
  const { json } = await callTool(createTestApp(), 'throw');

  expect(json?.result?.isError).toBe(true);
  expect(json?.result?.content?.[0].text).toContain('boom');
});

test('get and delete are refused: there is no session stream to serve', async () => {
  const app = createTestApp();

  for (const method of ['GET', 'DELETE']) {
    const response = await app.request(MCP_PATH, {
      method,
      headers: MCP_HEADERS,
    });
    expect(response.status).toBe(405);
  }
});
