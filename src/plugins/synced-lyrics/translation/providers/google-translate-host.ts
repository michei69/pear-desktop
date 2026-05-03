export const normalizeGoogleTranslateHost = (input?: string): string => {
  let host = (input || 'translate.google.com').trim();
  if (!host) return 'translate.google.com';

  try {
    const url = new URL(host.includes('://') ? host : `https://${host}`);
    host = url.hostname;
  } catch {
    host = host.split('/')[0] ?? host;
  }

  host = host.replace(/^\.+|\.+$/g, '').toLowerCase();
  if (host.startsWith('www.google.')) return `translate.${host.slice(4)}`;
  if (host.startsWith('google.')) return `translate.${host}`;
  return host || 'translate.google.com';
};
