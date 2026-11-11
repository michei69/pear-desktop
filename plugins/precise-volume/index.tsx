/** @jsxImportSource @pear/sdk */
import { definePlugin, type PageContextOf } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { clamp, debounce } from "@pear/sdk/util";
import { isVolume, schema } from "./config.ts";
import { startHost } from "./host.ts";
import { VolumeTitles } from "./tooltips.ts";

const HUD_MS = 1500;
const SLIDER_MS = 2500;

type Ctx = PageContextOf<typeof schema>;

const TOOLTIP_TARGETS = ["player_bar.volume_sliders", "player_bar.volume_button", "player_bar.expand_volume"] as const;

export default definePlugin({
  id: "precise-volume",
  name: "Precise volume",
  description: "Change the volume in fine steps with the scroll wheel or arrow keys, with a volume readout.",
  config: schema,
  style: css`
    .pear-volume-hud {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 2200;
      font: 600 32px Roboto, sans-serif;
      text-shadow: rgb(0 0 0 / 0.5) 0 0 12px;
      -webkit-text-stroke: 1px black;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.4s;
    }
    /* The audio-only layout has no video panel: pear-desktop drew it on the nav bar. */
    .pear-volume-hud[data-spot="nav"] {
      top: 18px;
      right: 60px;
      left: auto;
      font-size: 24px;
      -webkit-text-stroke: 0;
    }
    /* Neither spot is there (YTM changed its markup): the fixed pill the rewrite had. */
    .pear-volume-hud:not([data-spot]) {
      position: fixed;
      top: 80px;
      left: 50%;
      translate: -50%;
      padding: 8px 18px;
      border-radius: 20px;
      background: rgb(0 0 0 / 0.65);
      color: #fff;
      font-size: 28px;
      -webkit-text-stroke: 0;
    }
    .pear-volume-hud[data-visible] {
      opacity: 1;
      transition-duration: 0.1s;
    }
    /* The miniplayer draws the video under the bar: keep the readout at its top. */
    ytmusic-player[player-ui-state_='MINIPLAYER'] .pear-volume-hud {
      top: 0 !important;
    }
    sel(player_bar.volume_popup).pear-volume-reveal {
      display: flex !important;
    }
  `,
  host: { start: startHost },
  page: {
    // Runs before YTM's scripts. pear-desktop restored the volume from a preload
    // because YTM can resume playback at its own (often full) volume before its
    // UI is built; the restore below is what remains before the DOM setup.
    runAt: "start",
    async start(ctx) {
      const restoreVolume = savedVolumeRestore(ctx);
      const api = await ctx.player.ready();
      restoreVolume();

      const showHud = volumeHud(ctx);
      const showSlider = sliderReveal(ctx);

      // YTM's own tooltips go away with the plugin; keep them to put back, and
      // capture the new elements whenever YTM replaces the bar.
      const titles = new VolumeTitles();
      const setTooltips = (volume: number) => {
        for (const name of TOOLTIP_TARGETS) {
          for (const element of ctx.$$(name)) titles.set(element, volume);
        }
      };
      ctx.onCleanup(() => titles.restore());

      // The slider position is the volume users see; YTM may map it onto a
      // different player volume (a loudness curve), so steps follow the slider.
      const position = () => {
        // A number on the classic bar's paper-slider, a string on the new bar's range input.
        const value = Number(ctx.$<HTMLElement & { value?: number | string }>("player_bar.volume_slider")?.value);
        return Number.isFinite(value) ? value : api.getVolume();
      };
      const change = (direction: number) => {
        const volume = clamp(Math.round(position()) + direction * ctx.config.steps, 0, 100);
        if (api.isMuted() && direction > 0) ctx.player.control({ type: "mute", muted: false });
        ctx.player.control({ type: "volume", value: volume });
        setTooltips(volume);
        showHud(volume);
        showSlider();
      };

      // Volume changes come per frame while dragging the slider; save the last one.
      const saveVolume = debounce(() => ctx.setConfig({ savedVolume: Math.round(position()) }), 500);

      listenForWheel(ctx, change);
      listenForArrows(ctx, change);
      ctx.host.on("step", (direction) => change(Number(direction)));
      ctx.player.on("volumeChange", () => {
        setTooltips(position());
        saveVolume();
      });
      ctx.onCleanup(() => saveVolume.cancel());
      setTooltips(position());
      // The bar can be built after the player facade; title its elements then.
      void ctx.waitFor("player_bar").then(() => setTooltips(position()));
    },
    // Every option is read when used.
    onConfigChange() {},
  },
});

/** A player element YTM has upgraded with its API methods, or one about to be. */
interface VolumeElement extends Element {
  setVolume?(volume: number): void;
}

/** <ytmusic-app>: its dispatch is how pear-desktop updated the bar's own volume state. */
interface YtmAppElement extends HTMLElement {
  dispatch?(action: { type: string; payload?: unknown }): void;
}

