import { createRenderer } from '@/utils';

import type { StatusbarLyricsPluginConfig } from './index';
import type { MusicPlayer } from '@/types/music-player';

let activeLineText = '';
let activeLineStartedAt = 0;
let activeLineElement: HTMLElement | null = null;
let timer: number | undefined;
let observer: MutationObserver | undefined;
let sendLyrics: (() => void) | undefined;
let sendInFlight = false;
let sendRequested = false;
let lastPayload: string | undefined;
/**
 * The plugin config, kept here so the 4 Hz send can compare its payload without
 * an IPC round-trip first. Refreshed by `onConfigChange`.
 */
let pluginConfig: StatusbarLyricsPluginConfig | undefined;
let isPlaying = false;
let resetLineBaseline = true;
let api: MusicPlayer | null = null;
let stateListener: ((state: number) => void) | null = null;
let sendGeneration = 0;

const resetLineState = () => {
  activeLineText = '';
  activeLineStartedAt = 0;
  activeLineElement = null;
};

const resetPlaybackState = () => {
  isPlaying = false;
  resetLineBaseline = true;
};

const resetSendState = () => {
  sendInFlight = false;
  sendRequested = false;
  lastPayload = undefined;
};

// Collapse whitespace: DOM nodes can split one lyric line into pieces
const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

// Translation, pronunciation and romanization nodes are auxiliary text
const isLikelyPronunciation = (element: HTMLElement | null) => {
  if (!element) return false;

  const className = element.className?.toString() ?? '';
  if (
    /(translation|translated|subtitle|pronunciation|romaji|romanization)/i.test(
      className,
    )
  )
    return true;

  return Boolean(
    element.closest(
      '.translation, .translated, .lyrics-translation, .pronunciation, .romaji, [data-translation], [data-romanization], [aria-label*="translation" i], [aria-label*="pronunciation" i], [aria-label*="romaji" i]',
    ),
  );
};

const getPrimaryText = (element: HTMLElement | null) => {
  if (!element) return '';

  const primaryChildren = Array.from(element.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !isLikelyPronunciation(child),
  );

  const directText = primaryChildren
    .map((child) => normalizeText(child.textContent ?? ''))
    .find(Boolean);

  if (directText) return directText;

  return normalizeText(element.textContent ?? '');
};

const getPrimaryTextElement = (lineElement: HTMLElement | null) => {
  if (!lineElement) return null;

  const candidates = Array.from(
    lineElement.querySelectorAll<HTMLElement>('.text-lyrics'),
  );
  const visibleCandidate = candidates.find(
    (candidate) => !isLikelyPronunciation(candidate),
  );

  return visibleCandidate ?? candidates[0] ?? null;
};

const getNextLyricRow = (lineElement: HTMLElement | null) => {
  let nextElement = lineElement?.nextElementSibling as HTMLElement | null;

  while (nextElement && !nextElement.querySelector('.text-lyrics')) {
    nextElement = nextElement.nextElementSibling as HTMLElement | null;
  }

  return nextElement;
};

// CSS duration synced lyrics expose, used to predict the next line switch
const parseDurationMs = (element: HTMLElement) => {
  const rawDuration =
    getComputedStyle(element).getPropertyValue('--lyrics-duration');
  const parsedDuration = Number.parseFloat(rawDuration);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) return null;

  return parsedDuration * 1000;
};

// Best text for a line; pronunciation only when the setting is on
const getLineText = (
  element: HTMLElement | null,
  includePronunciation: boolean,
) => {
  if (!element) return '';

  const textElement = getPrimaryTextElement(element);
  if (!textElement) return '';

  const text = includePronunciation
    ? normalizeText(textElement.textContent ?? '')
    : getPrimaryText(textElement);

  if (!text) return '';

  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  return lines[0] ?? text;
};

