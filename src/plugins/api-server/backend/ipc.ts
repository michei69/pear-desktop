import { ipcMain, type BrowserWindow } from 'electron';

import { apiReply, apiRequest, type ApiAction } from '../channels';

/** How long a renderer getter gets to answer before the call rejects. */
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Subscribes to a main-process IPC channel and returns the unsubscribe.
 *
 * Removes the exact listener: `ctx.ipc.on` wraps handlers and can only remove
 * all listeners on the channel, which would drop other plugins' listeners too.
 */
export const subscribeIpc = <T>(
  channel: string,
  handler: (payload: T) => void,
) => {
  const listener = (_: unknown, payload: T) => handler(payload);
  ipcMain.on(channel, listener);
  return () => ipcMain.removeListener(channel, listener);
};

// Waits for a single renderer IPC reply, rejecting after `timeoutMs` so routes
// don't hang.
export const waitForIpcResponse = <T>(
  channel: string,
  request: () => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) =>
  new Promise<T>((resolve, reject) => {
    const listener = (_: unknown, payload: T) => {
      clearTimeout(timeout);
      ipcMain.removeListener(channel, listener);
      resolve(payload);
    };
    const timeout = setTimeout(() => {
      ipcMain.removeListener(channel, listener);
      reject(new Error(`Timed out waiting for IPC response on ${channel}`));
    }, timeoutMs);

    ipcMain.on(channel, listener);
    request();
  });

/** Fire-and-forget command on the renderer's action listener. */
export const sendToRenderer = (
  win: BrowserWindow,
  action: ApiAction,
  ...args: unknown[]
) => {
  win.webContents.send(apiRequest(action), ...args);
};

/**
 * Serializes calls per action. The renderer answers each action on one fixed
 * channel with no request id, so two calls in flight at once would resolve each
 * other's promise; queueing keeps every reply paired with its request. The cost
 * is that a slow call delays the next one *on that action only*.
 */
const inFlight = new Map<string, Promise<unknown>>();

/** Sends a getter to the renderer and resolves with the payload it replies. */
export const callRenderer = <T>(
  win: BrowserWindow,
  action: ApiAction,
  ...args: unknown[]
): Promise<T> =>
  callRendererWithTimeout<T>(win, action, DEFAULT_TIMEOUT_MS, ...args);

/** `callRenderer` for an action that legitimately takes longer to answer. */
export const callRendererWithTimeout = <T>(
  win: BrowserWindow,
  action: ApiAction,
  timeoutMs: number,
  ...args: unknown[]
): Promise<T> => {
  const next = (inFlight.get(action) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      waitForIpcResponse<T>(
        apiReply(action),
        () => {
          sendToRenderer(win, action, ...args);
        },
        timeoutMs,
      ),
    );

  // Kept settled so a failed call can't wedge the queue for its action.
  inFlight.set(
    action,
    next.catch(() => undefined),
  );

  return next;
};
