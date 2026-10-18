import { t } from '@/i18n';
import { createPlugin } from '@/utils';

const AUTO_CLOSE_MS = 3_000;

type Toast = HTMLElement & { close?: () => void };

export default createPlugin({
  name: () => t('plugins.toast-autoclose.name'),
  description: () => t('plugins.toast-autoclose.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  },
  renderer: {
    start() {
      const timers = new Map<Toast, ReturnType<typeof setTimeout>>();
      const root =
        document.querySelector<HTMLElement>('ytmusic-app') ?? document.body;

      const arm = (toast: Toast) => {
        if (timers.has(toast)) return;

        timers.set(
          toast,
          setTimeout(() => {
            timers.delete(toast);
            if (!toast.classList.contains('paper-toast-open')) return;

            const closeButton = toast.querySelector<HTMLElement>(
              '#close-button button',
            );
            if (closeButton) closeButton.click();
            else toast.close?.();
          }, AUTO_CLOSE_MS),
        );
      };

      const scan = () => {
        for (const [toast, timer] of timers) {
          if (
            !toast.isConnected ||
            !toast.classList.contains('paper-toast-open')
          ) {
            clearTimeout(timer);
            timers.delete(toast);
          }
        }

        root
          .querySelectorAll<Toast>('tp-yt-paper-toast.paper-toast-open')
          .forEach(arm);
      };

      const isToastRelated = (node: Node) => {
        if (!(node instanceof Element)) return false;
        // Cheap reject: `matches()` would hand a selector to the engine for
        // every added and removed node.
        if (node.localName === 'tp-yt-paper-toast') return true;
        return (
          node.closest('tp-yt-paper-toast') !== null ||
          node.querySelector('tp-yt-paper-toast') !== null
        );
      };

      const scheduleScan = () => {
        if (this.frame !== null) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = null;
          scan();
        });
      };

      scan();
      this.observer = new MutationObserver((mutations) => {
        if (
          mutations.some(
            ({ target, addedNodes, removedNodes }) =>
              isToastRelated(target) ||
              [...addedNodes, ...removedNodes].some(isToastRelated),
          )
        ) {
          scheduleScan();
        }
      });
      this.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });

      this.timers = timers;
    },
    stop() {
      this.observer?.disconnect();
      this.observer = null;
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.timers?.forEach((timer) => clearTimeout(timer));
      this.timers?.clear();
      this.timers = null;
    },
    observer: null as MutationObserver | null,
    frame: null as number | null,
    timers: null as Map<Toast, ReturnType<typeof setTimeout>> | null,
  },
});
