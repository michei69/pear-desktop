export const API_VERSION = 'v1';

/** Prefix every versioned route is mounted under. */
export const API_PREFIX = `/api/${API_VERSION}`;

/**
 * WebSocket endpoint. It lives under the API prefix but authenticates with a
 * `?token=` query param instead of the `Authorization` header, because browsers
 * cannot set headers on a WebSocket handshake.
 */
export const WS_PATH = `${API_PREFIX}/ws`;
