import { describe, expect, it } from "vitest";
import { browseContent } from "../../../packages/page/src/browse.ts";
import { parseByline, queueItems } from "../../../packages/page/src/queue.ts";
import { searchResults } from "../../../packages/page/src/search.ts";

const THUMBNAILS = [
  { url: "https://lh3.example/small.jpg", width: 60, height: 60 },
  { url: "https://lh3.example/large.jpg", width: 120, height: 120 },
];

const linked = (text: string, pageType: string) => ({
  text,
  navigationEndpoint: {
    browseEndpoint: { browseId: "UCartist", browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } },
  },
});

const row = (title: string, byline: unknown[], videoId: string) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: byline } } },
    ],
    playlistItemData: { videoId },
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: THUMBNAILS } } },
  },
});

describe("queue mapping", () => {
  it("parses artist, album and year bylines", () => {
    expect(parseByline([{ text: "Artist • Album • 2021" }])).toEqual({ artist: "Artist", album: "Album", year: "2021" });
  });

  it("maps items, skips unplayable ones and keeps raw renderers only when asked", () => {
    const renderer = {
      videoId: "v1",
      title: { runs: [{ text: "Song" }] },
      longBylineText: { runs: [{ text: "A • B" }] },
      selected: true,
      canReorder: true,
    };
    const items = [{ playlistPanelVideoRenderer: renderer }, { playlistPanelVideoRenderer: {} }, null];
    expect(queueItems(items, false)).toEqual([
      expect.objectContaining({
        videoId: "v1",
        title: "Song",
        artist: "A",
        album: "B",
        index: 0,
        url: "https://music.\u0079outube.com/watch?v=v1",
        selected: true,
      }),
    ]);
    expect(queueItems(items, true)?.[0]?.renderer).toBe(renderer);
  });
});

describe("search parsing", () => {
  it("reads catalog rows, credits linked artists and ignores album links", () => {
    const response = {
      contents: {
        tabbedSearchResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                tabIdentifier: "music_search_catalog",
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicShelfRenderer: {
                          contents: [
                            row(
                              "Song",
                              [
                                { text: "Song" },
                                linked("Artist", "MUSIC_PAGE_TYPE_ARTIST"),
                                { text: " • " },
                                linked("Album", "MUSIC_PAGE_TYPE_ALBUM"),
                              ],
                              "v1",
                            ),
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };
    expect(searchResults(response)).toEqual([
      expect.objectContaining({
        title: "Song",
        artist: "Artist",
        videoId: "v1",
        url: "https://music.\u0079outube.com/watch?v=v1",
        thumbnail: "https://lh3.example/large.jpg",
      }),
    ]);
  });
});

describe("browse parsing", () => {
  it("flattens the header, two-row items and the continuation token", () => {
    const response = {
      header: {
        musicResponsiveHeaderRenderer: {
          title: { runs: [{ text: "Album" }] },
          subtitle: { runs: [{ text: "Artist" }] },
          thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: THUMBNAILS } } },
        },
      },
      contents: [
        {
          musicTwoRowItemRenderer: {
            title: { runs: [{ text: "Track" }] },
            subtitle: { runs: [{ text: "Song" }, linked("Artist", "MUSIC_PAGE_TYPE_ARTIST")] },
            thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: THUMBNAILS } } },
            navigationEndpoint: { watchEndpoint: { videoId: "v1" } },
          },
        },
      ],
      continuations: [{ nextContinuationData: { continuation: "token" } }],
    };
    const page = browseContent(response, "MPREalbum");
    expect(page).toMatchObject({
      browseId: "MPREalbum",
      title: "Album",
      subtitle: "Artist",
      thumbnail: "https://lh3.example/large.jpg",
      continuation: "token",
      results: [expect.objectContaining({ title: "Track", artist: "Artist", videoId: "v1" })],
    });
  });
});
