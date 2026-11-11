import type { PageContextOf, YTPlayerAudioTrack } from "@pear/sdk";
import { picker } from "@pear/sdk/dom";
import { createTrackReapply } from "./apply.ts";
import type { audioTrackConfig } from "./config.ts";
import { pickerChoices, readCurrentTrackId, readTracks, trackId } from "./tracks.ts";

type Ctx = PageContextOf<typeof audioTrackConfig>;

/** The player's own audio-change event is the second chance the retry cap exists for. */
const AUDIO_CHANGE_MS = 100;

/**
 * Picks which audio track plays, and keeps pear-desktop's preference applied on
 * every song change. The host part only opens this list, from the app menu and
 * the settings card; the page owns the tracks, so the list lives here and
 * scales to videos with many dub tracks (a native message box would not).
 */
export function startAudioTrack(ctx: Ctx) {
  const reapply = createTrackReapply({
    config: () => ctx.config,
    api: () => ctx.player.api,
    setTimeout: (callback, ms) => ctx.setTimeout(callback, ms),
    clearTimeout: (timer) => ctx.clearTimeout(timer),
  });

  /** Persists a picker answer (0 is Automatic) and makes it play. */
  const select = (index: number, tracks: readonly YTPlayerAudioTrack[]) => {
    if (index <= 0) {
      ctx.setConfig({ audioTrack: "" });
      // Automatic: the original track while preferOriginal is on, else nothing.
      reapply.resetNow();
      return;
    }

    const track = tracks[index - 1];
    const id = track ? trackId(track) : "";
    if (!track || !id) return;
    ctx.setConfig({ audioTrack: id });
    try {
      ctx.player.api?.setAudioTrack?.(track);
    } catch {
      // YTM refuses tracks it cannot serve for this player; the retries below try again.
    }
    reapply.reset();
  };

  const { button, popover } = picker(ctx, {
    name: "audio-track",
    label: ctx.t("plugins.audio-track.menu.label", "Audio track…"),
    // Material's audiotrack icon; without one the player-bar button is an empty circle.
    icon: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z",
    heading: ctx.t("plugins.audio-track.menu.message", "Which audio track should play?"),
    width: 240,
    items: () => {
      const api = ctx.player.api;
      const tracks = api ? readTracks(api) : [];
      const choices = pickerChoices(tracks, api ? readCurrentTrackId(api) : "");
      return [
        {
          label: ctx.t("plugins.audio-track.menu.automatic", "Automatic"),
          checked: choices.automatic,
          select: () => select(0, tracks),
        },
        ...choices.tracks.map((choice) => ({
          label: choice.label,
          checked: choice.checked,
          select: () => select(choice.index, tracks),
        })),
      ];
    },
  });

  // One track is no choice at all; the button appears only while there is one to make.
  button.hidden = true;
  const updateButton = () => {
    const api = ctx.player.api;
    button.hidden = !api || readTracks(api).length < 2;
  };
  ctx.mount(button, "player_bar.right_controls_buttons", "prepend");

  // The host's menu item and settings card ask for the list; answering says
  // whether the page could show it (it cannot before the player exists).
  ctx.host.handle("open", () => {
    const api = ctx.player.api;
    if (!api) return false;
    if (readTracks(api).length < 2) {
      ctx.toast(ctx.t("plugins.audio-track.toast.no-tracks", "This video has only one audio track."));
      return false;
    }
    // The same popover a click on the player-bar button opens.
    popover.showPopover();
    return true;
  });

  // dataloaded is the early event (the new track's audio is already playing);
  // trackChange is the fallback when YTM never sends dataupdated.
  const onTrack = () => {
    updateButton();
    reapply.reset();
  };
  ctx.player.on("trackLoading", onTrack);
  ctx.player.on("trackChange", onTrack);

  // Settings changes apply to the track that is playing, as pear-desktop did.
  ctx.onConfigChange(() => reapply.resetNow());

  // The player's own audio-change event is the second chance the cap exists for.
  void ctx.player
    .ready()
    .then((api) => {
      if (ctx.signal.aborted) return;
      const onChange = () => reapply.schedule(AUDIO_CHANGE_MS);
      api.addEventListener("onPlaybackAudioChange", onChange);
      ctx.onCleanup(() => api.removeEventListener("onPlaybackAudioChange", onChange));
      updateButton();
      reapply.schedule(0);
    })
    .catch(() => {});

  return () => reapply.stop();
}
