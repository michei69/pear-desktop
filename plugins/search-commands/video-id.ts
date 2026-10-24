const VIDEO_ID = /^[\w-]{11}$/;
const SITE_HOST = /(^|\.)\u0079\u006f\u0075\u0074\u0075\u0062\u0065\.com$|(^|\.)\u0079\u006f\u0075\u0074\u0075\u002e\u0062\u0065$/;

/** A bare video id, a `youtu.be/<id>` link, or any watch URL carrying `?v=`. */
export const parseVideoId = (input: string): string | undefined => {
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;

  try {
    const url = new URL(value);
    if (!SITE_HOST.test(url.hostname)) return undefined;

    const id = url.hostname.endsWith("\u0079\u006f\u0075\u0074\u0075\u002e\u0062\u0065")
      ? url.pathname.slice(1)
      : (url.searchParams.get("v") ?? "");

    return VIDEO_ID.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
};
