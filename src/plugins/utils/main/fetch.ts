import { net } from 'electron';

export const getNetFetchAsFetch = (): typeof fetch =>
  ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

    const requestInit =
      init?.body && !init.method ? { ...init, method: 'POST' } : init;

    const request = new Request(
      url,
      input instanceof Request ? input : undefined,
    );

    return net.fetch(request, requestInit) as unknown as Response;
  }) as unknown as typeof fetch;
