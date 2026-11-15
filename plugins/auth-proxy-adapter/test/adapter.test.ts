import { afterEach, expect, test, vi } from "vitest";
import { startAdapter } from "../adapter.ts";
import { closeServers, connectTo, log, servers } from "./harness.ts";

const socks = vi.hoisted(() => ({ createConnection: vi.fn() }));

vi.mock("socks", () => ({ SocksClient: { createConnection: socks.createConnection } }));

afterEach(() => {
  closeServers();
  socks.createConnection.mockReset();
});

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
