import { definePlugin } from "@pear/sdk";
import { net } from "electron";
import { BLACKLIST_URL, schema } from "./config.ts";
import type { FeedbackRequest } from "./contract.ts";
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
      description: "Puts the latest matches on this plugin's status line.",
    },
    searchList: {
      label: "Search the community list",
      description: "Searches the saved names for the text in “Community list search”.",
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
      /** "Not interested" for a recommendation card, using the page's InnerTube context. */
      async feedback(request: FeedbackRequest) {
        const query = request.key ? `?key=${encodeURIComponent(request.key)}&prettyPrint=false` : "?prettyPrint=false";
        const response = await this.session.fetch(
          "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i/v1/feedback" + query,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ context: request.context, feedbackTokens: [request.token] }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          },
        );
        if (!response.ok) throw new Error(`the feedback request answered ${response.status}`);
      },
      async refreshList() {
        this.setStatus("Downloading the community list…");
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
      async searchList() {
        const message = await this.request<string>("searchList");
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
