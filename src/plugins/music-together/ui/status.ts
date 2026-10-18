import { t } from '@/i18n';
import { ElementFromHtml } from '@/plugins/utils/renderer';

import statusHTML from '../templates/status.html?raw';

import type { Permission, Profile } from '../types';

export const createStatus = () => {
  const element = ElementFromHtml(statusHTML);
  const icon = document.querySelector<HTMLImageElement>(
    'ytmusic-settings-button > tp-yt-paper-icon-button > tp-yt-iron-icon#icon img',
  );

  const profile = element.querySelector<HTMLImageElement>(
    '.music-together-profile',
  )!;
  const statusLabel = element.querySelector<HTMLSpanElement>(
    '#music-together-status-label',
  )!;
  const permissionLabel = element.querySelector<HTMLMarqueeElement>(
    '#music-together-permission-label',
  )!;

  profile.src = icon?.src ?? '';

  const setStatus = (status: 'disconnected' | 'host' | 'guest') => {
    if (status === 'disconnected') {
      statusLabel.textContent = t(
        'plugins.music-together.menu.status.disconnected',
      );
      statusLabel.style.color = 'rgba(255, 255, 255, 0.5)';
    }

    if (status === 'host') {
      statusLabel.textContent = t('plugins.music-together.menu.status.host');
      statusLabel.style.color = 'rgba(255, 0, 0, 1)';
    }

    if (status === 'guest') {
      statusLabel.textContent = t('plugins.music-together.menu.status.guest');
      statusLabel.style.color = 'rgba(255, 255, 255, 1)';
    }
  };

  const setPermission = (permission: Permission) => {
    if (permission === 'host-only') {
      permissionLabel.textContent = t(
        'plugins.music-together.menu.permission.host-only',
      );
      permissionLabel.style.color = 'rgba(255, 255, 255, 0.5)';
    }

    if (permission === 'playlist') {
      permissionLabel.textContent = t(
        'plugins.music-together.menu.permission.playlist',
      );
      permissionLabel.style.color = 'rgba(255, 255, 255, 0.75)';
    }

    if (permission === 'all') {
      permissionLabel.textContent = t(
        'plugins.music-together.menu.permission.all',
      );
      permissionLabel.style.color = 'rgba(255, 255, 255, 1)';
    }
  };

  const setProfile = (src: string) => {
    profile.src = src;
  };

  const userElements = new Map<string, HTMLImageElement>();

  const setUsers = (users: Profile[]) => {
    const container = element.querySelector<HTMLDivElement>(
      '.music-together-user-container',
    )!;
    const empty = element.querySelector<HTMLElement>('.music-together-empty')!;

    const seen = new Set<string>();
    for (const user of users) {
      seen.add(user.id);

      let img = userElements.get(user.id);
      if (!img) {
        img = document.createElement('img');
        img.classList.add('music-together-profile');
        userElements.set(user.id, img);
      }

      // Image decoding is the expensive part, so only touch changed users.
      if (img.getAttribute('src') !== (user.thumbnail ?? ''))
        img.src = user.thumbnail ?? '';
      if (img.title !== user.name) img.title = user.name;

      const alt = `${user.name} (${user.id})`;
      if (img.alt !== alt) img.alt = alt;
    }

    for (const [id, img] of userElements) {
      if (seen.has(id)) continue;

      img.remove();
      userElements.delete(id);
    }

    // Re-append only when the order changed; `append` moves existing nodes
    // rather than cloning them, so no image is decoded twice.
    const ordered = users.map((user) => userElements.get(user.id)!);
    const current = Array.from(container.children).filter(
      (child): child is HTMLImageElement => child !== empty,
    );
    if (ordered.some((img, index) => current[index] !== img))
      container.append(...ordered);

    empty.style.display = users.length === 0 ? 'block' : 'none';
  };

  return {
    element,
    setStatus,
    setUsers,
    setProfile,
    setPermission,
  };
};
