export const waitForElement = <T extends Element>(
  selector: string,
  options: {
    maxRetry?: number;
    retryInterval?: number;
    timeout?: number;
  } = {
    maxRetry: -1,
    retryInterval: 100,
  },
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    let retryCount = 0;
    const maxRetry = options.maxRetry ?? -1;
    const retryInterval = options.retryInterval ?? 100;
    const timeout = options.timeout ?? 30_000;

    const interval = setInterval(() => {
      if (maxRetry > 0 && retryCount >= maxRetry) {
        clearInterval(interval);
        clearTimeout(timeoutHandle);
        reject(new Error(`waitForElement: max retries (${maxRetry}) reached for "${selector}"`));
        return;
      }
      const elem = document.querySelector<T>(selector);
      if (!elem) {
        retryCount++;
        return;
      }

      clearInterval(interval);
      clearTimeout(timeoutHandle);
      resolve(elem);
    }, retryInterval);

    const timeoutHandle = setTimeout(() => {
      clearInterval(interval);
      reject(
        new Error(
          `waitForElement: timeout (${timeout}ms) waiting for "${selector}"`,
        ),
      );
    }, timeout);
  });
};
