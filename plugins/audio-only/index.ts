import { definePlugin, type YTPlayerApi } from "@pear/sdk";

const ATV = "ATV_PREFERRED";
const QUALITY = "tiny";

type StyleValue = [value: string, priority: string];

/** The older quality method YTM's player still has. */
interface QualityApi extends YTPlayerApi {
  setPlaybackQuality?(quality: string): void;
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

    // The lowest quality makes YTM take its audio-only path.
    const requestTinyQuality = () => {
      const api = ctx.player.api;
      if (!api) return;
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
    let watchedPlayer: HTMLElement | null = null;
    let content: MutationObserver | undefined;
    let stopped = false;

    /** YTM writes the mode back after loading a track; keep it audio-only. */
    const lockPlaybackMode = (player: HTMLElement) => {
      if (player === lockedPlayer) return;
      lock?.disconnect();
      lockedPlayer = player;
      lock = new MutationObserver(() => {
        if (lockedPlayer?.isConnected && lockedPlayer.getAttribute("playback-mode") !== ATV) {
          lockedPlayer.setAttribute("playback-mode", ATV);
        }
      });
      lock.observe(player, { attributes: true, attributeFilter: ["playback-mode"] });
    };

    /** YTM re-creates the video inside the player; hide the new one too. */
    const watchContent = (player: HTMLElement) => {
      if (player === watchedPlayer) return;
      content?.disconnect();
      watchedPlayer = player;
      content = new MutationObserver(apply);
      content.observe(player, { childList: true, subtree: true });
    };

    const apply = () => {
      if (stopped) return;
      const player = ctx.$("player.container");
      if (!player) return;
      setAttribute(player, "playback-mode", ATV);
      setStyle(player, "margin", "auto 0px");
      lockPlaybackMode(player);
      watchContent(player);
      setStyle(ctx.$("player.song_video"), "display", "none");
      setStyle(ctx.$("player.song_image"), "display", "block");
      setStyle(ctx.$("player.video"), "display", "none");
      forceThumbnail();
    };

    // The player is re-created on navigation; the observer is cheap and applies only then.
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
      forceThumbnail();
      // The new track's video and artwork land a moment after the event.
      ctx.setTimeout(() => {
        apply();
        forceThumbnail();
      }, 50);
    });

    ctx.onCleanup(() => {
      stopped = true;
      lock?.disconnect();
      content?.disconnect();
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
