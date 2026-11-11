// Windows System Media Transport Controls through the optional native module.
// Chromium's own media session is disabled only when this loads (see
// startup-tasks), so this is the only place Windows' media keys and flyout get
// their state from.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { livePosition } from "@pear/sdk";
import { artworkImage } from "@pear/sdk/artwork";
import type SMTCPlayer from "@michei69/node-smtc";
import type { PlayerMirror } from "./player.ts";

type SmtcConstructor = typeof SMTCPlayer;

export interface SmtcOptions {
  appMediaId: string;
  /** Where artwork is written for the native module, which takes a file path. */
  thumbnailPath?: string;
}

/**
 * Loads the optional native module, or null when it cannot run here. Windows
 * only: elsewhere the module must not even be loaded. Resolved before the
 * Chromium feature switches are applied so a missing or unbuilt addon keeps
 * Chromium's own media session as the fallback (see startup-tasks).
 */
export async function loadSmtc(): Promise<SmtcConstructor | null> {
  if (process.platform !== "win32") return null;
  try {
    return (await import("@michei69/node-smtc")).default as SmtcConstructor;
  } catch (error) {
    console.warn("[pear] SMTC unavailable:", error);
    return null;
  }
}

const REPEAT = { none: "none", all: "list", one: "track" } as const;
const POSITION_UPDATE_MS = 1000;

/** Starts forwarding the player to SMTC through the addon `loadSmtc` resolved. Throws if it cannot start. */
export function startSmtc(Addon: SmtcConstructor, player: PlayerMirror, options: SmtcOptions) {
  const smtc = new Addon();
  const thumbnailPath = options.thumbnailPath ?? join(app.getPath("userData"), "smtc-thumbnail.png");
  let generation = 0;
  let lastArtwork = "";
  let currentStatus = "";

  const publish = () => {
    const state = player.state;
    const track = state.track;
    if (!track) return;
    if (track.artworkUrl && track.artworkUrl !== lastArtwork) {
      const requested = ++generation;
      lastArtwork = track.artworkUrl;
      // The shared cache decodes each cover once for every OS integration.
      void artworkImage(track.artworkUrl)
        .then((image) => {
          if (requested !== generation || image.isEmpty()) return;
          writeFileSync(thumbnailPath, image.toPNG());
          smtc.setThumbnail(thumbnailPath);
        })
        .catch(() => {
          // Artwork is cosmetic; metadata and controls must still update.
        });
    }
    smtc.setArtist(track.artist);
    smtc.setAlbumArtist(track.artist);
    smtc.setAlbumTitle(track.album ?? "");
    smtc.setTitle(track.title);
    smtc.setStartTime(0);
    smtc.setMinSeekTime(0);
    smtc.setMaxSeekTime(track.durationSeconds * 1000);
    smtc.setEndTime(track.durationSeconds * 1000);
    smtc.setPosition(livePosition(state) * 1000);
    smtc.setShuffle(state.shuffle);
    smtc.setAutoRepeat(REPEAT[state.repeat]);
    const status =
      state.status === "playing" || state.status === "buffering" ? "playing" : state.status === "paused" ? "paused" : "stopped";
    if (status !== currentStatus) {
      currentStatus = status;
      smtc.setPlaybackStatus(status);
    }
  };

  smtc.on("play", () => player.control({ type: "play" }));
  smtc.on("pause", () => player.control({ type: "pause" }));
  smtc.on("next", () => player.control({ type: "next" }));
  smtc.on("previous", () => player.control({ type: "previous" }));
  smtc.on("shuffle", () => player.control({ type: "shuffle" }));
  smtc.on("repeat", () => player.control({ type: "repeat" }));
  smtc.on("positionchange", (ms: number) => player.control({ type: "seek", seconds: ms / 1000 }));

  const unsubscribe = player.on("change", publish);
  const positionTimer = setInterval(publish, POSITION_UPDATE_MS);
  smtc.setAppMediaId(options.appMediaId);
  smtc.start();
  publish();

  return () => {
    clearInterval(positionTimer);
    unsubscribe();
    generation++;
    smtc.stop();
  };
}
