import * as net from 'node:net';

import is from 'electron-is';
import { SocksClient, type SocksClientOptions } from 'socks';

import * as config from '@/config';
import { createBackend, LoggerPrefix } from '@/utils';

import { type AuthProxyConfig, defaultAuthProxyConfig } from '../config';

import type { BackendType } from './types';
import type { BackendContext } from '@/types/contexts';

const parseSocksUrl = (socksUrl: string) => {
  // socks5://username:password@host:port
  const url = URL.parse(socksUrl);
  if (!url) return null;
  return {
    host: url.hostname,
    port: parseInt(url.port, 10),
    type: url.protocol === 'socks5:' ? 5 : 4,
    username: url.username,
    password: url.password,
  };
};

export const backend = createBackend<BackendType, AuthProxyConfig>({
  async start(ctx: BackendContext<AuthProxyConfig>) {
    const pluginConfig = await ctx.getConfig();
    this.startServer(pluginConfig);
  },
  stop() {
    this.stopServer();
  },
  onConfigChange(config: AuthProxyConfig) {
    if (
      this.oldConfig?.hostname === config.hostname &&
      this.oldConfig?.port === config.port
    ) {
      this.oldConfig = config;
      return;
    }
    this.stopServer();
    this.startServer(config);

    this.oldConfig = config;
  },

  // Custom
  startServer(serverConfig: AuthProxyConfig) {
    if (this.server) {
      this.stopServer();
    }

    const { port, hostname } = serverConfig;
    // Upstream proxy from system settings
    const upstreamProxyUrl = config.get('options.proxy');
    const socksServer = net.createServer((socket) => {
      // Greeting may arrive fragmented, and a pipelined client may send it in
      // the same segment as CONNECT — the request bytes must not be dropped.
      let greetingChunks: Buffer[] = [];

      const onGreeting = (chunk: Buffer) => {
        if (!Buffer.isBuffer(chunk)) return;
        greetingChunks.push(chunk);
        const greeting = Buffer.concat(greetingChunks);
        if (greeting.length < 2) return; // VER + NMETHODS incomplete

        const numMethods = greeting[1];
        if (greeting.length < 2 + numMethods) return; // methods incomplete

        const remainder = greeting.subarray(2 + numMethods);
        greetingChunks = [];
        socket.off('data', onGreeting);
        this.handleSocks5(socket, greeting, remainder, upstreamProxyUrl);
      };

      socket.on('data', onGreeting);

      socket.on('error', (err) => {
        console.error(LoggerPrefix, '[SOCKS] Socket error:', err.message);
      });
    });

    socksServer.on('error', (err) => {
      console.error(LoggerPrefix, '[SOCKS Server Error]', err.message);
    });

    socksServer.listen(port, hostname, () => {
      console.log(LoggerPrefix, '===========================================');
      console.log(
        LoggerPrefix,
        `[Auth-Proxy-Adapter] Enable SOCKS proxy at socks5://${hostname}:${port}`,
      );
      console.log(
        LoggerPrefix,
        `[Auth-Proxy-Adapter] Using upstream proxy: ${upstreamProxyUrl}`,
      );
      console.log(LoggerPrefix, '===========================================');
    });

    this.server = socksServer;
  },

  handleSocks5(
    clientSocket: net.Socket,
    greeting: Buffer,
    remainder: Buffer,
    upstreamProxyUrl: string,
  ) {
    const numMethods = greeting[1];
    const methods = greeting.subarray(2, 2 + numMethods);

    if (methods.includes(0x00)) {
      clientSocket.write(Buffer.from([0x05, 0x00])); // accept: no auth

      // The CONNECT request may arrive in a later segment than the greeting.
      const requestChunks: Buffer[] = [];
      const onData = (data: Buffer) => {
        if (!Buffer.isBuffer(data)) return;
        requestChunks.push(data);

        // VER+CMD+RSV+ATYP (4) + addr + port (2); addr length varies by ATYP.
        const buffer = Buffer.concat(requestChunks);
        if (buffer.length < 4) return;

        const atyp = buffer[3];
        let headerLength: number;
        if (atyp === 0x01) headerLength = 4 + 4 + 2;
        else if (atyp === 0x04) headerLength = 4 + 16 + 2;
        else if (atyp === 0x03) {
          if (buffer.length < 5) return;
          headerLength = 4 + 1 + buffer[4] + 2;
        } else {
          headerLength = buffer.length; // unknown ATYP: reject downstream
        }

        if (buffer.length < headerLength) return;

        clientSocket.off('data', onData);
        this.processSocks5Request(clientSocket, buffer, upstreamProxyUrl);
      };
      clientSocket.on('data', onData);
      // Re-feed bytes pipelined right after the greeting
      if (remainder.length > 0) onData(remainder);
    } else {
      clientSocket.write(Buffer.from([0x05, 0xff])); // no acceptable method
      clientSocket.end();
    }
  },

  processSocks5Request(
    clientSocket: net.Socket,
    data: Buffer,
    upstreamProxyUrl: string,
  ) {
    let targetHost, targetPort;
    const cmd = data[1]; // Command: 0x01=CONNECT, 0x02=BIND, 0x03=UDP
    const atyp = data[3]; // Address type: 0x01=IPv4, 0x03=Domain, 0x04=IPv6

    if (cmd !== 0x01) {
      // Only CONNECT is supported
      clientSocket.write(
        Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      clientSocket.end();
      return;
    }

    if (atyp === 0x01) {
      targetHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
      targetPort = data.readUInt16BE(8);
    } else if (atyp === 0x03) {
      const hostLen = data[4];
      targetHost = data.subarray(5, 5 + hostLen).toString();
      targetPort = data.readUInt16BE(5 + hostLen);
    } else if (atyp === 0x04) {
      const ipv6Buffer = data.subarray(4, 20);
      targetHost = Array.from(new Array(8), (_, i) =>
        ipv6Buffer.readUInt16BE(i * 2).toString(16),
      ).join(':');
      targetPort = data.readUInt16BE(20);
    } else {
      // Unknown ATYP: reply 0x08 rather than fall through to the defaults below.
      clientSocket.write(
        Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      clientSocket.end();
      return;
    }
    if (is.dev()) {
      console.debug(
        LoggerPrefix,
        `[SOCKS5] Request to connect to ${targetHost}:${targetPort}`,
      );
    }

    const socksProxy = parseSocksUrl(upstreamProxyUrl);

    if (!socksProxy) {
      clientSocket.write(
        Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      clientSocket.end();
      return;
    }

    const options: SocksClientOptions = {
      proxy: {
        host: socksProxy.host,
        port: socksProxy.port,
        type: socksProxy.type as 4 | 5,
        userId: socksProxy.username,
        password: socksProxy.password,
      },
      command: 'connect',
      destination: {
        host: targetHost || defaultAuthProxyConfig.hostname,
        port: targetPort || defaultAuthProxyConfig.port,
      },
    };
    SocksClient.createConnection(options)
      .then((info) => {
        const { socket: proxySocket } = info;

        const responseBuffer = Buffer.from([
          0x05, // VER: SOCKS5
          0x00, // REP: Success
          0x00, // RSV
          0x01, // ATYP: IPv4
          0,
          0,
          0,
          0, // BND.ADDR: 0.0.0.0
          0,
          0, // BND.PORT: 0
        ]);
        clientSocket.write(responseBuffer);

        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);

        proxySocket.on('error', (error) => {
          console.error(LoggerPrefix, '[SOCKS5] Proxy socket error:', error);
          if (clientSocket.writable) clientSocket.end();
        });

        clientSocket.on('error', (error) => {
          console.error(LoggerPrefix, '[SOCKS5] Client socket error:', error);
          if (proxySocket.writable) proxySocket.end();
        });
      })
      .catch((error) => {
        console.error(LoggerPrefix, '[SOCKS5] Connection error:', error);
        clientSocket.write(
          Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
        clientSocket.end();
      });
  },

  stopServer() {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  },
});
