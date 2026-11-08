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
        // One deadline per toast: a scan must not push an open toast's timer
        // out just because something else mutated.
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

      const disarm = (toast: Toast) => {
        const timer = timers.get(toast);
        if (timer === undefined) return;

        clearTimeout(timer);
        timers.delete(toast);
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

      const toastOf = (node: Node): Toast | null => {
        if (!(node instanceof Element)) return null;
        if (node.localName === 'tp-yt-paper-toast') return node as Toast;
        return node.closest<Toast>('tp-yt-paper-toast');
      };

      /**
       * Drop the old deadline as soon as a toast loses `paper-toast-open`.
       *
       * YTM reuses the element, so a close and a reopen can land in one
       * mutation batch and the toast is open again by the time this runs.
       * Walking the class records in order — each record's oldValue, or the
       * current class list for the last one — recovers the present → absent
       * step the final state hides; the next scan then arms a fresh deadline.
       */
      const disarmClosed = (mutations: MutationRecord[]) => {
        const recordsByToast = new Map<Toast, MutationRecord[]>();

        for (const mutation of mutations) {
          if (
            mutation.type !== 'attributes' ||
            mutation.attributeName !== 'class'
          ) {
            continue;
          }

          const toast = toastOf(mutation.target);
          if (!toast) continue;

          const records = recordsByToast.get(toast);
          if (records) records.push(mutation);
          else recordsByToast.set(toast, [mutation]);
        }

        for (const [toast, records] of recordsByToast) {
          let isOpen = toast.classList.contains('paper-toast-open');
          for (let index = records.length - 1; index >= 0; index--) {
            const wasOpen = (records[index].oldValue ?? '')
              .split(/\s+/)
              .includes('paper-toast-open');
            if (wasOpen && !isOpen) {
              disarm(toast);
              break;
            }
            isOpen = wasOpen;
          }
        }
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
        // Before the scan: a close + reopen in this batch must not inherit the
        // first message's deadline.
        disarmClosed(mutations);

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
        attributeOldValue: true,
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
