export enum AuthStrategy {
  AUTH_AT_FIRST = 'AUTH_AT_FIRST',
  NONE = 'NONE',
}

export interface APIServerConfig {
  enabled: boolean;
  hostname: string;
  port: number;
  authStrategy: AuthStrategy;
  secret: string;

  authorizedClients: string[];
  useHttps: boolean;
  certPath: string;
  keyPath: string;

  /** Serves the MCP endpoint at `/mcp`; off unless the user opts in. */
  mcpEnabled: boolean;
}

export const defaultAPIServerConfig: APIServerConfig = {
  enabled: false,
  hostname: '127.0.0.1',
  port: 26538,
  authStrategy: AuthStrategy.AUTH_AT_FIRST,
  // Signs the access tokens; must not be guessable. `crypto` is the Web Crypto
  // API, which exists in both the renderer and the main process — this module
  // is imported by the renderer too, where `node:crypto` isn't available.
  secret: crypto.randomUUID(),

  authorizedClients: [],
  useHttps: false,
  certPath: '',
  keyPath: '',

  mcpEnabled: false,
};
