import { once } from "node:events";
import { connect, type Socket } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { startAdapter } from "../adapter.ts";

const socks = vi.hoisted(() => ({ createConnection: vi.fn() }));

vi.mock("socks", () => ({ SocksClient: { createConnection: socks.createConnection } }));

const log = { info() {}, warn() {}, error() {} };
const servers: { close(): void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  socks.createConnection.mockReset();
});

/** Speaks SOCKS5 to the adapter and buffers what comes back. */
async function connectTo(port: number) {
  const socket: Socket = connect(port, "127.0.0.1");
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => (buffer = Buffer.concat([buffer, chunk])));
  await once(socket, "connect");
  return {
    socket,
    read: async (n: number) => {
      while (buffer.length < n) await once(socket, "data");
      const out = buffer.subarray(0, n);
      buffer = buffer.subarray(n);
      return out;
    },
  };
}

test("bounds the upstream connect and reports the failure to the client", async () => {
  let failUpstream!: (error: Error) => void;
  socks.createConnection.mockImplementation(() => new Promise((_resolve, reject) => (failUpstream = reject)));
  const adapter = await startAdapter(
    { host: "127.0.0.1", port: 1080, type: 5, username: "alice", password: "secret" },
    { host: "127.0.0.1", port: 0 },
    log,
  );
  servers.push(adapter);

  const { socket, read } = await connectTo(adapter.port);
  socket.write(Buffer.from([0x05, 0x01, 0x00]));
  expect([...(await read(2))]).toEqual([0x05, 0x00]);
  const host = Buffer.from("example.com");
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host, Buffer.from([0x00, 0x50])]));

  await vi.waitFor(() => expect(socks.createConnection).toHaveBeenCalledOnce());
  // A hung upstream must not hold the client forever.
  const options = socks.createConnection.mock.calls[0]![0] as { timeout: number; proxy: { userId: string } };
  expect(options.timeout).toBe(30_000);
  expect(options.proxy.userId).toBe("alice");

  failUpstream(new Error("proxy connection timed out"));
  const [, code] = await read(10);
  expect(code).not.toBe(0x00);
  socket.destroy();
});
