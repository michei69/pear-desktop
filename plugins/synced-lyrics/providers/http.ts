export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;
// LRCLIB asks clients to identify themselves.
const USER_AGENT = "Pear Desktop (synced-lyrics; https://github.com/pear-devs/pear-desktop)";

/** A non-2xx answer, with the status and `Retry-After` providers need for backoff. */
export class HttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | undefined;

  constructor(host: string, status: number, retryAfter?: string | null) {
    super(`${host} responded ${status}`);
    this.status = status;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

export async function request(fetch: Fetch, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new HttpError(new URL(url).host, response.status, response.headers.get("retry-after"));
  return response;
}

export async function getJson<T>(fetch: Fetch, url: string, init?: RequestInit): Promise<T> {
  return (await request(fetch, url, init)).json() as Promise<T>;
}
