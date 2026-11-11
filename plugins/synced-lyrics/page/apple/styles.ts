// Shadow-DOM styles for the Apple Music-style lyrics. The picker and the
// surrounding shell stay where the standard renderer expects them; only the
// lyrics stack inside the scroll container is Apple-specific.

import { css } from "@pear/sdk/macros" with { type: "macro" };

export const appleStyles = css`
  .lyrics-renderer.apple-music-style {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    /* The plugin shell inherits YTM's UI font, as the old
       previous component host did by inheriting; its own system stack
       was never used in this app and is noticeably narrower. */
    font-family: inherit;
    font-weight: bold;
    color: var(--apple-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    container-type: inline-size;
    --apple-primary: var(--ytmusic-text-primary, #ffffff);
    --apple-secondary: color-mix(in srgb, var(--apple-primary), transparent 45%);
    --apple-size: 34px;
    --apple-line-height: 1.2;
    --apple-line-spacing: 25px;
    --apple-inline-padding: 20px;
    --apple-inactive-scale: 0.98;
    --apple-blur: 0.07em;
    --apple-blur-near: 0.035em;
    --apple-gap-height: 40px;
    --apple-gap-spacing: 16px;
    --apple-dot-size: 0.4em;
    --apple-dot-margin: 0.08em;
  }
  @container (max-width: 519px) {
    .apple-music-lines {
      --apple-size: 28px;
      --apple-line-spacing: 20px;
      --apple-bg-size: 0.857em;
    }
  }
  @container (min-width: 900px) {
    .apple-music-scroll {
      --apple-inline-padding: 32px;
    }
    .apple-music-lines {
      --apple-size: 48px;
      --apple-line-spacing: 32px;
      --apple-line-height: 1.17;
      --apple-bg-size: 0.667em;
    }
  }

  /* The picker overlays the lyrics and slides out of the tab as a wrapper. */
  .apple-music-picker {
    position: absolute;
    inset: 0 0 auto;
    z-index: 100;
    backdrop-filter: blur(5px);
    transform: translateY(var(--apple-music-picker-offset, 0));
    transition: transform 325ms ease-in-out;
  }
  .apple-music-picker .picker {
    height: 4em;
    margin-bottom: 0;
    padding-block: 0.25em;
  }

  .apple-music-host {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .apple-music-scroll {
    --apple-inline-padding: 20px;
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 60px var(--apple-inline-padding) calc(var(--apple-gap-height) + var(--apple-gap-spacing));
    box-sizing: border-box;
    scroll-padding-block-start: 12%;
    scrollbar-width: none;
    overscroll-behavior-y: contain;
    overflow-anchor: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .apple-music-scroll::-webkit-scrollbar {
    display: none;
  }
  .apple-music-lines {
    position: relative;
    width: 100%;
    font-size: var(--apple-size);
    --apple-line-height: 1.2;
    --apple-bg-size: 0.65em;
  }

  .apple-line {
    position: relative;
    margin: 0 0 var(--apple-line-spacing);
    padding: 0 10px;
    color: var(--apple-secondary);
    font-size: var(--apple-size);
    line-height: var(--apple-line-height);
    text-rendering: optimizeLegibility;
    opacity: 0.8;
    filter: blur(var(--apple-blur));
    transform: scale(var(--apple-inactive-scale));
    transform-origin: left;
    transition:
      opacity 0.7s ease,
      transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99),
      filter 0.7s ease,
      color 0.2s ease;
    contain: layout style;
    cursor: pointer;
  }
  .apple-line-box {
    display: flex;
    flex-direction: column;
    gap: 0;
    transform-origin: left;
  }
  .apple-line.active,
  .apple-line.pre-active {
    color: var(--apple-primary);
    opacity: 1;
    filter: none;
    transform: scale(1);
  }
  .apple-line.active .apple-line-box,
  .apple-line.pre-active .apple-line-box {
    transform: scale(1);
  }
  .apple-line.past,
  .apple-line.future {
    filter: blur(var(--apple-blur));
  }
  .apple-line.next-1,
  .apple-line.prev-1 {
    filter: blur(var(--apple-blur-near));
  }
  .apple-line.next-2 {
    filter: blur(0.028em);
    opacity: 0.7;
  }
  .apple-line.next-3 {
    filter: blur(0.05em);
    opacity: 0.58;
  }
  .apple-line.next-4,
  .apple-line.prev-2,
  .apple-line.prev-3,
  .apple-line.prev-4 {
    filter: blur(var(--apple-blur));
  }
  .apple-line.next-4 {
    opacity: 0.46;
  }
  .apple-line:hover {
    filter: none !important;
  }
  .apple-line::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: -6px -8px;
    border-radius: 16px;
    background: rgb(255 255 255 / 0.08);
    opacity: 0;
    pointer-events: none;
  }
  .apple-line:focus-visible {
    outline: none;
  }
  .apple-line:focus-visible::before {
    opacity: 1;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--apple-primary) 72%, transparent);
  }
  .apple-line.progressive-unblur {
    animation: apple-unblur 2s linear forwards;
  }
  @keyframes apple-unblur {
    from {
      filter: blur(0.02em);
    }
    to {
      filter: blur(0);
    }
  }
  .apple-line.active {
    cursor: default;
  }
  .apple-line.singer-right {
    text-align: end;
    transform-origin: right;
  }
  .apple-line.singer-right .apple-line-box {
    transform-origin: right;
  }
  .apple-line.rtl {
    direction: rtl;
    text-align: right;
    transform-origin: right;
  }
  .apple-line.rtl .apple-line-box {
    transform-origin: right;
  }
  .apple-line.rtl.singer-right {
    text-align: left;
    transform-origin: left;
  }
  .apple-line.rtl.singer-right .apple-line-box {
    transform-origin: left;
  }
  .apple-main,
  .apple-bg {
    overflow-wrap: break-word;
    white-space: pre-wrap;
  }
  .apple-main {
    position: relative;
  }
  .apple-bg {
    max-height: 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--apple-secondary) 80%, transparent);
    font-size: var(--apple-bg-size);
    line-height: 1.22;
    opacity: 0;
    transform: translateY(6px) scale(0.96);
    transition:
      max-height 650ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 450ms ease,
      transform 650ms cubic-bezier(0.22, 1, 0.36, 1),
      padding 650ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .apple-bg.background-before {
    transform: translateY(-6px) scale(0.96);
  }
  .apple-bg.expanded {
    max-height: 8em;
    opacity: 1;
    transform: none;
  }
  .apple-bg.background-before.expanded {
    padding-bottom: calc(15px + 0.14em);
  }
  .apple-bg.background-after.expanded {
    padding-top: calc(15px + 0.08em);
  }
  .apple-bg-inner {
    overflow: hidden;
  }
  .apple-translation {
    padding-top: 0.2em;
    font-size: 0.6em;
    font-weight: normal;
    line-height: 1.3;
    opacity: 0.5;
    pointer-events: none;
  }

  /* Karaoke words: the gradient stop is the word's own progress. */
  .apple-word {
    display: inline;
    white-space: inherit;
    color: var(--apple-secondary);
  }
  .apple-line.active.word-synced .apple-main .apple-word,
  .apple-line.active.word-synced .apple-bg .apple-word,
  .apple-line.pre-active.word-synced .apple-main .apple-word,
  .apple-line.pre-active.word-synced .apple-bg .apple-word {
    color: transparent;
    -webkit-text-fill-color: transparent;
    background-image: linear-gradient(
      var(--apple-word-angle, 90deg),
      var(--apple-word-on, var(--apple-primary)) 0%,
      var(--apple-word-on, var(--apple-primary)) calc(var(--p, 0) * 100% - var(--apple-feather, 0.75em)),
      var(--apple-word-off, var(--apple-secondary)) calc(var(--p, 0) * 100% + var(--apple-feather, 0.75em)),
      var(--apple-word-off, var(--apple-secondary)) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .apple-line.active.word-synced .apple-bg .apple-word,
  .apple-line.pre-active.word-synced .apple-bg .apple-word {
    --apple-word-on: color-mix(in srgb, var(--apple-primary) 55%, #888888);
    --apple-word-off: color-mix(in srgb, var(--apple-secondary) 50%, #888888);
  }
  .apple-line.rtl .apple-word {
    --apple-word-angle: 270deg;
  }

  /* Instrumental breaks: three dots, each owning a third of the gap. */
  .apple-gap {
    position: relative;
    height: 0;
    margin: 0;
    padding: 0 10px;
    overflow: visible;
    font-size: var(--apple-size);
  }
  .apple-gap.active {
    height: calc(var(--apple-gap-height) + var(--apple-gap-spacing));
  }
  .apple-gap.gap-collapsing {
    height: 0;
  }
  .apple-gap-dots {
    position: absolute;
    top: calc(-1 * var(--apple-line-spacing));
    left: 10px;
    display: flex;
    align-items: center;
    height: calc(var(--apple-gap-height) + var(--apple-gap-spacing) + var(--apple-line-spacing));
    opacity: 0;
    transform: scale(0);
    transform-origin: center left;
    transition:
      opacity 160ms ease-out,
      transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .apple-gap.active .apple-gap-dots {
    opacity: 1;
    transform: scale(1);
  }
  .apple-gap.gap-exiting .apple-gap-dots {
    opacity: 0;
    transform: scale(1.2);
    transition:
      opacity 350ms ease-out,
      transform 350ms cubic-bezier(0.4, 0, 0.6, 1);
  }
  .apple-gap-dot {
    display: block;
    width: var(--apple-dot-size);
    height: var(--apple-dot-size);
    margin: 0 var(--apple-dot-margin);
    border-radius: 50%;
    background: var(--apple-primary);
    opacity: 0.25;
    animation: apple-gap-breath 8s ease-in-out infinite;
  }
  @keyframes apple-gap-breath {
    0%,
    100% {
      transform: scale(1.12);
    }
    50% {
      transform: scale(0.85);
    }
  }

  /* The user's own scroll wins until they stop for a moment. */
  .apple-music-scroll.user-scrolling .apple-line {
    filter: none !important;
    opacity: 0.8 !important;
    transition: none !important;
  }
  .apple-music-scroll.user-scrolling .apple-line.active {
    opacity: 1 !important;
  }

  /* Duet lanes: keep each side clear of the other. */
  .apple-music-lines.has-duet .apple-line.singer-left {
    padding-inline-end: max(10px, 15%);
  }
  .apple-music-lines.has-duet .apple-line.singer-right {
    padding-inline-start: max(10px, 15%);
  }

  /* Keep YTM's reduced-motion and the core's performance switches honest. */
  :host([data-performance="css"]) .apple-line,
  :host([data-performance="css"]) .apple-gap,
  :host([data-performance="css"]) .apple-gap-dots,
  :host([data-performance="css"]) .apple-gap-dot {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    transition-delay: 0s !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .apple-line,
    .apple-gap,
    .apple-gap-dots,
    .apple-gap-dot {
      animation: none !important;
      transition-duration: 1ms !important;
    }
  }

  .apple-music-host > .error,
  .apple-music-host > .kaomoji {
    box-sizing: border-box;
    padding: 60px var(--apple-inline-padding) 56px;
  }

  .apple-music-plain {
    height: 100%;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 60px var(--apple-inline-padding) 56px;
    color: var(--apple-primary);
    scrollbar-width: none;
  }
`;
