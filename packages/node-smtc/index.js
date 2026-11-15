// index.js — SMTC Player example
// Wraps native addon with EventEmitter for idiomatic JS usage

import EventEmitter from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const native = require("./build/Release/smtc_player.node");

class SMTCPlayer extends EventEmitter {
  #started = false;

  /**
   * Start SMTC session. Creates hidden window + message pump on background thread.
   * Idempotent — subsequent calls are no-ops.
   */
  start() {
    if (this.#started) return;
    native.setEventCallback((name, value) => {
      if (value !== undefined) {
        this.emit(name, value);
      } else {
        this.emit(name);
      }
    });
    native.start();
    this.#started = true;
  }

  /**
   * Stop SMTC session. Tears down the background thread and releases
   * the SMTC session. Safe to call multiple times. After stop(),
   * start() can be called again to create a fresh session.
   */
  stop() {
    if (!this.#started) return;
    native.stop();
    this.#started = false;
  }

  /** @param {string} value */
  setArtist(value) {
    native.setArtist(value);
  }

  /** @param {string} value */
  setAlbumArtist(value) {
    native.setAlbumArtist(value);
  }

  /** @param {string} value */
  setTitle(value) {
    native.setTitle(value);
  }

  /** @param {string} value */
  setAlbumTitle(value) {
    native.setAlbumTitle(value);
  }

  /** @param {string} path — filesystem path to image file */
  setThumbnail(path) {
    native.setThumbnail(path);
  }

  /** @param {string} id — app identity string shown in SMTC UI */
  setAppMediaId(id) {
    native.setAppMediaId(id);
  }

  /** @param {boolean} enabled */
  setShuffle(enabled) {
    native.setShuffle(enabled);
  }

  /**
   * Set playback status.
   * @param {'playing'|'paused'|'stopped'|'changing'|'closed'} status
   */
  setPlaybackStatus(status) {
    native.setPlaybackStatus(status);
  }

  /**
   * Set auto-repeat mode.
   * @param {'none'|'track'|'list'} mode
   */
  setAutoRepeat(mode) {
    native.setAutoRepeat(mode);
  }

  /** @param {number} ms — start time in milliseconds */
  setStartTime(ms) {
    native.setStartTime(ms);
  }

  /** @param {number} ms — min seekable position in milliseconds */
  setMinSeekTime(ms) {
    native.setMinSeekTime(ms);
  }

  /** @param {number} ms — current playback position in milliseconds */
  setPosition(ms) {
    native.setPosition(ms);
  }

  /** @param {number} ms — max seekable position in milliseconds */
  setMaxSeekTime(ms) {
    native.setMaxSeekTime(ms);
  }

  /** @param {number} ms — end time (total duration) in milliseconds */
  setEndTime(ms) {
    native.setEndTime(ms);
  }
}

// --- demo ---
if (import.meta.url.startsWith("file://") && process.argv[1]?.endsWith("index.js")) {
  const player = new SMTCPlayer();
  player.start();

  let i = 0;
  setInterval(() => {
    player.setArtist(`Artist Name ${i++}`);
    player.setAlbumArtist(`Album Artist ${i++}`);
    player.setTitle(`Track Title ${i++}`);
    player.setAlbumTitle(`Album Title ${i++}`);
  }, 1000);
  player.setShuffle(false);
  player.setAutoRepeat("none");

  player.on("play", () => console.log("▶ play"));
  player.on("pause", () => console.log("⏸ pause"));
  player.on("next", () => console.log("⏭ next"));
  player.on("previous", () => console.log("⏮ previous"));
  player.on("stop", () => console.log("⏹ stop"));
  player.on("shuffle", (val) => console.log(`🔀 shuffle: ${val}`));
  player.on("repeat", (val) => console.log(`🔁 repeat: ${val}`));
  player.on("positionchange", (ms) => console.log(`⏩ positionchange: ${ms}ms`));

  // Set timeline: 3-minute track
  player.setStartTime(0);
  player.setEndTime(180000);
  player.setMinSeekTime(0);
  player.setMaxSeekTime(180000);
  player.setPosition(15);

  console.log("SMTC session active. Press media keys. Ctrl+C to exit.");
}

export default SMTCPlayer;
