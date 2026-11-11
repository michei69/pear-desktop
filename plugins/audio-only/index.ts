import { definePlugin, type YTPlayerApi } from "@pear/sdk";

const ATV = "ATV_PREFERRED";
const QUALITY = "tiny";

type StyleValue = [value: string, priority: string];

/** The quality methods YTM's player still has beyond the SDK's player interface. */
interface QualityApi extends YTPlayerApi {
  setPlaybackQuality?(quality: string): void;
  /** The quality the user picked in YTM's own menu; it survives our forced minimum. */
  getUserPlaybackQualityPreference?(): string;
}

export default definePlugin({
  id: "audio-only",
  name: "Audio only",
  description: "Plays music without its video, showing the cover art instead.",
  page: (ctx) => {
    // Original values, put back when the plugin stops: another plugin (video-toggle)
    // may have set the same attributes and styles.
    const attributes = new Map<Element, Map<string, string | null>>();
    const styles = new Map<HTMLElement, Map<string, StyleValue>>();

    const setAttribute = (element: Element | null, name: string, value: string | null) => {
      if (!element || element.getAttribute(name) === value) return;
      let saved = attributes.get(element);
      if (!saved) {
        saved = new Map();
        attributes.set(element, saved);
      }
      if (!saved.has(name)) saved.set(name, element.getAttribute(name));
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    };

    const setStyle = (element: HTMLElement | null, property: string, value: string) => {
      if (!element || element.style.getPropertyValue(property) === value) return;
      let saved = styles.get(element);
      if (!saved) {
        saved = new Map();
        styles.set(element, saved);
      }
      if (!saved.has(property)) {
        saved.set(property, [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
      }
      element.style.setProperty(property, value);
    };

    /**
     * The cover art this plugin forced onto the shared image element, and what
     * was there before. Restored on stop only while the plugin's own URL is
     * still showing: a later track sets its own artwork, which must survive.
     */
    const forcedThumbnails = new Map<HTMLImageElement, { forced: string; original: string | null }>();

    const forceThumbnail = () => {
      const image = ctx.$<HTMLImageElement>("player.song_image_img");
      const thumbnails = ctx.player.api?.getPlayerResponse()?.videoDetails?.thumbnail?.thumbnails ?? [];
      const best = thumbnails.toSorted((a, b) => b.width * b.height - a.width * a.height)[0];
      // YTM leaves a data: placeholder in the cover-art slot for video tracks.
      if (!image || !best || !image.src.startsWith("data:")) return;
      const url = best.url.split("?")[0]!;
      const saved = forcedThumbnails.get(image);
      if (saved) saved.forced = url;
      else forcedThumbnails.set(image, { forced: url, original: image.getAttribute("src") });
      image.src = url;
    };

    /**
     * The user's playback-quality preference, read before the first forced
     * 'tiny' and put back on stop. Undefined until it can be read.
     */
    let savedQuality: string | undefined;

    // The lowest quality makes YTM take its audio-only path.
    const requestTinyQuality = () => {
      const api = ctx.player.api;
      if (!api) return;
      // Remember the preference before the first forced write, not the 'tiny' we
      // are about to force; the current quality is the fallback for players that
      // do not expose the preference.
      if (savedQuality === undefined) {
        try {
          const quality = (api as QualityApi).getUserPlaybackQualityPreference?.() || api.getPlaybackQuality();
          if (quality) savedQuality = quality;
        } catch {
          // The player cannot say yet; read it again on a later track.
        }
      }
      try {
        api.setPlaybackQualityRange(QUALITY);
        // YTM still exposes this older method, which the SDK's player interface omits.
        const qualityApi: QualityApi = api;
        qualityApi.setPlaybackQuality?.(QUALITY);
      } catch (error) {
        ctx.log.warn("could not request a smaller video quality", error);
      }
    };

    let lockedPlayer: HTMLElement | null = null;
    let lock: MutationObserver | undefined;
    let stopped = false;

    /** YTM writes the mode back after loading a track; keep it audio-only. */
    const lockPlaybackMode = (player: HTMLElement) => {
      if (player === lockedPlayer) return;
      lock?.disconnect();
      lockedPlayer = player;
      lock = new MutationObserver(() => {
        // video-toggle marks the player when its own switch asks for the video.
        // Re-asserting ATV then would make both observers flip the attribute
        // forever, so audio-only yields while that marker is present.
        if (
          lockedPlayer?.isConnected &&
          !lockedPlayer.hasAttribute("data-pear-show-video") &&
          lockedPlayer.getAttribute("playback-mode") !== ATV
        ) {
          lockedPlayer.setAttribute("playback-mode", ATV);
        }
      });
      lock.observe(player, { attributes: true, attributeFilter: ["playback-mode", "data-pear-show-video"] });
    };

    /** Puts the player page currently in the DOM into audio-only mode. */
    const apply = () => {
      if (stopped) return;
      const player = ctx.$("player.container");
      if (!player) return;
      setStyle(player, "margin", "auto 0px");
      // The video toggle's switch owns the mode while it asks for video.
      if (!player.hasAttribute("data-pear-show-video")) {
        setAttribute(player, "playback-mode", ATV);
        setStyle(ctx.$("player.song_video"), "display", "none");
        setStyle(ctx.$("player.song_image"), "display", "block");
        setStyle(ctx.$("player.video"), "display", "none");
      }
      lockPlaybackMode(player);
      forceThumbnail();
    };

    // The player page is re-created on navigation (not on every track), so this
    // only re-applies then; track loads are the player's own events below.
    ctx.observe("app", { childList: true, subtree: true }, () => {
      if (ctx.$("player.container") !== lockedPlayer) apply();
    });
    void ctx.waitFor("player.container").then(apply, () => {});
    void ctx.player.ready().then(
      () => {
        requestTinyQuality();
        apply();
      },
      () => {},
    );

    ctx.player.on("trackChange", () => {
      apply();
      requestTinyQuality();
      // The new track's video and artwork land a moment after the event.
      ctx.setTimeout(() => {
        apply();
        forceThumbnail();
      }, 50);
    });

    ctx.onCleanup(() => {
      stopped = true;
      lock?.disconnect();
      // Only while the player is still on our forced minimum: a quality the user
      // picked meanwhile must survive the plugin.
      const api = ctx.player.api;
      if (savedQuality) {
        try {
          if (api?.getPlaybackQuality() === QUALITY) {
            api.setPlaybackQualityRange(savedQuality);
            (api as QualityApi).setPlaybackQuality?.(savedQuality);
          }
        } catch {
          // The player may be gone or refuse the quality now.
        }
        savedQuality = undefined;
      }
      for (const [image, { forced, original }] of forcedThumbnails) {
        // The last track's artwork is still ours: put back the placeholder (or the
        // cover art a previous plugin left), so the player goes back to video art.
        if (image.src !== forced) continue;
        if (original === null) image.removeAttribute("src");
        else image.setAttribute("src", original);
      }
      for (const [element, saved] of attributes) {
        for (const [name, value] of saved) {
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        }
      }
      for (const [element, saved] of styles) {
        for (const [property, entry] of saved) {
          const [value, priority] = entry;
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        }
      }
    });
  },
});
