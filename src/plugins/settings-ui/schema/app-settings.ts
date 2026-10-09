import { languageResources } from 'virtual:i18n';

import { t } from '@/i18n';
import { startingPages } from '@/providers/extracted-data';
import { Platform } from '@/types/plugins';

import { bridge, store, themePalette, themePresets } from '../state';

import type {
  ActionField,
  SelectField,
  SettingFieldBase,
  SettingOption,
  SettingsGroup,
  SwitchField,
  TextField,
} from '@/types/settings';

interface AppSection {
  id: 'general' | 'appearance' | 'window' | 'advanced' | 'plugins' | 'about';
  /** Icon id resolved to an inline SVG in the renderer. */
  icon: string;
  label: () => string;
  groups: SettingsGroup[];
}

/** Label for an option living in the app's native menu, reused verbatim. */
const menuLabel = (path: string) => () =>
  t(`main.menu.options.submenu.${path}`);

const DESKTOP = Platform.Windows | Platform.macOS;

/**
 * What a helper's `extras` argument accepts: the shared field properties plus
 * the concrete type's own extras, so `refreshable`, `variant` and the rest are
 * named once instead of redeclared per helper.
 */
type FieldExtras = Omit<SettingFieldBase, 'key' | 'label'>;
type TextExtras = FieldExtras &
  Omit<TextField, keyof SettingFieldBase | 'type'>;
type SelectExtras = FieldExtras &
  Omit<SelectField, keyof SettingFieldBase | 'type' | 'options'>;
type ActionExtras = FieldExtras &
  Omit<ActionField, keyof SettingFieldBase | 'type' | 'buttons'>;

const toggle = (
  key: string,
  label: () => string,
  extras: FieldExtras = {},
): SwitchField => ({ type: 'switch', key, label, ...extras });

const text = (
  key: string,
  label: () => string,
  extras: TextExtras = {},
): TextField => ({ type: 'text', key, label, ...extras });

const select = (
  key: string,
  label: () => string,
  options: SelectField['options'],
  extras: SelectExtras = {},
): SelectField => ({ type: 'select', key, label, options, ...extras });

const action = (
  key: string,
  label: () => string,
  buttons: ActionField['buttons'],
  extras: ActionExtras = {},
): ActionField => ({ type: 'action', key, label, buttons, ...extras });

/** Options whose value is only read when the app (re)starts. */
const AT_STARTUP = { restartNeeded: true } satisfies FieldExtras;

/** Dev builds have no updater, so every update setting is hidden on them. */
const UPDATES_ONLY = {
  visible: () => store()?.updates?.supported === true,
} satisfies FieldExtras;

const buildLanguageOptions = async (): Promise<SettingOption[]> => {
  const langResources = await languageResources();
  return Object.keys(langResources)
    .map((lang) => {
      const meta = langResources[lang].translation.language;
      return {
        value: lang,
        label: () => `${meta?.name ?? lang} (${meta?.['local-name'] ?? lang})`,
      };
    })
    .sort((a, b) => a.label().localeCompare(b.label()));
};

const buildThemeOptions = async (): Promise<SettingOption[]> => {
  const { themes } = await bridge.themes();
  return [
    {
      value: '',
      label: menuLabel('visual-tweaks.submenu.theme.submenu.no-theme'),
    },
    ...themes.map((theme) => ({ value: theme.id, label: () => theme.name })),
  ];
};

