import Color, { type ColorInstance } from 'color';
import { FastAverageColor } from 'fast-average-color';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

type AlbumColors = {
  color: ColorInstance;
  darkColor: ColorInstance;
};

const BLACK = '#000';

// Thumbnails are fetched by URL and can be requested again for the same track
// (seek, repeat, page re-entry), so keep the resolved colors keyed by URL.
const albumColorCache = new Map<string, Promise<AlbumColors | null>>();

function computeAlbumColors(hex: string): AlbumColors {
  const target = Color(hex);

  let color = target.darken(0.15).rgb();
  let darkColor = target.darken(0.3).rgb();

  while (color.luminosity() > 0.5) {
    color = color.darken(0.05);
    darkColor = darkColor.darken(0.05);
  }

  return { color, darkColor };
}

async function fetchAlbumColors(
  fastAverageColor: FastAverageColor,
  url: string,
): Promise<AlbumColors | null> {
  const cached = albumColorCache.get(url);
  if (cached) return cached;

  const pending = fastAverageColor
    .getColorAsync(url)
    .then((albumColor) => {
      if (!albumColor) {
        albumColorCache.delete(url);
        return null;
      }
      return computeAlbumColors(albumColor.hex);
    })
    .catch((err) => {
      console.error(err);
      albumColorCache.delete(url);
      return null;
    });

  albumColorCache.set(url, pending);
  return pending;
}

/**
 * Resolve `color-mix(in srgb, base <1 - ratio>, tint <ratio>)` in JS so the
 * browser does not have to re-resolve a color-mix() expression for every
 * property on every style recalc.
 */
function mixColor(
  base: string,
  tint: ColorInstance,
  alpha: number,
  ratio: number,
): string {
  const baseColor = Color(base);

  const tintWeight = Math.min(Math.max(ratio, 0), 1);
  const baseWeight = 1 - tintWeight;

  const baseAlpha = baseColor.alpha();
  const tintAlpha = Math.min(Math.max(alpha, 0), 1);
  const outAlpha = baseAlpha * baseWeight + tintAlpha * tintWeight;

  if (outAlpha <= 0) return 'rgba(0, 0, 0, 0)';

  const channel = (baseChannel: number, tintChannel: number) =>
    Math.round(
      (baseChannel * baseAlpha * baseWeight +
        tintChannel * tintAlpha * tintWeight) /
        outAlpha,
    );

  return `rgba(${channel(baseColor.red(), tint.red())}, ${channel(baseColor.green(), tint.green())}, ${channel(baseColor.blue(), tint.blue())}, ${+outAlpha.toFixed(3)})`;
}

const VARIABLE_MAP: Record<string, string> = {
  '--ytmusic-color-black1': '#212121',
  '--ytmusic-color-black2': '#181818',
  '--ytmusic-color-black3': '#030303',
  '--ytmusic-color-black4': '#030303',
  '--ytmusic-color-blackpure': '#000',
  '--dark-theme-background-color': '#212121',
  '--yt-spec-base-background': '#0f0f0f',
  '--yt-spec-raised-background': '#212121',
  '--yt-spec-menu-background': '#282828',
  '--yt-spec-static-brand-black': '#212121',
  '--yt-spec-static-overlay-background-solid': '#000',
  '--yt-spec-static-overlay-background-heavy': 'rgba(0,0,0,0.8)',
  '--yt-spec-static-overlay-background-medium': 'rgba(0,0,0,0.6)',
  '--yt-spec-static-overlay-background-medium-light': 'rgba(0,0,0,0.3)',
  '--yt-spec-static-overlay-background-light': 'rgba(0,0,0,0.1)',
  '--yt-spec-general-background-a': '#181818',
  '--yt-spec-general-background-b': '#0f0f0f',
  '--yt-spec-general-background-c': '#030303',
  '--yt-spec-snackbar-background': '#030303',
  '--yt-spec-filled-button-text': '#030303',
  '--yt-spec-black-1': '#282828',
  '--yt-spec-black-2': '#1f1f1f',
  '--yt-spec-black-3': '#161616',
  '--yt-spec-black-4': '#0d0d0d',
  '--yt-spec-black-pure': '#000',
  '--yt-spec-black-pure-alpha-5': 'rgba(0,0,0,0.05)',
  '--yt-spec-black-pure-alpha-10': 'rgba(0,0,0,0.1)',
  '--yt-spec-black-pure-alpha-15': 'rgba(0,0,0,0.15)',
  '--yt-spec-black-pure-alpha-30': 'rgba(0,0,0,0.3)',
  '--yt-spec-black-pure-alpha-60': 'rgba(0,0,0,0.6)',
  '--yt-spec-black-pure-alpha-80': 'rgba(0,0,0,0.8)',
  '--yt-spec-black-1-alpha-98': 'rgba(40,40,40,0.98)',
  '--yt-spec-black-1-alpha-95': 'rgba(40,40,40,0.95)',
  '--paper-toast-background-color': '#323232',
  '--ytmusic-search-background': '#030303',
  '--paper-slider-knob-color': '#f03',
  '--paper-dialog-background-color': '#212121',
  '--paper-progress-active-color-1': '#f03',
  '--paper-progress-active-color-2': '#ff2791',
  '--yt-spec-inverted-background': '#f3f3f3',
  'background': 'rgba(3, 3, 3)',
  '--ytmusic-background': 'rgba(3, 3, 3)',
};

