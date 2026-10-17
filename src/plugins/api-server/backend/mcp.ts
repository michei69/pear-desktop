/**
 * The MCP endpoint: Streamable HTTP, mounted on the root app and guarded like
 * the rest of the API. Stateless — every POST gets its own server and
 * transport, as the transport requires for session-less use — with JSON
 * responses. There is no session stream, so GET and DELETE have nothing to
 * answer; clients only POST JSON-RPC.
 *
 * Deliberately knows nothing about the tools' implementations: they are built
 * in `mcp-tools.ts` and handed in, so this file only speaks MCP.
 */
// TODO: remove once this PR has landed.
// reviewdog installs the base branch's dependencies, which don't include
// @modelcontextprotocol/sdk yet: the imports then resolve to `any`, and every
// use in this file trips the unsafe-* rules. They resolve normally wherever the
// package is installed, so the rules are off here only until the merge puts the
// dependency on the base branch.
/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import type { APIServerConfig } from '../config';
import type { McpTool } from './mcp-tools';
import type { BackendContext } from '@/types/contexts';
import type { OpenAPIHono } from '@hono/zod-openapi';

/**
 * MCP clients get every tool's description in the list, so the endpoint has no
 * public version; it is not a REST surface to keep versioning promises about.
 */
export const MCP_PATH = '/mcp';

/** Shown by MCP clients in their server list. */
const SERVER_INFO = { name: 'pear-desktop', version: '2.1.0' };

const createServer = (tools: McpTool[]) => {
  const server = new McpServer(SERVER_INFO);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.readOnly ? { readOnlyHint: true } : undefined,
      },
      async (args) => tool.run((args ?? {}) as Record<string, unknown>),
    );
  }

  return server;
};

/** Mounts the endpoint; `tools` do the work, this only speaks the protocol. */
export const registerMcp = (
  app: OpenAPIHono,
  { getConfig }: BackendContext<APIServerConfig>,
  tools: McpTool[],
) => {
  app.all(MCP_PATH, async (c) => {
    // Read per request, so the switch applies without restarting the server.
    if (!(await getConfig()).mcpEnabled) {
      return c.notFound();
    }

    if (c.req.method !== 'POST') {
      return c.body(null, 405);
    }

    // A fresh server per request: the stateless transport rejects reuse, since
    // two clients can otherwise collide on JSON-RPC ids.
    const server = createServer(tools);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);

    return transport.handleRequest(c.req.raw);
  });
};
