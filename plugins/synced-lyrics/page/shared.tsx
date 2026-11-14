import type { Translate } from "@pear/sdk/i18n";
import { useEffect, useState } from "preact/hooks";

const LOADING_FRAME_MS = 500;
const LOADING_FRAMES = ["(>_<)", "{ (>_<) }", "{{ (>_<) }}", "{{{ (>_<) }}}", "{{ (>_<) }}", "{ (>_<) }"];

export function LoadingKaomoji() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((n) => n + 1), LOADING_FRAME_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <div class="kaomoji" role="status" aria-busy="true">
      {LOADING_FRAMES[frame % LOADING_FRAMES.length]}
    </div>
  );
}

export function FetchError({ message, onRetry, t }: { message: string; onRetry(): void; t: Translate }) {
  return (
    <div class="error">
      <pre class="error-title">{t("plugins.synced-lyrics.errors.fetch", "An error occurred while fetching the lyrics.")}</pre>
      <pre class="error-detail">{message}</pre>
      <button type="button" class="retry" onClick={onRetry}>
        {t("plugins.synced-lyrics.refetch-btn.normal", "Refetch lyrics")}
      </button>
    </div>
  );
}

export function NoLyrics({ t }: { t: Translate }) {
  return (
    <div class="kaomoji" role="status" aria-label={t("plugins.synced-lyrics.errors.not-found", "No lyrics found for this song.")}>
      ＼(〇_ｏ)／
    </div>
  );
}

export function PlainLyrics({
  texts,
  romanized,
  translation,
}: {
  texts: string[];
  romanized: (string | null)[];
  translation: (string | null)[];
}) {
  return (
    <div class="lines plain">
      {texts.map((text, index) => {
        const translated = translation[index];
        return text ? (
          <div key={index} class={`line${/^\[.*\]$/.test(text) ? " section" : ""}`}>
            <span class="text" dir="auto">
              {text}
            </span>
            {romanized[index] && (
              <span class="romanized" dir="auto">
                {romanized[index]}
              </span>
            )}
            {translated && translated !== text && (
              <span class="translation" dir="auto">
                {translated}
              </span>
            )}
          </div>
        ) : (
          <div key={index} class="spacer" />
        );
      })}
    </div>
  );
}