const DARK_KEYED: Record<string, true> = {
  'background': true,
  '--ytmusic-background': true,
};

const RATIO_MAP: Record<string, number> = {
  '--paper-progress-active-color-1': 1.75,
  '--paper-progress-active-color-2': 1.75,
  '--yt-spec-inverted-background': 1.75,
};

type Config = {
  enabled: boolean;
  ratio: number;
  enableSeekbar: boolean;
};

type Renderer = {
  updateColor(alpha: number): void;
  onConfigChange(newConfig: Config): void;
};

export default createPlugin({
  name: () => t('plugins.album-color-theme.name'),
  description: () => t('plugins.album-color-theme.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    ratio: 0.5,
    enableSeekbar: true,
  } satisfies Config as Config,
  stylesheets: [style],
  settings: [
    {
      type: 'slider',
      key: 'ratio',
      label: () => t('plugins.album-color-theme.menu.color-mix-ratio.label'),
      min: 0,
      max: 100,
      step: 10,
      unit: '%',
      scale: 0.01,
    },
    {
      type: 'switch',
      key: 'enableSeekbar',
      label: () => t('plugins.album-color-theme.menu.enable-seekbar'),
    },
  ],
  menu: async ({ getConfig, setConfig }) => {
    const ratioList = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

    const config = await getConfig();

    return [
      {
        label: t('plugins.album-color-theme.menu.color-mix-ratio.label'),
        submenu: ratioList.map((ratio) => ({
          label: t(
            'plugins.album-color-theme.menu.color-mix-ratio.submenu.percent',
            {
              ratio: ratio * 100,
            },
          ),
          type: 'radio',
          checked: config.ratio === ratio,
          click() {
            setConfig({ ratio });
          },
        })),
      },
      {
        label: t('plugins.album-color-theme.menu.enable-seekbar'),
        type: 'checkbox',
        checked: config.enableSeekbar,
        click(item) {
          setConfig({ enableSeekbar: item.checked });
        },
      },
    ];
  },
  renderer: {
    playerPage: null as HTMLElement | null,
    navBarBackground: null as HTMLElement | null,
    ytmusicPlayerBar: null as HTMLElement | null,
    playerBarBackground: null as HTMLElement | null,
    sidebarBig: null as HTMLElement | null,
    sidebarSmall: null as HTMLElement | null,
    ytmusicAppLayout: null as HTMLElement | null,
    color: null as ColorInstance | null,
    darkColor: null as ColorInstance | null,
    ratio: 0.5,
    alpha: 1,

    start() {
      this.playerPage = document.querySelector<HTMLElement>('#player-page');
      this.navBarBackground = document.querySelector<HTMLElement>(
        '#nav-bar-background',
      );
      this.ytmusicPlayerBar =
        document.querySelector<HTMLElement>('ytmusic-player-bar');
      this.playerBarBackground = document.querySelector<HTMLElement>(
        '#player-bar-background',
      );
      this.sidebarBig = document.querySelector<HTMLElement>('#guide-wrapper');
      this.sidebarSmall = document.querySelector<HTMLElement>(
        '#mini-guide-background',
      );
      this.ytmusicAppLayout = document.querySelector<HTMLElement>('#layout');
    },
    async onPlayerApiReady(playerApi, { getConfig }) {
      const config = await getConfig();
      (this as Renderer).onConfigChange(config);

      const fastAverageColor = new FastAverageColor();

      document.addEventListener('videodatachange', async (event) => {
        if (event.detail.name !== 'dataloaded') return;

        const playerResponse = playerApi.getPlayerResponse();
        const thumbnail =
          playerResponse?.videoDetails?.thumbnail?.thumbnails?.at(0);
        if (!thumbnail) return;

        const colors = await fetchAlbumColors(fastAverageColor, thumbnail.url);

        this.color = colors?.color ?? Color(BLACK);
        this.darkColor = colors?.darkColor ?? Color(BLACK);

        let alpha = 1;
        if (await window.mainConfig.plugins.isEnabled('transparent-player')) {
          const value: unknown = window.mainConfig.get(
            'plugins.transparent-player.opacity',
          );
          if (typeof value === 'number' && value >= 0 && value <= 1) {
            alpha = value;
          }
        }
        (this as Renderer).updateColor(alpha);
      });
    },
    onConfigChange(config) {
      this.ratio = config.ratio;
      if (config.enableSeekbar) document.body.classList.add('seekbar-theme');
      else document.body.classList.remove('seekbar-theme');
      if (this.color) (this as Renderer).updateColor(this.alpha);
    },
    updateColor(alpha: number) {
      this.alpha = alpha;
      if (!this.color || !this.darkColor) return;

      const rootStyle = document.documentElement.style;
      for (const [variable, color] of Object.entries(VARIABLE_MAP)) {
        const tint = DARK_KEYED[variable] ? this.darkColor : this.color;
        rootStyle.setProperty(
          variable,
          mixColor(color, tint, alpha, this.ratio * (RATIO_MAP[variable] ?? 1)),
          'important',
        );
      }
    },
  },
});
