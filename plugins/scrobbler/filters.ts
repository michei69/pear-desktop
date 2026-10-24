// pear-desktop's default title/artist filters, and the safe application of the
// user's own regexes. A filter that does not compile is skipped: the list is
// edited by hand, so one typo must not stop every scrobble.

/** Bracket tags, versions and YTM noise; pear-desktop's list, in order. */
export const DEFAULT_FILTERS: readonly string[] = [
  // (Explicit) or [Explicit] or Clean
  "\\s[([]Explicit[)\\]]",
  "\\s[([]Clean[)\\]]",
  // Features
  "\\s[([]feat\\. [^)\\]]+[)\\]]",
  "\\s[([]ft\\. [^)\\]]+[)\\]]",
  // Live
  "\\s-\\sLive(\\s.+)?$",
  "\\s[([]Live[)\\]]$",
  // Parodies and adaptations
  '\\s\\(Parody of ".*" by .*\\)$',
  '\\s\\(Lyrical Adaption of ".*"\\)$',
  // Re-issue
  "\\sRe-?issue$",
  "\\s\\[.*?Re-?issue.*?\\]",
  "\\s\\(.*?Re-?issue.*?\\)",
  // Remastered
  "Live\\s\\/\\sRemastered",
  "\\s[([][^)\\]]*Re-?[Mm]aster(ed)?[^)\\]]*[)\\]]$",
  "\\s-\\s\\d{4}(\\s-)?\\s.*Re-?[Mm]aster(ed)?.*$",
  "\\s-\\sRe-?[Mm]aster(ed)?.*$",
  "\\s\\[Remastered\\]\\s\\(Remastered\\sVersion\\)$",
  // Versions
  "\\s[([]Album Version[)\\]]$",
  "\\s[([]Re-?recorded[)\\]]$",
  "\\s[([]Single Version[)\\]]$",
  "\\s[([]Edit[)\\]]$",
  "\\s-\\sMono Version$",
  "\\s-\\sStereo Version$",
  "\\s\\(Deluxe Edition\\)$",
  "\\s[([]Expanded.*[)\\]]$",
  "\\s-\\sExpanded Edition$",
  "\\s[([]Explicit Version[)\\]]",
  "\\s[([]Bonus Track Edition[)\\]]",
  "\\s[([]\\d+th\\sAnniversary.*[)\\]]",
  "\\s-\\sOriginal$",
  "\\s-\\sOriginal.*Version(\\s\\d{4})?$",
  // YTM specific
  "\\*+\\s?\\S+\\s?\\*+$",
  "\\[[^\\]]+\\]",
  "【[^】]+】",
  "（[^）]+）",
  "\\([^)]*version\\)$",
  "\\.(avi|wmv|mpg|mpeg|flv)$",
  "\\(.*lyrics?\\s*(video)?\\)",
  "\\((of+icial\\s*)?(track\\s*)?stream\\)",
  "\\((of+icial\\s*)?((music|hd)\\s*)?(video|audio)\\)",
  "-\\s(of+icial\\s*)?(music\\s*)?(video|audio)$",
  "\\(.*Album\\sTrack\\)",
  "\\(\\s*of+icial\\s*\\)",
  "\\(\\s*[0-9]{4}\\s*\\)",
  "\\(\\s*(HD|HQ)\\s*\\)$",
  "(HD|HQ)\\s?$",
  "(vid[\u00e9e]o)?\\s?clip\\sof+ici[ae]l",
  "of+iziel+es\\s*video",
  "vid[\u00e9e]o\\s?clip",
  "\\sclip",
  "full\\s*album",
  "\\(live.*?\\)$",
  "\\|.*$",
  "\\(.*[0-9]{1,2}\\/[0-9]{1,2}\\/[0-9]{2,4}.*\\)",
  "sub\\s*español",
  "\\s\\(Letra\\)",
  "\\s\\(En\\svivo\\)",
];

/** pear-desktop stops filtering once a name is longer than this. */
const MAX_LENGTH = 256;

/** Applies one filter, keeping the name unchanged when the expression is invalid. */
export function applyFilter(name: string, filter: string) {
  if (name.length > MAX_LENGTH) return name;
  try {
    return name.replace(new RegExp(filter, "gi"), "").trim();
  } catch {
    // A user-supplied regex that doesn't compile is skipped, as before.
    return name;
  }
}

/** The title and artist the scrobbler submits: every filter in turn, applied to both. */
export function applyFilters(title: string, artist: string, filters: readonly string[]) {
  let scrobbleTitle = title;
  let scrobbleArtist = artist;
  for (const filter of filters) {
    scrobbleTitle = applyFilter(scrobbleTitle, filter);
    scrobbleArtist = applyFilter(scrobbleArtist, filter);
  }
  return { scrobbleTitle, scrobbleArtist };
}
