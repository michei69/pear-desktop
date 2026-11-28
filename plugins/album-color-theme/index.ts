import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

import { albumColors } from "./artwork.ts";
import { mixColor } from "./color.ts";

const ACTIVE = "pear-album-color";

/** Dark YTM palette colors; the current artwork color is mixed into each. */
const VARIABLE_MAP: Record<string, string> = {
  "--ytmusic-color-black1": "#212121",
  "--ytmusic-color-black2": "#181818",
  "--ytmusic-color-black3": "#030303",
  "--ytmusic-color-black4": "#030303",
  "--ytmusic-color-blackpure": "#000",
  "--dark-theme-background-color": "#212121",
  "--ytmusic-general-background-c": "#030303",
  "--ytmusic-brand-background-solid": "#212121",
  "--ytmusic-nav-bar": "#030303",
  "--ytmusic-player-bar-background": "#212121",
  "--ytmusic-menu-popup-background": "#212121",
  "--ytmusic-footer-background": "#181818",
  "--ytmusic-multiselect-form-footer-background": "#181818",
  "--ytmusic-horizontal-action-card-background": "#000",
  "--ytmusic-static-brand-black": "#212121",
  "--ytmusic-text-primary-inverse": "#030303",
  "--yt-sys-color-baseline--base-background": "#0f0f0f",
  "--yt-sys-color-baseline--raised-background": "#212121",
  "--yt-sys-color-baseline--menu-background": "#282828",
  "--yt-sys-color-baseline--static-brand-black": "#212121",
  "--yt-sys-color-baseline--overlay-background-solid": "#000",
  "--yt-sys-color-baseline--overlay-background-heavy": "rgba(0,0,0,0.8)",
  "--yt-sys-color-baseline--overlay-background-medium": "rgba(0,0,0,0.6)",
  "--yt-sys-color-baseline--overlay-background-medium-light": "rgba(0,0,0,0.3)",
  "--yt-sys-color-baseline--overlay-background-light": "rgba(0,0,0,0.1)",
  "--yt-deprecated-general-background-a": "#181818",
  "--yt-deprecated-general-background-b": "#0f0f0f",
  "--yt-deprecated-general-background-c": "#030303",
  "--yt-spec-snackbar-background": "#030303",
  "--yt-spec-filled-button-text": "#030303",
  "--yt-deprecated-black-1": "#282828",
  "--yt-deprecated-black-2": "#1f1f1f",
  "--yt-deprecated-black-3": "#161616",
  "--yt-deprecated-black-4": "#0d0d0d",
  "--yt-deprecated-black-pure": "#000",
  "--yt-deprecated-black-pure-alpha-5": "rgba(0,0,0,0.05)",
  "--yt-deprecated-black-pure-alpha-10": "rgba(0,0,0,0.1)",
  "--yt-deprecated-black-pure-alpha-15": "rgba(0,0,0,0.15)",
  "--yt-deprecated-black-pure-alpha-30": "rgba(0,0,0,0.3)",
  "--yt-deprecated-black-pure-alpha-60": "rgba(0,0,0,0.6)",
  "--yt-deprecated-black-pure-alpha-80": "rgba(0,0,0,0.8)",
  "--yt-deprecated-black-1-alpha-98": "rgba(40,40,40,0.98)",
  "--yt-deprecated-black-1-alpha-95": "rgba(40,40,40,0.95)",
  "--paper-toast-background-color": "#323232",
  "--ytmusic-search-background": "#030303",
  "--paper-slider-knob-color": "#f03",
  "--paper-dialog-background-color": "#212121",
  "--paper-progress-active-color-1": "#f03",
  "--paper-progress-active-color-2": "#ff2791",
  "--yt-sys-color-baseline--inverted-background": "#f3f3f3",
  "--ytmusic-background": "#030303",
  "--ytmusic-detail-header": "rgba(3, 3, 3)",
};

/** The properties that tint with the darker palette color. */
const DARK_KEYED: Record<string, true> = {
  "--ytmusic-background": true,
  "--ytmusic-detail-header": true,
};

const RATIO_MAP: Record<string, number> = {
  "--paper-progress-active-color-1": 1.75,
  "--paper-progress-active-color-2": 1.75,
  "--yt-sys-color-baseline--inverted-background": 1.75,
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
  /* The account menu paints its own background. */
  html.pear-album-color ytmusic-multi-page-menu-renderer {
    background: var(--yt-sys-color-baseline--menu-background) !important;
  }
  sel(nav_bar.background),
  sel(player_bar.background),
  sel(guide.background),
  sel(guide.mini_background) {
    transition: opacity 200ms, background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) !important;
  }
  /* The player page slides and fades as it opens. */
  sel(player.page) {
    transition: transform 300ms, background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) !important;
  }
  /* Fixes for the tinted theme. */
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
  // Ambient mode's glow paints only the video's backdrop, so the two compose
  // (its opt-in ambilight/sidebar styles are separate settings). The remaining
  // overlap is with transparent-player, which declares this pair from its side.
  config: {
    ratio: config.number(50, { label: "Color strength", min: 0, max: 100, step: 5, unit: "%" }),
    enableSeekbar: config.bool(true, { label: "Color the progress bar" }),
  },
  style: (config) => `${THEME}${config.enableSeekbar ? SEEKBAR : ""}`,
  host: {
    start(ctx) {
      // A radio submenu cannot show its state in the flat menu; the settings card
      // keeps both controls, this restores quick access to it.
      ctx.addMenuItem({
        label: ctx.t("plugins.album-color-theme.menu.open", "Album color theme…"),
        click: () => ctx.openSettings(),
      });
    },
  },
  page: (ctx) => {
    const root = document.documentElement;
    const clear = () => {
      root.classList.remove(ACTIVE);
      // The tinted values are inline, so disabling the plugin has to remove
      // them; a track without artwork keeps the last tint on purpose.
      for (const variable of Object.keys(VARIABLE_MAP)) root.style.removeProperty(variable);
    };
    ctx.onCleanup(clear);

    let generation = 0;
    const apply = async () => {
      const current = ++generation;
      const url =
        thumbnailUrl(ctx.player.api?.getPlayerResponse()?.videoDetails?.thumbnail?.thumbnails) ?? ctx.player.state.track?.artworkUrl;
      if (!url) return;
      const colors = await albumColors(url, ctx.log);
      if (current !== generation || ctx.signal.aborted) return;

      // transparent-player is mutually exclusive with this plugin, so the tint is
      // always fully opaque; there is no other opacity source to mix against.
      const ratio = ctx.config.ratio / 100;
      for (const [variable, base] of Object.entries(VARIABLE_MAP)) {
        const tint = DARK_KEYED[variable] ? colors.dark : colors.color;
        root.style.setProperty(variable, mixColor(base, tint, 1, ratio * (RATIO_MAP[variable] ?? 1)), "important");
      }
      root.classList.add(ACTIVE);
    };

    ctx.player.on("trackChange", () => void apply());
    if (ctx.player.state.track) void apply();
    // Ratio/seekbar changes re-tint from the cached colors instead of restarting
    // the page part (which briefly removed the tint on every slider step).
    ctx.onConfigChange(() => void apply());
  },
});

/** The smallest thumbnail is plenty for an average and loads fastest. */
function thumbnailUrl(thumbnails: { url: string; width: number }[] | undefined) {
  return thumbnails?.toSorted((a, b) => a.width - b.width)[0]?.url;
}
