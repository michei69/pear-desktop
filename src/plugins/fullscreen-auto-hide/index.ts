import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import style from './style.css?inline';

const IDLE_MS = 2500;
const ACTIVE_CLASS = 'fullscreen-auto-hide--active';
const IDLE_CLASS = 'fullscreen-auto-hide--idle';
const FULLSCREEN_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
] as const;

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitIsFullScreen?: boolean;
  mozFullScreen?: boolean;
};

type Teardown = () => void;

const getFullscreenElement = (): Element | null => {
  const doc = document as FullscreenDocument;
  return (
    doc.fullscreenElement ??
    doc.webkitFullscreenElement ??
    doc.mozFullScreenElement ??
    doc.msFullscreenElement ??
    null
  );
};

const isFullscreen = () => {
  const doc = document as FullscreenDocument;
  return (
    getFullscreenElement() !== null ||
    doc.webkitIsFullScreen === true ||
    doc.mozFullScreen === true
  );
};

const hasFullscreenAttribute = () =>
  document.querySelector('ytmusic-player-bar[player-fullscreened]') !== null ||
  document.querySelector('ytmusic-app-layout[player-fullscreened]') !== null;

const isPlayerFullscreen = () => isFullscreen() || hasFullscreenAttribute();

async function setupFullscreenAutoHide(
  generation: number,
  isCurrentGeneration: (gen: number) => boolean,
): Promise<Teardown> {
  const playerBar = await waitForElement<HTMLElement>('ytmusic-player-bar');
  // The plugin can be stopped and restarted while this is still waiting for the
  // player bar. A plain "was I cancelled" flag is not enough: a later start()
  // would clear it and let a stale, still-pending setup attach anyway, so only
  // the most recent start() generation may win.
  if (!isCurrentGeneration(generation)) return () => {};

  let idleTimeout: number | null = null;
  let recheckTimeout: number | null = null;

  playerBar.style.setProperty('transition', 'opacity 0.3s ease', 'important');

  const setBarHidden = (hidden: boolean) => {
    playerBar.style.setProperty('opacity', hidden ? '0' : '1', 'important');
    playerBar.style.setProperty(
      'pointer-events',
      hidden ? 'none' : '',
      'important',
    );
  };

  // Removes the inline overrides rather than just un-hiding, so normal
  // player-bar styling takes back over once fullscreen ends instead of leaving
  // opacity/pointer-events !important behind indefinitely.
  const clearBarOverrides = () => {
    playerBar.style.removeProperty('opacity');
    playerBar.style.removeProperty('pointer-events');
  };

  const clearIdleTimeout = () => {
    if (idleTimeout !== null) {
      window.clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  };

  const scheduleIdle = () => {
    clearIdleTimeout();
    idleTimeout = window.setTimeout(() => {
      document.body.classList.add(IDLE_CLASS);
      setBarHidden(true);
    }, IDLE_MS);
  };

  const wake = () => {
    document.body.classList.remove(IDLE_CLASS);
    if (!document.body.classList.contains(ACTIVE_CLASS)) return;
    setBarHidden(false);
    scheduleIdle();
  };

  const activityEvents = ['mousemove', 'mousedown', 'keydown'] as const;
  activityEvents.forEach((eventName) =>
    document.addEventListener(eventName, wake),
  );

  const applyFullscreenState = () => {
    if (isPlayerFullscreen()) {
      document.body.classList.add(ACTIVE_CLASS);
      scheduleIdle();
    } else {
      document.body.classList.remove(ACTIVE_CLASS, IDLE_CLASS);
      clearIdleTimeout();
      clearBarOverrides();
    }
  };

  const observer = new MutationObserver(applyFullscreenState);
  const fullscreenAttributeHosts = [
    playerBar,
    document.querySelector('ytmusic-app-layout'),
  ];
  fullscreenAttributeHosts.forEach(
    (host) =>
      host &&
      observer.observe(host, {
        attributes: true,
        attributeFilter: ['player-fullscreened'],
      }),
  );

  const recheckFullscreenState = () => {
    if (recheckTimeout !== null) window.clearTimeout(recheckTimeout);
    recheckTimeout = window.setTimeout(() => {
      recheckTimeout = null;
      applyFullscreenState();
    }, 100);
  };

  applyFullscreenState();

  FULLSCREEN_EVENTS.forEach((eventName) =>
    document.addEventListener(eventName, applyFullscreenState),
  );
  document.addEventListener('ytm-player-fullscreen', recheckFullscreenState);

  return () => {
    observer.disconnect();
    FULLSCREEN_EVENTS.forEach((eventName) =>
      document.removeEventListener(eventName, applyFullscreenState),
    );
    document.removeEventListener(
      'ytm-player-fullscreen',
      recheckFullscreenState,
    );
    if (recheckTimeout !== null) window.clearTimeout(recheckTimeout);
    clearIdleTimeout();
    activityEvents.forEach((eventName) =>
      document.removeEventListener(eventName, wake),
    );
    document.body.classList.remove(ACTIVE_CLASS, IDLE_CLASS);
    playerBar.style.removeProperty('transition');
    clearBarOverrides();
  };
}

export default createPlugin<
  unknown,
  unknown,
  { cleanup: Teardown | null; generation: number },
  { enabled: boolean }
>({
  name: () => t('plugins.fullscreen-auto-hide.name'),
  description: () => t('plugins.fullscreen-auto-hide.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  stylesheets: [style],

  renderer: {
    cleanup: null,
    generation: 0,
    async start() {
      const generation = ++this.generation;
      const cleanup = await setupFullscreenAutoHide(
        generation,
        (gen) => gen === this.generation,
      );
      if (generation !== this.generation) {
        cleanup();
        return;
      }
      this.cleanup = cleanup;
    },
    stop() {
      this.generation++;
      this.cleanup?.();
      this.cleanup = null;
    },
  },
});
