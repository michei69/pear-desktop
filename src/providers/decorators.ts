export function singleton<T extends (...params: never[]) => unknown>(fn: T): T {
  let called = false;

  return ((...args) => {
    if (called) {
      return;
    }

    called = true;
    return fn(...args);
  }) as T;
}

export function debounce<T extends (...params: never[]) => unknown>(
  fn: T,
  delay: number,
): T {
  let timeout: NodeJS.Timeout;
  return ((...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  }) as T;
}

export function cacheNoArgs<R>(fn: () => R): () => R {
  let cached: R;
  return () => {
    if (cached === undefined) {
      cached = fn();
    }
    return cached;
  };
}
