import { net } from 'electron';

export const getNetFetchAsFetch = (): typeof fetch =>
  ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

    if (init?.body && !init.method) {
      init.method = 'POST';
    }

    const request = new Request(
      url,
      input instanceof Request ? input : undefined,
    );

    return net.fetch(request, init) as unknown as Response;
  }) as unknown as typeof fetch;
