import { config, type PageContextOf } from "@pear/sdk";
import type { CosmeticsRequest } from "./engine.ts";

export const LITE = "Lite";
export const BALANCED = "Balanced";
export const STRICT = "Strict";

export type Profile = typeof LITE | typeof BALANCED | typeof STRICT;

export const schema = {
  // pear-desktop's and the fork's profiles, under the key both stored them in.
  blocker: config.select(
    BALANCED,
    [
      { value: LITE, label: "Lite" },
      { value: BALANCED, label: "Balanced" },
      { value: STRICT, label: "Strict" },
    ],
    {
      label: "Profile",
      description:
        "Lite removes ad and tracking placements from the player's data. Balanced adds the bundled privacy lists; " +
        "strict also blocks playback and behavioral telemetry.",
    },
  ),
  skipAds: config.bool(true, {
    label: "Skip ads that still play",
    description: "Gets through them in a blink, muted, without cutting into the track.",
  }),
  cache: config.bool(true, {
    label: "Cache the blocklists",
    description: "Starts blocking instantly on launch; lists refresh in the background.",
    group: "Blocklists",
  }),
  customEnabled: config.bool(false, {
    label: "Custom lists and rules",
    description: "Use your own remote lists, inline rules and local lists on top of the profile.",
    group: "Blocklists",
  }),
  additionalBlockLists: config.list([], {
    label: "Additional blocklists",
    placeholder: "https://…/filters.txt",
    description: "URLs of extra lists in Adblock Plus / uBlock syntax.",
    group: "Blocklists",
  }),
  additionalBlockListRules: config.list([], {
    label: "Inline rules",
    placeholder: "||example.com^",
    description: "Single Adblock Plus / uBlock rules, one per entry.",
    group: "Blocklists",
  }),
  disableDefaultLists: config.bool(false, {
    label: "Disable the default blocklists",
    description: "Only use the profile's bundled lists and your own.",
    group: "Blocklists",
  }),
  disabledLocalBlockLists: config.list([], {
    label: "Disabled local blocklists",
    placeholder: "blocklist.txt",
    description: "Names of files in the blocklists folder that are not loaded.",
    group: "Blocklists",
  }),
  // pear-desktop applied the lists' cosmetic filters too; their scriptlets for the video
  // site can desync playback, so those are opt-in.
  cosmeticFilters: config.select(
    "styles",
    [
      { value: "off", label: "Off" },
      { value: "styles", label: "Hide elements" },
      { value: "all", label: "Hide elements and run scriptlets" },
    ],
    {
      label: "Cosmetic filters",
      description: "The lists' element hiding; scriptlets may cut the start of tracks.",
      group: "Blocklists",
    },
  ),
};

export interface DoNotTrackCommands {
  /** The blocklists' cosmetic filters for the page (null until the lists are loaded). */
  cosmetics(request: CosmeticsRequest): { styles: string; scripts: string[] } | null;
}

export type Ctx = PageContextOf<typeof schema, DoNotTrackCommands>;
