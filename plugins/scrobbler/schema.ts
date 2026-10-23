import { config, type HostContextOf } from "@pear/sdk";
import { DEFAULT_FILTERS } from "./filters.ts";

export const schema = {
  lastfmEnabled: config.bool(false, {
    label: "Last.fm",
    description: "Enabling opens a Last.fm window to authorize Pear Desktop.",
  }),
  lastfmSessionKey: config.string("", {
    label: "Last.fm session",
    secret: true,
    description: "Filled in after authorizing. Clear it to authorize again (e.g. another account).",
  }),
  lastfmApiKey: config.string("04d76faaac8726e60988e14c105d421a", { label: "Last.fm API key" }),
  lastfmSecret: config.string("a5d2a36fdf64819290f6982481eaffa2", { label: "Last.fm API secret", secret: true }),
  lastfmApiRoot: config.string("https://ws.audioscrobbler.com/2.0/", { label: "Last.fm API root" }),
  listenbrainzEnabled: config.bool(false, { label: "ListenBrainz" }),
  listenbrainzToken: config.string("", {
    label: "ListenBrainz user token",
    secret: true,
    description: "From listenbrainz.org/settings.",
  }),
  listenbrainzApiRoot: config.string("https://api.listenbrainz.org/1/", {
    label: "ListenBrainz API root",
    description: "Change it for a compatible self-hosted server.",
  }),
  scrobbleOtherMedia: config.bool(true, {
    label: "Scrobble other videos",
    description: "Also scrobble podcasts and user uploads, not only songs and official music videos.",
  }),
  alternativeTitles: config.bool(true, {
    label: "Use alternative titles",
    description:
      "Prefer \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music's alternative title when it has one (e.g. original-script titles).",
  }),
  alternativeArtist: config.bool(true, {
    label: "Use the canonical artist",
    description: "Prefer the track's first tag as the artist (e.g. “DECO*27” instead of “DECO*27 & marasy”).",
  }),
  customRegexFilters: config.list([...DEFAULT_FILTERS], {
    label: "Title and artist filters",
    description:
      "Regular expressions removed from both the title and the artist before scrobbling. An expression that doesn't compile is skipped.",
  }),
  useMusicBrainz: config.bool(false, {
    label: "Verify with MusicBrainz",
    description:
      "Look the song up in MusicBrainz and scrobble its title and artist. Results are cached; a slow server never holds a scrobble for long.",
  }),
  musicBrainzEmail: config.string("", {
    label: "MusicBrainz contact email",
    placeholder: "you@example.com",
    description: "MusicBrainz asks API users to identify themselves with a contact address.",
  }),
};

export type Ctx = HostContextOf<typeof schema>;
