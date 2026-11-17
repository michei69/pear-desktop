// YTM's own toast (bottom left).

import { selectors } from "@pear/sdk/selectors";

interface ToastApp extends HTMLElement {
  toastService?: { show(message: string): void };
  handleAddToToastAction?(action: unknown): void;
}

/** Newer YTM dropped `toastService`; the toast action does the same. Both paths are kept. */
export function showToast(message: string) {
  const app = document.querySelector<ToastApp>(selectors.app);
  if (app?.toastService) return app.toastService.show(message);
  app?.handleAddToToastAction?.({
    addToToastAction: { item: { notificationTextRenderer: { successResponseText: { runs: [{ text: message }] } } } },
  });
}