// Switch to the next line slightly before the CSS animation ends so the tray
// title stays in sync with playback.
const pollLyrics = (includePronunciation: boolean) => {
  const currentLine = document.querySelector<HTMLElement>(
    '.synced-line.current',
  );
  if (!currentLine) return '';

  const currentTextElement = getPrimaryTextElement(currentLine);
  if (!currentTextElement) return '';

  const currentText = getLineText(currentLine, includePronunciation);
  const now = performance.now();

  if (resetLineBaseline) {
    activeLineElement = currentLine;
    activeLineText = currentText;
    activeLineStartedAt = now;
    resetLineBaseline = false;
  }

  if (activeLineElement !== currentLine || currentText !== activeLineText) {
    activeLineElement = currentLine;
    activeLineText = currentText;
    activeLineStartedAt = now;
  }

  if (!isPlaying) {
    return currentText;
  }

  const durationMs = parseDurationMs(currentTextElement);
  if (!durationMs) {
    return currentText;
  }

  const leadMs = Math.max(180, Math.min(400, durationMs * 0.18));
  const switchAtMs = Math.max(0, durationMs - leadMs);

  if (now - activeLineStartedAt >= switchAtMs) {
    const nextLineText = getLineText(
      getNextLyricRow(currentLine),
      includePronunciation,
    );
    if (nextLineText) return nextLineText;
  }

  return currentText;
};

export const renderer = createRenderer({
  // Push the current line to the backend on DOM, playback and timer changes
  start(ctx) {
    const generation = sendGeneration;

    const send = async () => {
      const config =
        pluginConfig ??
        ((await ctx.getConfig()) as StatusbarLyricsPluginConfig);
      if (generation !== sendGeneration) return;
      pluginConfig = config;
      const text = pollLyrics(config.includePronunciation);
      const payload =
        config.enabled && text ? `${config.maxLength}\u0000${text}` : '';

      if (generation !== sendGeneration) return;

      if (payload === lastPayload) {
        return;
      }

      if (!payload) {
        await ctx.ipc.invoke('statusbar-lyrics:clear');
      } else {
        await ctx.ipc.invoke(
          'statusbar-lyrics:set-text',
          text,
          config.maxLength,
        );
      }

      // Only a delivered payload counts as sent: a rejected invoke must leave
      // the dedupe open so the next trigger retries the same line.
      if (generation !== sendGeneration) return;
      lastPayload = payload;
    };

    const flushSend = async () => {
      if (sendInFlight) {
        sendRequested = true;
        return;
      }

      sendInFlight = true;

      try {
        do {
          sendRequested = false;
          await send();
        } while (sendRequested);
      } catch (error) {
        // A failed send is retried by the next trigger (timer/observer) because
        // `lastPayload` was not committed; never let it escape unhandled.
        console.error(
          '[statusbar-lyrics] failed to update the status bar',
          error,
        );
      } finally {
        sendInFlight = false;
      }
    };

    sendLyrics = () => {
      sendRequested = true;
      flushSend();
    };

    if (timer) {
      window.clearInterval(timer);
      timer = undefined;
    }
    observer?.disconnect();
    observer = undefined;
    resetLineState();
    resetPlaybackState();

    observer = new MutationObserver(() => {
      sendLyrics?.();
    });

    const target = document.querySelector('ytmusic-player-page');
    if (target) {
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }

    timer = window.setInterval(() => {
      sendLyrics?.();
    }, 250);
  },
  onPlayerApiReady(playerApi: MusicPlayer) {
    if (stateListener && api) {
      api.removeEventListener('onStateChange', stateListener);
    }
    api = playerApi;
    isPlaying = playerApi.getPlayerState() === 1;
    stateListener = (state: number) => {
      isPlaying = state === 1;
      resetLineBaseline = true;
      sendLyrics?.();
    };
    api.addEventListener('onStateChange', stateListener);
  },
  onConfigChange(newConfig) {
    pluginConfig = newConfig as StatusbarLyricsPluginConfig;
    sendLyrics?.();
  },
  stop() {
    sendGeneration += 1;

    if (timer) {
      window.clearInterval(timer);
      timer = undefined;
    }

    observer?.disconnect();
    observer = undefined;

    if (stateListener && api) {
      api.removeEventListener('onStateChange', stateListener);
    }
    stateListener = null;
    api = null;

    sendLyrics = undefined;
    pluginConfig = undefined;
    resetLineState();
    resetPlaybackState();
    resetSendState();

    window.ipcRenderer.invoke('statusbar-lyrics:clear').catch(() => {});
  },
});
