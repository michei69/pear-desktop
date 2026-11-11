import { definePlugin } from "@pear/sdk";
import { net } from "electron";
import { BLACKLIST_URL, schema } from "./config.ts";
import { HIDDEN_CSS } from "./early.ts";
import { startSkipAiSlop } from "./page.ts";

const FETCH_TIMEOUT_MS = 15_000;

export default definePlugin({
  id: "skip-ai-slop",
  name: "Skip AI slop",
  description: "Skips and hides AI-generated tracks, using keywords, your own lists and a community list.",
  config: schema,
  actions: {
    refreshList: {
      label: "Download list now",
      description: "Fetches the community list again.",
    },
    clearCache: {
      label: "Clear saved data",
      description: "Removes the saved list, its names, recent matches and feedback history.",
    },
    showRecent: {
      label: "Show recently filtered",
      description: "Puts the latest matches, with their ids, on this plugin's status line.",
    },
    allowRecent: {
      label: "Allow the newest recent match",
      description: "Adds the newest entry of “Show recently filtered” to Allowed channels and forgets it.",
    },
    removeRecent: {
      label: "Forget the newest recent match",
      description: "Removes the newest entry of “Show recently filtered” without allowing it.",
    },
    searchList: {
      label: "Search the community list",
      description: "Searches the saved names for the text in “Community list search”.",
    },
    allowListMatch: {
      label: "Allow the best list match",
      description: "Adds the first match for “Community list search” to Allowed channels.",
    },
  },
  host: {
    commands: {
      /** The page owns the matching cache; the host only does the network request. */
      async fetchList() {
        const response = await net.fetch(BLACKLIST_URL, {
          cache: "no-store",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`the community list answered ${response.status}`);
        return (await response.json()) as unknown;
      },
      async refreshList() {
        this.setStatus(this.t("plugins.skip-ai-slop.status.downloading", "Downloading…"));
        const message = await this.request<string>("refreshList", undefined, { timeout: 30_000 });
        this.setStatus(message);
        return message;
      },
      async clearCache() {
        const message = await this.request<string>("clearCache", undefined, { timeout: 10_000 });
        this.setStatus(message);
        return message;
      },
      async showRecent() {
        const message = await this.request<string>("showRecent");
        this.setStatus(message);
        return message;
      },
      // The settings card's buttons cannot carry an argument, so they act on
      // the newest entry the status line lists.
      async allowRecent(id?: string) {
        const message = await this.request<string>("allowRecent", id);
        this.setStatus(message);
        return message;
      },
      async removeRecent(id?: string) {
        const message = await this.request<string>("removeRecent", id);
        this.setStatus(message);
        return message;
      },
      async searchList() {
        const message = await this.request<string>("searchList");
        this.setStatus(message);
        return message;
      },
      async allowListMatch() {
        const message = await this.request<string>("allowListMatch");
        this.setStatus(message);
        return message;
      },
    },
  },
  style: HIDDEN_CSS,
  page: {
    // Before YTM's scripts, so cards are hidden from their links before paint.
    runAt: "start",
    start: startSkipAiSlop,
  },
});
