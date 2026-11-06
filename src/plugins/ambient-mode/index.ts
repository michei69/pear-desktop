import { t } from '@/i18n';
import { observePlayerPage } from '@/providers/player-page-observer';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { mountAmbientLight } from './ambient-light';
import { menu } from './menu';
import style from './style.css?inline';
import {
  type AmbientModePluginConfig,
  type AmbientModeStyle,
  type AmbientModeTheme,
} from './types';

import type { VideoDataChanged } from '@/types/video-data-changed';

const ambientStyleOptions: AmbientModeStyle[] = ['standard', 'ambilight'];
const ambientThemeOptions: AmbientModeTheme[] = ['auto', 'light', 'dark'];

const defaultConfig: AmbientModePluginConfig = {
  enabled: false,
  style: 'standard',
  quality: 50,
  buffer: 30,
  interpolationTime: 1500,
  blur: 100,
  size: 100,
  opacity: 1,
  fullscreen: false,
  extendSidebar: false,
  barDetection: true,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  theme: 'auto',
  dimming: 0,
};

const setExtendSidebar = (enabled: boolean) =>
  document.body.classList.toggle('ambient-mode-extend-sidebar', enabled);

export default createPlugin({
  name: () => t('plugins.ambient-mode.name'),
  description: () => t('plugins.ambient-mode.description'),
  restartNeeded: false,
  config: defaultConfig,
  stylesheets: [style],
  settings: [
    {
      title: () => t('plugins.ambient-mode.settings.group.general'),
      fields: [
        {
          type: 'select',
          key: 'style',
          label: () => t('plugins.ambient-mode.menu.style.label'),
          description: () => t('plugins.ambient-mode.menu.style.tooltip'),
          options: ambientStyleOptions.map((option) => ({
            value: option,
            label: () => t(`plugins.ambient-mode.settings.style.${option}`),
          })),
        },
        {
          type: 'slider',
          key: 'interpolationTime',
          label: () =>
            t('plugins.ambient-mode.menu.smoothness-transition.label'),
          min: 0,
          max: 5,
          step: 0.5,
          unit: 's',
          scale: 1000,
        },
        {
          type: 'slider',
          key: 'quality',
          label: () => t('plugins.ambient-mode.menu.quality.label'),
          min: 10,
          max: 1000,
          step: 10,
          unit: 'px',
        },
        {
          type: 'slider',
          key: 'size',
          label: () => t('plugins.ambient-mode.menu.size.label'),
          min: 100,
          max: 300,
          step: 5,
          unit: '%',
        },
        {
          type: 'slider',
          key: 'buffer',
          label: () => t('plugins.ambient-mode.menu.buffer.label'),
          min: 1,
          max: 30,
          step: 1,
        },
        {
          type: 'slider',
          key: 'opacity',
          label: () => t('plugins.ambient-mode.menu.opacity.label'),
          min: 10,
          max: 100,
          step: 10,
          unit: '%',
          scale: 0.01,
        },
        {
          type: 'slider',
          key: 'blur',
          label: () => t('plugins.ambient-mode.menu.blur-amount.label'),
          min: 0,
          max: 500,
          step: 5,
          unit: 'px',
        },
        {
          type: 'switch',
          key: 'extendSidebar',
          label: () => t('plugins.ambient-mode.menu.extend-sidebar.label'),
          description: () =>
            t('plugins.ambient-mode.menu.extend-sidebar.description'),
        },
        {
          type: 'switch',
          key: 'fullscreen',
          label: () => t('plugins.ambient-mode.menu.use-fullscreen.label'),
        },
      ],
    },
    {
      title: () => t('plugins.ambient-mode.settings.group.ambilight'),
      fields: [
        {
          type: 'switch',
          key: 'barDetection',
          label: () => t('plugins.ambient-mode.settings.bar-detection'),
          description: () =>
            t('plugins.ambient-mode.settings.bar-detection-hint'),
        },
        {
          type: 'slider',
          key: 'brightness',
          label: () => t('plugins.ambient-mode.settings.brightness'),
          min: 0,
          max: 200,
          step: 5,
          unit: '%',
        },
        {
          type: 'slider',
          key: 'contrast',
          label: () => t('plugins.ambient-mode.settings.contrast'),
          min: 0,
          max: 200,
          step: 5,
          unit: '%',
        },
        {
          type: 'slider',
          key: 'saturation',
          label: () => t('plugins.ambient-mode.settings.saturation'),
          min: 0,
          max: 200,
          step: 5,
          unit: '%',
        },
        {
          type: 'select',
          key: 'theme',
          label: () => t('plugins.ambient-mode.settings.theme'),
          description: () => t('plugins.ambient-mode.settings.theme-hint'),
          options: ambientThemeOptions.map((option) => ({
            value: option,
            label: () =>
              t(`plugins.ambient-mode.settings.theme-options.${option}`),
          })),
        },
        {
          type: 'slider',
          key: 'dimming',
          label: () => t('plugins.ambient-mode.settings.dimming'),
          description: () => t('plugins.ambient-mode.settings.dimming-hint'),
          min: 0,
          max: 100,
          step: 5,
          unit: '%',
        },
      ],
    },
  ],
  menu,

  renderer: {
    interpolationTime: defaultConfig.interpolationTime,
    buffer: defaultConfig.buffer,
    qualityRatio: defaultConfig.quality,
    size: defaultConfig.size,
    blur: defaultConfig.blur,
    opacity: defaultConfig.opacity,
    isFullscreen: defaultConfig.fullscreen,
    style: defaultConfig.style,
    barDetection: defaultConfig.barDetection,
    brightness: defaultConfig.brightness,
    contrast: defaultConfig.contrast,
    saturation: defaultConfig.saturation,
    theme: defaultConfig.theme,
    dimming: defaultConfig.dimming,

    unregister: null as (() => void) | null,
    update: null as (() => void) | null,
    apply: null as (() => void) | null,
    teardowns: [] as (() => void)[],
    lastMediaType: null as 'video' | 'image' | null,
    lastVideoSource: null as string | null,
    lastImageSource: null as string | null,
    generation: 0,

    async start({ getConfig }) {
      const generation = ++this.generation;
      const config = await getConfig();
      if (generation !== this.generation) return;

      this.interpolationTime = config.interpolationTime;
      this.buffer = config.buffer;
      this.qualityRatio = config.quality;
      this.size = config.size;
      this.blur = config.blur;
      this.opacity = config.opacity;
      this.isFullscreen = config.fullscreen;
      this.style = config.style;
      this.barDetection = config.barDetection;
      this.brightness = config.brightness;
      this.contrast = config.contrast;
      this.saturation = config.saturation;
      this.theme = config.theme;
      this.dimming = config.dimming;
      setExtendSidebar(config.extendSidebar);

      const songImage = document.querySelector<HTMLImageElement>('#song-image');
      const songVideo = document.querySelector<HTMLDivElement>('#song-video');
      const image = songImage?.querySelector<HTMLImageElement>(
        'yt-img-shadow > img',
      );
      const video = await waitForElement<HTMLVideoElement>(
        '.html5-video-container > video',
      );
      if (generation !== this.generation) return;

      const videoWrapper = document.querySelector(
        '#song-video > .player-wrapper',
      );

      const injectBlurImage = () => {
        if (!songImage || !image) return null;

        this.lastImageSource = image.src;

        const blurImage = document.createElement('img');
        blurImage.classList.add('html5-blur-image');
        blurImage.src = image.src;

        this.update = () => {
          if (this.isFullscreen) blurImage.classList.add('fullscreen');
          else blurImage.classList.remove('fullscreen');

          blurImage.style.setProperty('--width', `${this.size}%`);
          blurImage.style.setProperty('--height', `${this.size}%`);
          blurImage.style.setProperty('--blur', `${this.blur}px`);
          blurImage.style.setProperty('--opacity', `${this.opacity}`);
        };
        this.update();

        songImage.prepend(blurImage);

        return () => {
          if (blurImage.isConnected) blurImage.remove();
        };
      };

      const injectAmbientLight = (isVideo: boolean) => {
        const source = isVideo ? video : image;
        if (!source) return null;

        if (isVideo) this.lastVideoSource = video.src;
        else this.lastImageSource = image?.src ?? null;

        const ambient = mountAmbientLight(source, () => ({
          quality: this.qualityRatio,
          fps: this.buffer,
          interpolationTime: this.interpolationTime,
          blur: this.blur,
          opacity: this.opacity,
          barDetection: this.barDetection,
          brightness: this.brightness,
          contrast: this.contrast,
          saturation: this.saturation,
          theme: this.theme,
          dimming: this.dimming,
        }));
        this.update = ambient.refresh;

        return ambient.unregister;
      };

      const injectBlurVideo = () => {
        if (!songVideo || !video || !videoWrapper) return null;

        this.lastVideoSource = video.src;

        const blurCanvas = document.createElement('canvas');
        blurCanvas.classList.add('html5-blur-canvas');

        const context = blurCanvas.getContext('2d');

        let lastEffectWorkId: number | null = null;
        let hasDrawnOnce = false;

        const onSync = () => {
          if (typeof lastEffectWorkId === 'number')
            cancelAnimationFrame(lastEffectWorkId);

          lastEffectWorkId = requestAnimationFrame(() => {
            if (!context) return;

            const width = this.qualityRatio;
            let height = Math.max(
              Math.floor((blurCanvas.height / blurCanvas.width) * width),
              1,
            );
            if (!Number.isFinite(height)) height = width;
            if (!height) return;

            // The canvas is never cleared, so the previous frame's pixels
            // already sit underneath - drawing the new frame at partial
            // alpha over them blends it into a trailing motion blur without
            // any CPU pixel readback. globalAlpha silently ignores values
            // outside [0, 1] (e.g. Infinity when interpolationTime is 0,
            // the "instant" setting) rather than throwing, so clamp
            // explicitly instead of relying on that.
            const frameAlpha =
              this.interpolationTime > 0
                ? (1 / this.buffer) * (1000 / this.interpolationTime)
                : 1;
            context.globalAlpha = hasDrawnOnce ? Math.min(frameAlpha, 1) : 1;
            context.drawImage(video, 0, 0, width, height);
            hasDrawnOnce = true;

            lastEffectWorkId = null;
          });
        };

        this.update = () => {
          const rect = video.getBoundingClientRect();

          const newWidth = Math.floor(video.width || rect.width);
          const newHeight = Math.floor(video.height || rect.height);

          if (newWidth === 0 || newHeight === 0) return;

          blurCanvas.width = this.qualityRatio;
          blurCanvas.height = Math.floor(
            (newHeight / newWidth) * this.qualityRatio,
          );
          hasDrawnOnce = false; // resizing the canvas clears its pixels

          if (this.isFullscreen) blurCanvas.classList.add('fullscreen');
          else blurCanvas.classList.remove('fullscreen');

          blurCanvas.style.setProperty('--width', `${this.size}%`);
          blurCanvas.style.setProperty('--height', `${this.size}%`);
          blurCanvas.style.setProperty('--blur', `${this.blur}px`);
          blurCanvas.style.setProperty('--opacity', `${this.opacity}`);
        };
        this.update();

        let canvasInterval: number | undefined;

        const stopDrawing = () => {
          clearInterval(canvasInterval);
          canvasInterval = undefined;
          if (typeof lastEffectWorkId === 'number') {
            cancelAnimationFrame(lastEffectWorkId);
            lastEffectWorkId = null;
          }
        };
        const startDrawing = () => {
          if (canvasInterval) return;
          canvasInterval = window.setInterval(
            onSync,
            Math.max(1, Math.ceil(1000 / this.buffer)),
          );
        };

        // Media events fire on the <video> element itself, not on the
        // #song-video wrapper div.
        video.addEventListener('pause', stopDrawing);
        video.addEventListener('play', startDrawing);
        video.addEventListener('ended', stopDrawing);

        // Do not draw a frozen frame if injected while already paused.
        if (!video.paused) startDrawing();

        videoWrapper.prepend(blurCanvas);

        return () => {
          stopDrawing();

          video.removeEventListener('pause', stopDrawing);
          video.removeEventListener('play', startDrawing);
          video.removeEventListener('ended', stopDrawing);

          if (blurCanvas.isConnected) blurCanvas.remove();
        };
      };

      const isVideoMode = () => {
        const songVideo = document.querySelector<HTMLDivElement>('#song-video');
        if (!songVideo) {
          this.lastMediaType = 'image';
          return false;
        }

        const isVideo = getComputedStyle(songVideo).display !== 'none';
        this.lastMediaType = isVideo ? 'video' : 'image';
        return isVideo;
      };

      const ytmusicAppLayout = document.querySelector<HTMLElement>('#layout');

      const injectBlurElement = (force?: boolean): boolean | void => {
        const isPageOpen = ytmusicAppLayout?.hasAttribute('player-page-open');
        if (isPageOpen) {
          const isVideo = isVideoMode();
          if (!force) {
            if (
              this.lastMediaType === 'video' &&
              this.lastVideoSource === video?.src
            )
              return false;
            if (
              this.lastMediaType === 'image' &&
              this.lastImageSource === image?.src
            )
              return false;
          }
          this.unregister?.();
          this.unregister =
            (this.style === 'ambilight'
              ? injectAmbientLight(isVideo)
              : isVideo
                ? injectBlurVideo()
                : injectBlurImage()) ?? null;
        } else {
          this.unregister?.();
          this.unregister = null;
        }
      };
      // Re-injecting is what a style switch needs; mode switches reuse it
      // too so config changes and observers share one path.
      this.apply = () => injectBlurElement(true);

      // Replaces the old 1 s ticker: these are the only inputs that change
      // what should be drawn. The layout attribute flips on view switches
      // (e.g. miniplayer), the song containers' style flips between video and
      // image, and a new song changes the artwork's src. Only the roots are
      // watched - never a subtree containing the injected elements - so the
      // styles this plugin writes cannot feed back into the observer.
      this.teardowns = [
        observePlayerPage('#layout', {
          attributes: ['player-page-open'],
          callback: () => injectBlurElement(true),
        }),
        observePlayerPage('#player-page', {
          attributes: ['style'],
          callback: () => injectBlurElement(true),
        }),
        observePlayerPage('#song-video', {
          attributes: ['style'],
          callback: () => injectBlurElement(),
        }),
        observePlayerPage('#song-image yt-img-shadow > img', {
          attributes: ['src'],
          callback: () => injectBlurElement(),
        }),
        // YTM shows and hides the video view by flipping attributes on
        // `#player`, never on `#song-video` itself, so without this watch a
        // start while the video area is still hidden stays on the artwork.
        observePlayerPage('#player', {
          attributes: ['playable', 'playback-mode', 'video-mode'],
          callback: () => injectBlurElement(true),
        }),
      ];

      const onVideoDataChange = (event: Event) => {
        if (
          (event as CustomEvent<VideoDataChanged>).detail?.name === 'dataloaded'
        ) {
          injectBlurElement();
        }
      };
      document.addEventListener('videodatachange', onVideoDataChange);
      this.teardowns.push(() =>
        document.removeEventListener('videodatachange', onVideoDataChange),
      );

      const onVideoSrcChanged = () => injectBlurElement();
      video.addEventListener('peard:src-changed', onVideoSrcChanged);
      this.teardowns.push(() =>
        video.removeEventListener('peard:src-changed', onVideoSrcChanged),
      );

      // The first ticker tick, now immediate.
      injectBlurElement();
    },
    onConfigChange(newConfig) {
      const styleChanged = newConfig.style !== this.style;

      this.interpolationTime = newConfig.interpolationTime;
      this.buffer = newConfig.buffer;
      this.qualityRatio = newConfig.quality;
      this.size = newConfig.size;
      this.blur = newConfig.blur;
      this.opacity = newConfig.opacity;
      this.isFullscreen = newConfig.fullscreen;
      this.style = newConfig.style;
      this.barDetection = newConfig.barDetection;
      this.brightness = newConfig.brightness;
      this.contrast = newConfig.contrast;
      this.saturation = newConfig.saturation;
      this.theme = newConfig.theme;
      this.dimming = newConfig.dimming;
      setExtendSidebar(newConfig.extendSidebar);

      if (styleChanged) this.apply?.();
      else this.update?.();
    },
    stop() {
      this.generation++;
      setExtendSidebar(false);
      this.update = null;
      this.apply = null;
      this.unregister?.();
      this.unregister = null;
      for (const teardown of this.teardowns) teardown();
      this.teardowns = [];
      // Forget what was injected: a re-enable over the same track must inject
      // again instead of being skipped by injectBlurElement's dedupe guard.
      this.lastMediaType = null;
      this.lastVideoSource = null;
      this.lastImageSource = null;
    },
  },
});
