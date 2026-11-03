import { StatusDisplayType } from 'discord-api-types/v10';

import { APPLICATION_NAME, t } from '@/i18n';

const LABELS: Record<StatusDisplayType, string> = {
  [StatusDisplayType.Name]:
    'plugins.discord.menu.set-status-display-type.submenu.application',
  [StatusDisplayType.State]:
    'plugins.discord.menu.set-status-display-type.submenu.artist',
  [StatusDisplayType.Details]:
    'plugins.discord.menu.set-status-display-type.submenu.title',
};

export const STATUS_DISPLAY_TYPES = [
  StatusDisplayType.Name,
  StatusDisplayType.State,
  StatusDisplayType.Details,
] as const;

const INTERPOLATION_VALUES = {
  applicationName: APPLICATION_NAME,
  artist: '<artist>',
  songTitle: '<song title>',
};

export const statusDisplayLabel = (type: StatusDisplayType): string =>
  t(LABELS[type], INTERPOLATION_VALUES);
