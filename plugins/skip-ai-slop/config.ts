import { config, type ConfigOf } from "@pear/sdk";

export const BLACKLIST_URL = "https://raw.githubusercontent.com/bwedirhan/pear-desktop-ai-slop-filter/main/blacklist.json";

/** AiSList's blocklist is plain text with one `@handle` per line; its warn list is deliberately not used. */
export const AISLIST_BLOCKLIST_URL = "https://raw.githubusercontent.com/Override92/AiSList/main/AiSList/aislist_blocklist.txt";

/** The slim matching cache: only the ids needed for filtering are kept. */
export const CACHE_KEY = "skip-ai-slop:blacklist";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export const MAX_SKIPS = 5;
export const SKIP_WINDOW_MS = 10_000;

export const schema = {
  hideInPages: config.bool(true, {
    label: "Hide in pages",
    description: "Hides flagged tracks in search, home, explore, library and playlists.",
  }),
  reportFeedback: config.bool(false, {
    label: 'Send "Not interested" for recommendations',
    description: "Sends permanent feedback for flagged home and explore cards. Slow, limited, and off by default.",
    group: "Filters",
  }),
  communityList: config.bool(true, {
    label: "Use the community list",
    description: "Matches the downloaded list of flagged channels and tracks.",
    group: "Filters",
  }),
  keywords: config.list([], {
    // A string list cannot hold a per-keyword on/off switch, so the 4.0.0
    // migration drops disabled keywords rather than start filtering what the
    // user had switched off.
    label: "Blocked keywords",
    description: "Skips tracks whose title or channel name contains one of these as a whole word (for example, “AI cover”).",
    placeholder: "AI cover",
    group: "Filters",
  }),
  userBlock: config.list([], {
    label: "Blocked channels",
    description: "Channel ids (UC…), track ids or exact channel names that are always filtered.",
    placeholder: "UC…, track id or channel name",
    group: "Filters",
  }),
  userAllow: config.list([], {
    label: "Allowed channels",
    description:
      "Channel ids (UC…), a track id or exact channel names that are never filtered. This always wins over the lists and keywords.",
    placeholder: "UC…, track id or channel name",
    group: "Filters",
  }),
};

export type SkipAiSlopConfig = ConfigOf<typeof schema>;
