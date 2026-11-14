import { once } from "node:events";
import { type AddressInfo, connect, type Server, type Socket } from "node:net";
import type { Logger } from "@pear/sdk";

export const log: Logger = { info() {}, warn() {}, error() {} };

export const servers: { close(): void }[] = [];

export function closeServers() {
  for (const server of servers.splice(0)) server.close();
}

export async function listen(server: Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

/** Reads from a socket until `n` bytes are available. */
export function readable(socket: Socket) {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => (buffer = Buffer.concat([buffer, chunk])));
  return async (n: number) => {
    while (buffer.length < n) await once(socket, "data");
    const out = buffer.subarray(0, n);
    buffer = buffer.subarray(n);
    return out;
  };
}

/** Speaks SOCKS5 to the adapter and buffers what comes back. */
export async function connectTo(port: number) {
  const socket: Socket = connect(port, "127.0.0.1");
  const read = readable(socket);
  await once(socket, "connect");
  return { socket, read };
}
