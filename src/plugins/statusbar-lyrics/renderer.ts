import { createRenderer } from '@/utils';

import type { StatusbarLyricsPluginConfig } from './index';

let activeLineText = '';
let activeLineStartedAt = 0;
let activeLineElement: HTMLElement | null = null;
let timer: number | undefined;
let observer: MutationObserver | undefined;
let sendLyrics: (() => void) | undefined;
let sendInFlight = false;
let sendRequested = false;
let lastPayload: string | undefined;
let isPlaying = false;
let resetLineBaseline = true;

const onPlayOrPaused = (
  _event: unknown,
  payload: { isPaused: boolean; elapsedSeconds: number },
) => {
  isPlaying = !payload.isPaused;
  resetLineBaseline = true;
  sendLyrics?.();
};

const onTimeChanged = () => {
  sendLyrics?.();
};

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

// Detect translation/pronunciation nodes so the main lyric line wins
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

// Romanization-only nodes are auxiliary text too
const isLikelyRomaji = (element: HTMLElement | null) => {
  if (!element) return false;

  const className = element.className?.toString() ?? '';
  if (/(romaji|romanization|pronunciation)/i.test(className)) return true;

  return Boolean(
    element.closest('.romaji, [data-romanization], [aria-label*="romaji" i]'),
  );
};

const getPrimaryText = (element: HTMLElement | null) => {
  if (!element) return '';

  const primaryChildren = Array.from(element.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !isLikelyPronunciation(child) &&
      !isLikelyRomaji(child),
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

  const durationMs = parseDurationMs(currentTextElement) ?? 0;
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
    const send = async () => {
      const config = (await ctx.getConfig()) as StatusbarLyricsPluginConfig;
      const text = pollLyrics(config.includePronunciation);
      const payload =
        config.enabled && text ? `${config.maxLength}\u0000${text}` : '';

      if (payload === lastPayload) {
        return;
      }

      lastPayload = payload;

      if (!payload) {
        await ctx.ipc.invoke('statusbar-lyrics:clear');
        return;
      }

      await ctx.ipc.invoke('statusbar-lyrics:set-text', text, config.maxLength);
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

    window.ipcRenderer.removeListener('peard:play-or-paused', onPlayOrPaused);
    window.ipcRenderer.removeListener('peard:time-changed', onTimeChanged);

    window.ipcRenderer.on('peard:play-or-paused', onPlayOrPaused);
    window.ipcRenderer.on('peard:time-changed', onTimeChanged);
  },
  stop() {
    if (timer) {
      window.clearInterval(timer);
      timer = undefined;
    }

    observer?.disconnect();
    observer = undefined;

    window.ipcRenderer.removeListener('peard:play-or-paused', onPlayOrPaused);
    window.ipcRenderer.removeListener('peard:time-changed', onTimeChanged);

    sendLyrics = undefined;
    resetLineState();
    resetPlaybackState();
    resetSendState();

    window.ipcRenderer.invoke('statusbar-lyrics:clear');
  },
});
