export const getSongMenu = () => {
  const el = document.querySelector<HTMLElement>(
    'ytmusic-menu-popup-renderer tp-yt-paper-listbox',
  );
  console.log('[dom-elements] getSongMenu selector', 'ytmusic-menu-popup-renderer tp-yt-paper-listbox', 'found:', !!el);
  return el;
};
