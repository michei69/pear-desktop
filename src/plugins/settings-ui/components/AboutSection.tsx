import { For, Show } from 'solid-js';

import { APPLICATION_NAME, t } from '@/i18n';

import { Icon } from './Icon';

import iconYtm from '../../../../assets/icon-ytm.png?inline';
import iconSvg from '../../../../assets/icon.svg?raw';
import { buildDebugInfo, useCopyFeedback } from '../debug-info';
import { innertubeClientVersion } from '../injectors/flags';
import { bridge, store, type AppMeta } from '../state';

// Both logos inline: the YouTube Music one only ships as a PNG, and the
// renderer lives on music.youtube.com, so no relative asset URLs.
const ICON_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`;
const YTM_ICON_SRC = iconYtm;

const REPO = 'https://github.com/michei69/pear-desktop';

interface LinkDef {
  icon: 'github' | 'external';
  label: string;
  url: string;
}

const osOptionLabel = (platform: string) => {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Other Linux';
  return 'Other (specify below)';
};
const archOptionLabel = (arch: string) => {
  if (arch === 'x64') return 'x64';
  if (arch === 'ia32') return 'ia32';
  if (arch === 'arm64') return 'arm64 (including Apple Silicon)';
  return 'Other (specify below)';
};

export const AboutSection = (props: {
  meta?: AppMeta;
  enabledPlugins?: string[];
}) => {
  const { copied, copy } = useCopyFeedback();

  // The same artwork the app registers with the OS: the original logo, or YouTube
  // Music's when that option is on.
  const logo = () => (store()?.options.useYtmIcons ? YTM_ICON_SRC : ICON_SRC);

  const reportIssueUrl = () => {
    const params = new URLSearchParams({ template: 'bug_report.yml' });
    const meta = props.meta;
    if (meta) {
      params.set('app-version', meta.version);
      params.set('os', osOptionLabel(meta.platform));
      params.set('os-version', meta.osVersion);
      params.set('cpu-arch', archOptionLabel(meta.arch));
    }
    const plugins = props.enabledPlugins ?? [];
    if (plugins.length) {
      params.set(
        'enabled-plugins',
        plugins.map((name, i) => `${i + 1}. ${name}`).join('\n'),
      );
    }
    return `${REPO}/issues/new?${params.toString()}`;
  };

  const versionRows = () => {
    const meta = props.meta;
    return [
      {
        label: t('settings-ui.about.version-app'),
        value: meta ? `v${meta.version}` : '…',
      },
      {
        label: t('settings-ui.about.version-build'),
        value: meta?.build ?? '…',
      },
      {
        label: t('settings-ui.about.version-electron'),
        value: meta?.versions.electron ?? '…',
      },
      {
        label: t('settings-ui.about.version-chromium'),
        value: meta?.versions.chrome ?? '…',
      },
      {
        label: t('settings-ui.about.version-node'),
        value: meta?.versions.node ?? '…',
      },
      {
        label: t('settings-ui.about.version-platform'),
        value: meta ? `${meta.platform} (${meta.arch})` : '…',
      },
      {
        label: t('settings-ui.about.version-innertube'),
        value: innertubeClientVersion() ?? 'unknown',
      },
    ];
  };

  const links = (): LinkDef[] => [
    { icon: 'github', label: t('settings-ui.about.link-repo'), url: REPO },
    {
      icon: 'external',
      label: t('settings-ui.about.link-issue'),
      url: reportIssueUrl(),
    },
    {
      icon: 'external',
      label: t('settings-ui.about.link-releases'),
      url: `${REPO}/releases`,
    },
    {
      icon: 'external',
      label: t('settings-ui.about.link-license'),
      url: `${REPO}/blob/master/license`,
    },
  ];

  return (
    <div class="sui-about">
      <div class="sui-about__header">
        <img alt="" class="sui-about__logo" src={logo()} />
        <div class="sui-about__name">{APPLICATION_NAME}</div>
        <Show when={props.meta}>
          {/* Full build string here, the App and Build rows below stay separate. */}
          <div class="sui-about__version">
            {`v${props.meta!.version} ${props.meta!.build}`}
          </div>
        </Show>
        <div class="sui-about__tagline">{t('settings-ui.about.tagline')}</div>
      </div>

      <div class="sui-card sui-about__card">
        <div class="sui-about__section-title">
          {t('settings-ui.about.versions')}
        </div>
        <dl class="sui-about__grid">
          <For each={versionRows()}>
            {(row) => (
              <div class="sui-about__grid-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </div>

      <div class="sui-card sui-about__card">
        <div class="sui-about__section-title">
          {t('settings-ui.about.links')}
        </div>
        <div class="sui-about__links">
          <For each={links()}>
            {(link) => (
              <button
                class="sui-outlinedbtn sui-about__link"
                onClick={() => bridge.openExternal(link.url)}
                type="button"
              >
                <Icon name={link.icon} size={18} />
                <span>{link.label}</span>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="sui-card sui-about__card">
        <div class="sui-about__section-title">
          {t('settings-ui.about.actions')}
        </div>
        <div class="sui-actions">
          <button
            class="sui-outlinedbtn"
            onClick={() => {
              // Dev builds and auto-updates-off both reject here; the menu's entry is
              // hidden in exactly those cases.
              bridge.checkUpdates().catch(() => {});
            }}
            type="button"
          >
            {t('settings-ui.about.check-updates')}
          </button>
          <button
            class="sui-outlinedbtn"
            onClick={() => {
              if (props.meta) {
                copy(
                  buildDebugInfo(
                    props.meta,
                    props.enabledPlugins ?? [],
                    store()?.options.featureFlags ?? {},
                  ),
                );
              }
            }}
            type="button"
          >
            {copied()
              ? t('settings-ui.about.copied')
              : t('settings-ui.about.copy-debug')}
          </button>
        </div>
      </div>

      <Show when={props.meta?.copyright}>
        <div class="sui-about__copyright">{props.meta!.copyright}</div>
      </Show>
    </div>
  );
};
