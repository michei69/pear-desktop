import { config, definePlugin, type Logger } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { averageColor, mixColor, type Rgb, themeColors } from "./color.ts";

const ACTIVE = "pear-album-color";
const SAMPLE_SIZE = 32;
/** Thumbnails are re-requested for the same track (seek, repeat, page re-entry). */
const CACHE_LIMIT = 100;

interface AlbumColors {
  color: Rgb;
  dark: Rgb;
}

const cache = new Map<string, Promise<AlbumColors | null>>();

/** Dark YTM palette colors; the current artwork color is mixed into each. */
const VARIABLE_MAP: Record<string, string> = {
  "--ytmusic-color-black1": "#212121",
  "--ytmusic-color-black2": "#181818",
  "--ytmusic-color-black3": "#030303",
  "--ytmusic-color-black4": "#030303",
  "--ytmusic-color-blackpure": "#000",
  "--dark-theme-background-color": "#212121",
  "--yt-spec-base-background": "#0f0f0f",
  "--yt-spec-raised-background": "#212121",
  "--yt-spec-menu-background": "#282828",
  "--yt-spec-static-brand-black": "#212121",
  "--yt-spec-static-overlay-background-solid": "#000",
  "--yt-spec-static-overlay-background-heavy": "rgba(0,0,0,0.8)",
  "--yt-spec-static-overlay-background-medium": "rgba(0,0,0,0.6)",
  "--yt-spec-static-overlay-background-medium-light": "rgba(0,0,0,0.3)",
  "--yt-spec-static-overlay-background-light": "rgba(0,0,0,0.1)",
  "--yt-spec-general-background-a": "#181818",
  "--yt-spec-general-background-b": "#0f0f0f",
  "--yt-spec-general-background-c": "#030303",
  "--yt-spec-snackbar-background": "#030303",
  "--yt-spec-filled-button-text": "#030303",
  "--yt-spec-black-1": "#282828",
  "--yt-spec-black-2": "#1f1f1f",
  "--yt-spec-black-3": "#161616",
  "--yt-spec-black-4": "#0d0d0d",
  "--yt-spec-black-pure": "#000",
  "--yt-spec-black-pure-alpha-5": "rgba(0,0,0,0.05)",
  "--yt-spec-black-pure-alpha-10": "rgba(0,0,0,0.1)",
  "--yt-spec-black-pure-alpha-15": "rgba(0,0,0,0.15)",
  "--yt-spec-black-pure-alpha-30": "rgba(0,0,0,0.3)",
  "--yt-spec-black-pure-alpha-60": "rgba(0,0,0,0.6)",
  "--yt-spec-black-pure-alpha-80": "rgba(0,0,0,0.8)",
  "--yt-spec-black-1-alpha-98": "rgba(40,40,40,0.98)",
  "--yt-spec-black-1-alpha-95": "rgba(40,40,40,0.95)",
  "--paper-toast-background-color": "#323232",
  "--ytmusic-search-background": "#030303",
  "--paper-slider-knob-color": "#f03",
  "--paper-dialog-background-color": "#212121",
  "--paper-progress-active-color-1": "#f03",
  "--paper-progress-active-color-2": "#ff2791",
  "--yt-spec-inverted-background": "#f3f3f3",
  "--ytmusic-background": "#030303",
};

/** The two properties that tint with the darker palette color, as in pear-desktop. */
const DARK_KEYED: Record<string, true> = {
  "--ytmusic-background": true,
};

const RATIO_MAP: Record<string, number> = {
  "--paper-progress-active-color-1": 1.75,
  "--paper-progress-active-color-2": 1.75,
  "--yt-spec-inverted-background": 1.75,
};