/** Applies `volume` through the player, and syncs YTM's player-bar state; false while there is no player. */
function applyVolume(ctx: Ctx, volume: number): boolean {
  const api = ctx.player.api;
  if (api) ctx.player.control({ type: "volume", value: volume });
  else {
    const player = ctx.$<VolumeElement>("player.api");
    if (typeof player?.setVolume !== "function") return false;
    player.setVolume(volume);
  }
  // `setVolume` leaves the bar's redux volume on its startup value (master's
  // preload dispatched the same action for that reason).
  ctx.$<YtmAppElement>("app")?.dispatch?.({ type: "SET_VOLUME", payload: volume });
  return true;
}

/**
 * Restores the volume saved last session as soon as the player can take it;
 * returns a retry for when it could not yet. A capture `play` listener covers
 * a YTM that starts playing before its player API is up, like master's preload.
 */
function savedVolumeRestore(ctx: Ctx) {
  const saved = ctx.config.savedVolume;
  let restored = !isVolume(saved);
  const restore = () => {
    if (restored) return true;
    if (!applyVolume(ctx, saved)) return false;
    restored = true;
    return true;
  };
  if (!restore()) {
    // Media events don't bubble: catch `play` in the capture phase.
    const onPlay = () => {
      if (!restore()) return;
      document.removeEventListener("play", onPlay, true);
    };
    document.addEventListener("play", onPlay, true);
    ctx.onCleanup(() => document.removeEventListener("play", onPlay, true));
  }
  return restore;
}

/** The big "42%" readout; returns a function showing a volume for a moment. */
function volumeHud(ctx: Ctx) {
  const hud = <div class="pear-volume-hud" aria-live="polite" />;
  // pear-desktop drew it over the video, or on the nav bar in the audio-only
  // layout; `mount` puts it back when YTM re-renders, with a fixed fallback.
  ctx.mount(hud, (element) => placeHud(ctx, element));
  const hide = debounce(() => hud.removeAttribute("data-visible"), HUD_MS);
  ctx.onCleanup(hide.cancel);
  return (volume: number) => {
    if (!ctx.config.showHud) return;
    hud.textContent = `${volume}%`;
    hud.toggleAttribute("data-visible", true);
    hide();
  };
}

/** Where the readout goes, as pear-desktop placed it. */
function placeHud(ctx: Ctx, hud: Element) {
  const video = ctx.$("player.song_video");
  if (video && !isAudioOnly(ctx)) {
    hud.setAttribute("data-spot", "video");
    video.insertAdjacentElement("afterend", hud);
    return;
  }
  const nav = ctx.$("nav_bar.center") ?? ctx.$("nav_bar");
  if (nav) {
    hud.setAttribute("data-spot", "nav");
    nav.append(hud);
    return;
  }
  hud.removeAttribute("data-spot");
  document.body?.append(hud);
}

/** pear-desktop's check for the audio-only layout: the player page hides its video panel. */
function isAudioOnly(ctx: Ctx) {
  const panel = ctx.$("player.main_panel");
  try {
    return (panel?.computedStyleMap().get("display") as CSSKeywordValue | undefined)?.value === "none";
  } catch {
    return false;
  }
}

// YTM shows the slider only while hovered; keep it out while scrolling. The
// classic bar shows it with its own "on-hover" class, the new one shows a popup.
function sliderReveal(ctx: Ctx) {
  const hide = debounce((element: HTMLElement, name: string) => element.classList.remove(name), SLIDER_MS);
  ctx.onCleanup(hide.cancel);
  return () => {
    const popup = ctx.$("player_bar.volume_popup");
    const element = popup ?? ctx.$("player_bar.volume_slider");
    if (!element) return;
    const name = popup ? "pear-volume-reveal" : "on-hover";
    element.classList.add(name);
    hide(element, name);
  };
}

function listenForWheel(ctx: Ctx, change: (direction: number) => void) {
  // Capture, and stop it there, so YTM's slider doesn't also step by 5.
  const onWheel = (event: WheelEvent) => {
    if (!ctx.config.wheel || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    change(event.deltaY < 0 ? 1 : -1);
  };
  void ctx.waitFor("player_bar").then((bar) => ctx.listen(bar, "wheel", onWheel, { capture: true, passive: false }));
  void ctx.waitFor("player.main_panel").then((panel) => ctx.listen(panel, "wheel", onWheel, { passive: false }));
}

function listenForArrows(ctx: Ctx, change: (direction: number) => void) {
  const onKeydown = (event: KeyboardEvent) => {
    if (!ctx.config.arrowsShortcut || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;
    if (isTyping(ctx, event)) return;
    event.preventDefault();
    event.stopPropagation();
    change(event.code === "ArrowUp" ? 1 : -1);
  };
  ctx.listen(window, "keydown", onKeydown, { capture: true });
}

/** Arrow keys in a text field or the open search box move the caret, not the volume. */
function isTyping(ctx: Ctx, event: KeyboardEvent) {
  const searchOpen = ctx.$<HTMLElement & { opened?: boolean }>("nav_bar.search_box")?.opened;
  return isEditable(event.composedPath()[0]) || !!searchOpen;
}
function isEditable(target: EventTarget | undefined) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
