import { t } from '@/i18n';
import { observePlayerPage } from '@/providers/player-page-observer';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { menu } from './menu';
import style from './style.css?inline';
import { type AmbientModePluginConfig } from './types';

import type { VideoDataChanged } from '@/types/video-data-changed';

const defaultConfig: AmbientModePluginConfig = {
  enabled: false,
  quality: 50,
  buffer: 30,
  interpolationTime: 1500,
  blur: 100,
  size: 100,
  opacity: 1,
  fullscreen: false,
  extendSidebar: false,
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
      type: 'slider',
      key: 'interpolationTime',
      label: () => t('plugins.ambient-mode.menu.smoothness-transition.label'),
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
  menu: menu,

  renderer: {
    interpolationTime: defaultConfig.interpolationTime,
    buffer: defaultConfig.buffer,
    qualityRatio: defaultConfig.quality,
    size: defaultConfig.size,
    blur: defaultConfig.blur,
    opacity: defaultConfig.opacity,
    isFullscreen: defaultConfig.fullscreen,

    unregister: null as (() => void) | null,
    update: null as (() => void) | null,
    teardowns: [] as (() => void)[],
    lastMediaType: null as 'video' | 'image' | null,
    lastVideoSource: null as string | null,
    lastImageSource: null as string | null,

    async start({ getConfig }) {
      const config = await getConfig();
      this.interpolationTime = config.interpolationTime;
      this.buffer = config.buffer;
      this.qualityRatio = config.quality;
      this.size = config.size;
      this.blur = config.blur;
      this.opacity = config.opacity;
      this.isFullscreen = config.fullscreen;
      setExtendSidebar(config.extendSidebar);

      const songImage = document.querySelector<HTMLImageElement>('#song-image');
      const songVideo = document.querySelector<HTMLDivElement>('#song-video');
      const image = songImage?.querySelector<HTMLImageElement>(
        'yt-img-shadow > img',
      );
      const video = await waitForElement<HTMLVideoElement>(
        '.html5-video-container > video',
      );

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
            (isVideo ? injectBlurVideo() : injectBlurImage()) ?? null;
        } else {
          this.unregister?.();
          this.unregister = null;
        }
      };

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
      this.interpolationTime = newConfig.interpolationTime;
      this.buffer = newConfig.buffer;
      this.qualityRatio = newConfig.quality;
      this.size = newConfig.size;
      this.blur = newConfig.blur;
      this.opacity = newConfig.opacity;
      this.isFullscreen = newConfig.fullscreen;
      setExtendSidebar(newConfig.extendSidebar);

      this.update?.();
    },
    stop() {
      setExtendSidebar(false);
      this.update = null;
      this.unregister?.();
      this.unregister = null;
      for (const teardown of this.teardowns) teardown();
      this.teardowns = [];
    },
  },
});
