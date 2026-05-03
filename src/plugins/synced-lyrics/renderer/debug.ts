type DebugSender = (message: string, data?: unknown) => void;

let sender: DebugSender | null = null;

export const setTranslationDebugSender = (nextSender: DebugSender) => {
  sender = nextSender;
};

export const translationDebug = (message: string, data?: unknown) => {
  console.info(`[synced-lyrics] ${message}`, data ?? '');
  sender?.(message, data);
};