// YTM's dark palette, tinted by the artwork. The mixed values are written by
// the page part as plain rgba() properties, not color-mix() per property:
// re-resolving a mix for each token on every style recalc is measurable.
const THEME = css`
  html.pear-album-color {
    background: var(--ytmusic-background) !important;
  }
  /* Home's body is painted too, so the page behind the app matches the tint. */
  html.pear-album-color body {
    background-color: var(--ytmusic-background) !important;
  }
  sel(nav_bar.background),
  sel(player_bar.background),
  sel(guide.background),
  sel(guide.mini_background),
  sel(player.page) {
    transition: background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) !important;
  }
  /* pear-desktop's fixes for the tinted theme. */
  html.pear-album-color yt-page-navigation-progress {
    --yt-page-navigation-container-color: #00000046 !important;
    --yt-page-navigation-progress-color: white !important;
  }
  html.pear-album-color sel(guide.mini_background) {
    border-right: 0 !important;
  }
  html.pear-album-color #items {
    border-radius: 10px !important;
  }
  /* The player page slides under the (blurred) nav bar. */
  html.pear-album-color ytmusic-app-layout > [slot="player-page"]:not([is-mweb-modernization-enabled]):not(:has(ytmusic-player[player-ui-state="FULLSCREEN"])) {
    padding-top: 90px;
    margin-top: calc(-90px + var(--menu-bar-height, 0px)) !important;
  }
  /* Secondary texts and icons stay readable on any tint. */
  html.pear-album-color .duration.ytmusic-player-queue-item,
  html.pear-album-color .byline.ytmusic-player-queue-item {
    color: rgb(255 255 255 / 0.5) !important;
    --yt-endpoint-color: rgb(255 255 255 / 0.5) !important;
    --yt-endpoint-hover-color: rgb(255 255 255 / 0.5) !important;
    --yt-endpoint-visited-color: rgb(255 255 255 / 0.5) !important;
  }
  html.pear-album-color .icon.ytmusic-menu-navigation-item-renderer {
    color: rgb(255 255 255 / 0.5) !important;
  }
  html.pear-album-color .menu.ytmusic-player-bar {
    --iron-icon-fill-color: rgb(255 255 255 / 0.5) !important;
  }
  html.pear-album-color sel(player_bar),
  html.pear-album-color sel(player_bar.time) {
    color: rgb(255 255 255 / 0.5) !important;
  }
  html.pear-album-color .volume-slider.ytmusic-player-bar,
  html.pear-album-color .expand-volume-slider.ytmusic-player-bar {
    --paper-slider-container-color: rgb(255 255 255 / 0.5) !important;
  }
  /* Backgrounds: the artwork fades out, gradients take the tint. */
  html.pear-album-color ytmusic-fullbleed-thumbnail-renderer img {
    mask: linear-gradient(to bottom, #000 0%, #000 50%, transparent 100%);
  }
  html.pear-album-color .background-gradient.style-scope,
  html.pear-album-color ytmusic-app-layout[is-bauhaus-sidenav-enabled] #mini-guide-background.ytmusic-app-layout {
    background: var(--ytmusic-background) !important;
  }
  html.pear-album-color ytmusic-browse-response[has-background]:not([disable-gradient]) .background-gradient.ytmusic-browse-response {
    background: unset !important;
  }
  html.pear-album-color #background.immersive-background.style-scope.ytmusic-browse-response {
    opacity: 0.6;
  }
  html.pear-album-color ytmusic-search-box[is-bauhaus-sidenav-enabled] {
    --ytmusic-search-background: var(--ytmusic-color-black3) !important;
  }
`;

const SEEKBAR = css`
  html.pear-album-color sel(player_bar.progress) {
    --paper-slider-active-color: linear-gradient(to right, var(--paper-progress-active-color-1) 80%, var(--paper-progress-active-color-2) 100%) !important;
    --paper-slider-knob-color: var(--paper-progress-active-color-1) !important;
    --paper-slider-knob-start-color: var(--paper-progress-active-color-2) !important;
    /* The new player bar paints its range input with these. */
    --yt-sys-color-baseline--static-brand-red: var(--paper-progress-active-color-1) !important;
    --yt-sys-color-baseline--static-magenta: var(--paper-progress-active-color-2) !important;
  }
  html.pear-album-color sel(player_bar.progress)::-webkit-slider-thumb {
    background-color: var(--paper-progress-active-color-1) !important;
  }
`;

export default definePlugin({
  id: "album-color-theme",
  name: "Album color theme",
  description: "Tints the interface with the colors of the current track's artwork.",
  config: {
    ratio: config.number(50, { label: "Color strength", min: 0, max: 100, step: 5, unit: "%" }),
    enableSeekbar: config.bool(true, { label: "Color the progress bar" }),
  },
  style: (config) => `${THEME}${config.enableSeekbar ? SEEKBAR : ""}`,
  page: (ctx) => {
    const root = document.documentElement;
    const clear = () => {
      root.classList.remove(ACTIVE);
      // The tinted values are inline; without this, a missing artwork or a
      // disabled plugin keeps the last tint.
      for (const variable of Object.keys(VARIABLE_MAP)) root.style.removeProperty(variable);
    };
    ctx.onCleanup(clear);

    let generation = 0;
    const apply = async () => {
      const current = ++generation;
      const url =
        thumbnailUrl(ctx.player.api?.getPlayerResponse()?.videoDetails?.thumbnail?.thumbnails) ?? ctx.player.state.track?.artworkUrl;
      const colors = url ? await albumColors(url, ctx.log) : null;
      if (current !== generation || ctx.signal.aborted) return;
      if (!colors) {
        clear();
        return;
      }

      const opacity = Number.parseFloat(getComputedStyle(root).getPropertyValue("--pear-transparent-opacity"));
      const alpha = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
      const ratio = ctx.config.ratio / 100;
      for (const [variable, base] of Object.entries(VARIABLE_MAP)) {
        const tint = DARK_KEYED[variable] ? colors.dark : colors.color;
        root.style.setProperty(variable, mixColor(base, tint, alpha, ratio * (RATIO_MAP[variable] ?? 1)), "important");
      }
      root.classList.add(ACTIVE);
    };

    ctx.player.on("trackChange", () => void apply());
    if (ctx.player.state.track) void apply();
  },
});

/** The smallest thumbnail is plenty for an average and loads fastest. */
function thumbnailUrl(thumbnails: { url: string; width: number }[] | undefined) {
  return thumbnails?.toSorted((a, b) => a.width - b.width)[0]?.url;
}

/** The artwork's colors, sampled once per thumbnail URL. */
function albumColors(url: string, log: Pick<Logger, "warn">) {
  const cached = cache.get(url);
  if (cached) return cached;

  if (cache.size >= CACHE_LIMIT) cache.clear();
  const pending = sampleImage(url)
    .then((average) => (average ? themeColors(average) : null))
    .catch((error: unknown) => {
      cache.delete(url);
      log.warn("couldn't sample artwork", error);
      return null;
    });
  cache.set(url, pending);
  return pending;
}

async function sampleImage(url: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return averageColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
}
