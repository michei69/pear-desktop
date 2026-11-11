import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { applyTransparency, resetTransparency } from "./window.ts";

export default definePlugin({
  id: "transparent-player",
  name: "Transparent player",
  description: "Makes the window see-through, with a blurred material behind it on Windows 11 and macOS.",
  // pear-desktop's Linux transparency is not supported: it needed global
  // compositing switches and still broke resizing.
  platforms: ["win32", "darwin"],
  config: {
    opacity: config.number(50, {
      label: "Background opacity",
      description: "How much of the desktop shows through the window",
      min: 10,
      max: 100,
      step: 5,
      unit: "%",
    }),
    type: config.select(
      "none",
      [
        { value: "none", label: "None (plain transparency)" },
        { value: "mica", label: "Mica (Windows 11)" },
        { value: "acrylic", label: "Acrylic (Windows 11)" },
        { value: "tabbed", label: "Tabbed (Windows 11)" },
        { value: "window", label: "Window (macOS)" },
        { value: "fullscreen-ui", label: "Full-screen UI (macOS)" },
        { value: "content", label: "Content (macOS)" },
        { value: "under-window", label: "Under window (macOS)" },
        { value: "under-page", label: "Under page (macOS)" },
      ],
      { label: "Material", description: "Blurs what's behind the window on Windows 11 and macOS." },
    ),
  },
  host: {
    start(ctx) {
      applyTransparency(ctx.window, ctx.config.type, ctx.config.opacity);
      ctx.addMenuItem({
        label: ctx.t("plugins.transparent-player.menu.settings", "Transparent player settings…"),
        click: () => ctx.openSettings(),
      });
      ctx.onCleanup(() => {
        if (!ctx.window.isDestroyed()) resetTransparency(ctx.window);
      });
    },
    onConfigChange(config, ctx) {
      applyTransparency(ctx.window, config.type, config.opacity);
    },
  },
  style: css`
    :root {
      --pear-transparent-tint: rgb(17 17 17 / var(--pear-transparent-opacity, 0.5));
      --pear-transparent-tint-dark: rgb(17 17 17 / 0.8);
      --pear-transparent-blur: blur(20px);
    }
    html {
      background: transparent !important;
    }
    body {
      background: var(--pear-transparent-tint) !important;
    }
    sel(browse.background) {
      display: none !important;
    }
    sel(guide.background),
    sel(guide.mini_background),
    sel(player_bar),
    sel(player.page),
    sel(browse.gradient) {
      background: none !important;
      border: 0 !important;
    }
    sel(nav_bar.background),
    sel(player_bar.background) {
      background: var(--pear-transparent-tint-dark) !important;
      backdrop-filter: var(--pear-transparent-blur) !important;
    }
    sel(app.layout)[player-page-open] sel(nav_bar.background),
    sel(app.layout)[player-page-open] sel(player_bar.background) {
      background: none !important;
    }
    sel(tabs.stuck),
    sel(popup.menu) {
      background: var(--pear-transparent-tint) !important;
      backdrop-filter: var(--pear-transparent-blur) !important;
    }
  `,
  page: {
    runAt: "start",
    start(ctx) {
      // Shared with album-color-theme, which mixes its colors at this opacity.
      const style = ctx.addStyle(opacityCss(ctx.config.opacity));
      // The slider only changes a CSS variable: update the sheet instead of
      // restarting the page part.
      ctx.onConfigChange((config) => style.update(opacityCss(config.opacity)));
    },
  },
});

const opacityCss = (opacity: number) => `:root{--pear-transparent-opacity:${opacity / 100}}`;
