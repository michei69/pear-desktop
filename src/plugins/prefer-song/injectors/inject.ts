interface TextRuns {
  runs: { text: string }[];
}

interface QueueItem {
  videoId?: string;
  playlistSetVideoId?: string;
  title?: TextRuns;
  longBylineText?: TextRuns;
  shortBylineText?: TextRuns;
  lengthText?: TextRuns;
  thumbnail?: { thumbnails: { url: string }[] };
}

interface ReleaseRow {
  playlistItemData?: { playlistSetVideoId?: string };
}

/**
 * Replaces music videos with their song version while a release is playing.
 *
 * YouTube Music serves some release tracks as music videos, which play the
 * video's audio including its intro and outro. Every release row links to its
 * song version through the `MPTC` credits id, and that mapping is used to
 * rewrite the queue and the player request before playback starts.
 *
 * Runs in the page via `webFrame.executeJavaScript`, so it must stay
 * self-contained: it is injected as its own source and closes over nothing.
 */
export function installPreferSong() {
  const originalFetch = window.fetch.bind(window);
  const studioIdBySetId = new Map<string, string>();
  const releaseRequests = new Map<string, Promise<void>>();
  const playlistRequests = new Map<string, Promise<void>>();
  const studioItemRequests = new Map<string, Promise<QueueItem | undefined>>();

  const gunzip = (buffer: ArrayBuffer) =>
    new Response(
      new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();

  const gzip = (text: string) =>
    new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();

  const innertube = async (path: string, body: Record<string, string>) => {
    const config = (
      window as unknown as { ytcfg: { get(key: string): unknown } }
    ).ytcfg;
    const key = config.get('INNERTUBE_API_KEY') as string;
    const response = await originalFetch(
      '/youtubei/v1/' + path + '?key=' + key + '&prettyPrint=false',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: config.get('INNERTUBE_CONTEXT'),
          ...body,
        }),
      },
    );
    return await response.json();
  };

  const collect = <T>(data: unknown, key: string): T[] => {
    const found: T[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record[key]) found.push(record[key] as T);
      for (const child of Object.values(record)) walk(child);
    };
    walk(data);
    return found;
  };

  const creditsVideoId = (row: unknown) =>
    collect<string>(row, 'browseId')
      .find((id) => typeof id === 'string' && id.startsWith('MPTC'))
      ?.slice(4);

  const releasePlaylistId = (value: unknown) =>
    typeof value === 'string' && value.startsWith('OLAK5uy_') ? value : null;

  const playerSetVideoId = (params: unknown) =>
    typeof params === 'string'
      ? (/[0-9A-F]{16}/.exec(atob(decodeURIComponent(params)))?.[0] ?? null)
      : null;

  /** Runs `load` once per key, and forgets a failed load so the next call retries. */
  const memo = <T>(
    cache: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>,
  ) => {
    const pending = cache.get(key) ?? load();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
    return pending;
  };

  const loadRelease = (browseId: string) =>
    memo(releaseRequests, browseId, async () => {
      const rows = collect<ReleaseRow>(
        await innertube('browse', { browseId }),
        'musicResponsiveListItemRenderer',
      );
      for (const row of rows) {
        const studioId = creditsVideoId(row);
        const setId = row.playlistItemData?.playlistSetVideoId;
        if (studioId && setId) studioIdBySetId.set(setId, studioId);
      }
    });

  const loadReleaseOfPlaylist = (playlistId: string) =>
    memo(playlistRequests, playlistId, async () => {
      const playlist = JSON.stringify(
        await innertube('browse', { browseId: 'VL' + playlistId }),
      );
      const browseId = /MPREb_[A-Za-z0-9_-]+/.exec(playlist)?.[0];
      if (browseId) await loadRelease(browseId);
    });

  const studioQueueItem = (videoId: string) =>
    memo(studioItemRequests, videoId, async () => {
      const items = collect<QueueItem>(
        await innertube('next', { videoId }),
        'playlistPanelVideoRenderer',
      );
      return items.find((item) => item.videoId === videoId);
    });

  const studioIdFor = (setId: string, videoId: string) => {
    const studioId = studioIdBySetId.get(setId);
    return studioId && studioId !== videoId ? studioId : null;
  };

  const swapQueueItem = async (item: QueueItem) => {
    const rowId = item.videoId;
    const setId = item.playlistSetVideoId;
    if (!rowId || !setId) return;
    const studioId = studioIdFor(setId, rowId);
    if (!studioId) return;
    const studio = await studioQueueItem(studioId);
    if (!studio) return;

    // The rendered row carries the video id and type in several nested places,
    // so swap them across the whole row, then take the song row's metadata.
    const swapped = JSON.parse(
      JSON.stringify(item)
        .split(rowId)
        .join(studioId)
        .split('MUSIC_VIDEO_TYPE_OMV')
        .join('MUSIC_VIDEO_TYPE_ATV'),
    ) as QueueItem;
    Object.assign(item, swapped);

    item.title = studio.title;
    item.longBylineText = studio.longBylineText;
    item.shortBylineText = studio.shortBylineText;
    item.lengthText = studio.lengthText;
    item.thumbnail = studio.thumbnail;
  };

  const requestBodyOf = async (request: Request) =>
    JSON.parse(await gunzip(await request.arrayBuffer())) as Record<
      string,
      unknown
    >;

  const patchedOr = async <T>(patched: Promise<T | null>, original: T) => {
    try {
      return (await patched) ?? original;
    } catch {
      return original;
    }
  };

  const songPlayerRequest = async (request: Request) => {
    const body = await requestBodyOf(request.clone());
    const requestedId = body.videoId;
    if (typeof requestedId !== 'string') return null;

    const playlistId = releasePlaylistId(body.playlistId);
    const setId = playerSetVideoId(body.params);
    if (!playlistId || !setId) return null;
    if (!studioIdBySetId.has(setId)) await loadReleaseOfPlaylist(playlistId);

    const studioId = studioIdFor(setId, requestedId);
    if (!studioId) return null;

    body.videoId = studioId;
    return new Request(request, { body: await gzip(JSON.stringify(body)) });
  };

  const songQueueResponse = async (response: Response, sent: Request) => {
    const playlistId = releasePlaylistId(
      (await requestBodyOf(sent)).playlistId,
    );
    if (!playlistId) return null;
    await loadReleaseOfPlaylist(playlistId);

    const queue: unknown = JSON.parse(await response.text());
    await Promise.all(
      collect<QueueItem>(queue, 'playlistPanelVideoRenderer').map(
        swapQueueItem,
      ),
    );
    return new Response(JSON.stringify(queue), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!(input instanceof Request)) return originalFetch(input, init);

    if (input.url.includes('/youtubei/v1/player')) {
      return originalFetch(await patchedOr(songPlayerRequest(input), input));
    }
    if (input.url.includes('/youtubei/v1/next')) {
      const sent = input.clone();
      const response = await originalFetch(input);
      return patchedOr(songQueueResponse(response.clone(), sent), response);
    }
    return originalFetch(input, init);
  };
}
