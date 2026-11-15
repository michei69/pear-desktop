import type { Fetch } from "../services.ts";

export function fakeFetch(reply: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return new Response(JSON.stringify(reply), { status });
  };
  return { fetch, calls };
}