export const buildAppSections = (): AppSection[] => {
  const startingPageOptions: SettingOption[] = [
    { value: '', label: menuLabel('starting-page.unset') },
    ...Object.keys(startingPages).map((name) => ({
      value: name,
      label: () => name,
    })),
  ];

  return [
    {
      id: 'general',
      icon: 'settings',
      label: () => t('settings-ui.sections.general.label'),
      groups: [
        {
          title: () => t('settings-ui.groups.updates-session'),
          fields: [
            toggle('options.resumeOnStart', menuLabel('resume-on-start'), {
              restartNeeded: true,
            }),
          ],
        },
        {
          title: () => t('settings-ui.groups.startup-language'),
          fields: [
            select(
              'options.startingPage',
              menuLabel('starting-page.label'),
              startingPageOptions,
              { variant: 'dropdown', ...AT_STARTUP },
            ),
            select(
              'options.language',
              menuLabel('language.label'),
              buildLanguageOptions,
              {
                variant: 'dropdown',
                // The bundled language list cant change, and the field is
                // YouTube's own language, so it syncs instead of refreshing.
                refreshable: false,
                languageSync: true,
                ...AT_STARTUP,
              },
            ),
          ],
        },
        {
          title: menuLabel('shared-links.label'),
          fields: [
            toggle(
              'options.stripMusicFromSharedLinks',
              menuLabel('shared-links.submenu.strip-music'),
            ),
            toggle(
              'options.stripSIFromSharedLinks',
              menuLabel('shared-links.submenu.strip-si'),
            ),
          ],
        },
      ],
    },
    {
      id: 'appearance',
      icon: 'palette',
      label: () => t('settings-ui.sections.appearance.label'),
      groups: [
        {
          title: () => t('settings-ui.groups.interface'),
          fields: [
            toggle(
              'options.removeUpgradeButton',
              menuLabel('visual-tweaks.submenu.remove-upgrade-button'),
              AT_STARTUP,
            ),
            toggle(
              'options.useYtmIcons',
              menuLabel('visual-tweaks.submenu.use-ytm-icons'),
            ),
            select(
              'options.likeButtons',
              menuLabel('visual-tweaks.submenu.like-buttons.label'),
              [
                {
                  value: '',
                  label: menuLabel(
                    'visual-tweaks.submenu.like-buttons.default',
                  ),
                },
                {
                  value: 'force',
                  label: menuLabel(
                    'visual-tweaks.submenu.like-buttons.force-show',
                  ),
                },
                {
                  value: 'hide',
                  label: menuLabel('visual-tweaks.submenu.like-buttons.hide'),
                },
              ],
              AT_STARTUP,
            ),
            toggle(
              'options.swapLikeButtonsOrder',
              menuLabel('visual-tweaks.submenu.like-buttons.swap'),
              AT_STARTUP,
            ),
            toggle(
              'options.usePodcastParticipantAsArtist',
              () => t('settings-ui.fields.podcast-artist'),
              {
                description: () => t('settings-ui.fields.podcast-artist-desc'),
              },
            ),
          ],
        },
        {
          title: () => t('settings-ui.groups.window-title'),
          fields: [
            text(
              'options.customWindowTitle',
              menuLabel('visual-tweaks.submenu.custom-window-title.label'),
              {
                ...AT_STARTUP,
                placeholder: menuLabel(
                  'visual-tweaks.submenu.custom-window-title.prompt.placeholder',
                ),
              },
            ),
          ],
        },
        {
          title: menuLabel('visual-tweaks.submenu.theme.label'),
          fields: [
            select(
              'options.theme',
              menuLabel('visual-tweaks.submenu.theme.label'),
              buildThemeOptions,
              // The backend pushes the list when themes are imported.
              { variant: 'dropdown', refreshable: false },
            ),
            {
              type: 'custom',
              key: 'options.themePresets',
              label: () => t('settings-ui.fields.theme-preset'),
              component: 'settings-ui.themePreset',
              // The field draws this label itself, next to the pick.
              hideLabel: true,
              // A theme that ships no presets has nothing to pick.
              visible: () => Object.keys(themePresets()).length > 0,
            },
            {
              type: 'custom',
              key: 'options.themeOverrides',
              label: menuLabel(
                'visual-tweaks.submenu.theme.submenu.colors.label',
              ),
              component: 'settings-ui.themePalette',
              // Themes without palette variables have nothing to edit.
              visible: () => Object.keys(themePalette()).length > 0,
            },
            action(
              '__theme-files',
              menuLabel('visual-tweaks.submenu.theme.submenu.import-css-file'),
              [
                {
                  label: menuLabel(
                    'visual-tweaks.submenu.theme.submenu.import-css-file',
                  ),
                  onClick: async () => {
                    const path = await bridge.pickPath({
                      properties: ['openFile'],
                      filters: [{ name: 'CSS', extensions: ['css'] }],
                    });
                    if (path) await bridge.importThemeCss([path]);
                  },
                },
                {
                  label: menuLabel(
                    'visual-tweaks.submenu.theme.submenu.open-themes-folder',
                  ),
                  onClick: () => bridge.openThemesFolder(),
                },
              ],
              { hideLabel: true },
            ),
          ],
        },
      ],
    },
    {
      id: 'window',
      icon: 'window',
      label: () => t('settings-ui.sections.window.label'),
      groups: [
        {
          title: () => t('settings-ui.groups.window'),
          fields: [
            toggle('options.alwaysOnTop', menuLabel('always-on-top')),
            toggle('options.hideMenu', menuLabel('hide-menu.label'), {
              ...AT_STARTUP,
              platform: Platform.Windows | Platform.Linux,
            }),
          ],
        },
        {
          title: () => t('settings-ui.groups.system'),
          fields: [
            toggle('options.startAtLogin', menuLabel('start-at-login'), {
              platform: DESKTOP,
            }),
            toggle(
              'options.forceSmtc',
              menuLabel('advanced-options.submenu.force-smtc'),
              { ...AT_STARTUP, platform: Platform.Windows },
            ),
          ],
        },
        {
          title: menuLabel('tray.label'),
          fields: [
            select(
              'options.__trayMode',
              menuLabel('tray.label'),
              [
                {
                  value: 'off',
                  label: menuLabel('tray.submenu.disabled'),
                },
                {
                  value: 'show',
                  label: menuLabel('tray.submenu.enabled-and-show-app'),
                },
                {
                  value: 'hide',
                  label: menuLabel('tray.submenu.enabled-and-hide-app'),
                },
              ],
              AT_STARTUP,
            ),
            toggle(
              'options.trayClickPlayPause',
              menuLabel('tray.submenu.play-pause-on-click'),
            ),
            toggle(
              'options.trayMoveToCurrentDesktop',
              menuLabel('tray.submenu.move-to-current-desktop'),
            ),
            toggle(
              'options.trayForceWhiteIcons',
              menuLabel('tray.submenu.force-white-icons'),
            ),
          ],
        },
      ],
    },
    {
      id: 'advanced',
      icon: 'tune',
      label: () => t('settings-ui.sections.advanced.label'),
      groups: [
        {
          title: () => t('settings-ui.groups.network'),
          fields: [
            text(
              'options.proxy',
              menuLabel('advanced-options.submenu.set-proxy.label'),
              {
                ...AT_STARTUP,
                placeholder: menuLabel(
                  'advanced-options.submenu.set-proxy.prompt.placeholder',
                ),
              },
            ),
            toggle(
              'options.overrideUserAgent',
              menuLabel('advanced-options.submenu.override-user-agent'),
              AT_STARTUP,
            ),
          ],
        },
        {
          title: () => t('settings-ui.groups.performance'),
          fields: [
            toggle(
              'options.disableHardwareAcceleration',
              menuLabel(
                'advanced-options.submenu.disable-hardware-acceleration',
              ),
              AT_STARTUP,
            ),
            toggle(
              'options.autoResetAppCache',
              menuLabel('advanced-options.submenu.auto-reset-app-cache'),
              AT_STARTUP,
            ),
          ],
        },
        {
          title: () => t('settings-ui.groups.configuration'),
          fields: [
            toggle(
              'options.restartOnConfigChanges',
              menuLabel('advanced-options.submenu.restart-on-config-changes'),
            ),
            action(
              '__toggle-devtools',
              menuLabel('advanced-options.submenu.toggle-dev-tools'),
              [
                {
                  label: menuLabel('advanced-options.submenu.toggle-dev-tools'),
                  onClick: () => bridge.toggleDevTools(),
                },
              ],
            ),
            action(
              '__edit-config',
              menuLabel('advanced-options.submenu.edit-config-json'),
              [
                {
                  label: menuLabel('advanced-options.submenu.edit-config-json'),
                  onClick: () => bridge.configEdit(),
                },
              ],
            ),
          ],
        },
      ],
    },
    {
      id: 'plugins',
      icon: 'puzzle',
      label: () => t('settings-ui.sections.plugins.label'),
      groups: [],
    },
    {
      id: 'about',
      icon: 'info',
      label: () => t('settings-ui.sections.about.label'),
      groups: [
        {
          title: () => t('settings-ui.groups.updates'),
          fields: [
            toggle(
              'options.autoUpdates',
              menuLabel('updates.auto-update'),
              UPDATES_ONLY,
            ),
            select(
              'options.updateChannel',
              menuLabel('updates.channel.label'),
              [
                {
                  value: 'stable',
                  label: menuLabel('updates.channel.stable'),
                },
                { value: 'beta', label: menuLabel('updates.channel.beta') },
              ],
              UPDATES_ONLY,
            ),
          ],
        },
      ],
    },
  ];
};
