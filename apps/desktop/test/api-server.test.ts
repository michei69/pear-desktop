import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { startServer, type ServerOptions } from "../src/main/api/server.ts";
import type { Route } from "../src/main/api/types.ts";

const echo: Route = {
  method: "QUERY",
  path: "/echo",
  summary: "Echo the text back",
  body: { text: "string" },
  handle: ({ body }) => ({ status: 200, body: { text: body.text } }),
};

const options = (routes: readonly Route[]): ServerOptions => ({
  hostname: "127.0.0.1",
  port: 0,
  routes,
  rpcMethods: () => [],
  auth: () => ({ authStrategy: "NONE", secret: "", authorizedClients: [] }),
  onSocket: () => undefined,
  onError: () => undefined,
});

/** Starts the server on a free port; the caller closes it. */
async function start(routes: readonly Route[]) {
  const running = await startServer(options(routes));
  const { port } = running.server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => running.close() };
}

describe("QUERY method", () => {
  it("carries a JSON body like POST", async () => {
    const { base, close } = await start([echo]);
    try {
      const response = await fetch(`${base}/echo`, {
        method: "QUERY",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ text: "hi" });
      // A wrong method on a known path is still 405, not 404.
      expect((await fetch(`${base}/echo`, { method: "POST" })).status).toBe(405);
    } finally {
      close();
    }
  });

  it("is offered in the CORS preflight and the OpenAPI document", async () => {
    const { base, close } = await start([echo]);
    try {
      const preflight = await fetch(`${base}/echo`, { method: "OPTIONS" });
      expect(preflight.headers.get("access-control-allow-methods")).toContain("QUERY");

      const document = await (await fetch(`${base}/doc`)).json();
      expect(document.openapi).toBe("3.1.0");
      expect(document.paths["/echo"].post).toMatchObject({ summary: "Echo the text back" });
    } finally {
      close();
    }
  });
});
