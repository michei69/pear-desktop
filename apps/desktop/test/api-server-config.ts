import type { ApiServerConfig } from "@pear/sdk/core-config";

export const API_SERVER_CONFIG: ApiServerConfig = {
  enabled: false,
  hostname: "127.0.0.1",
  port: 26538,
  authStrategy: "AUTH_AT_FIRST",
  authorizedClients: [],
  secret: "",
  mcpEnabled: false,
  useHttps: false,
  certPath: "",
  keyPath: "",
};
