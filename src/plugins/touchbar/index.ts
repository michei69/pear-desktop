import { nativeImage, type NativeImage, TouchBar } from 'electron';

import { t } from '@/i18n';
import { appIconPath } from '@/providers/app-icon';
import { getSongControls } from '@/providers/song-controls';
import {
  getImage,
  registerCallback,
  SongInfoEvent,
  type SongInfoCallback,
  unregisterCallback,
} from '@/providers/song-info';
import { Platform } from '@/types/plugins';
import { createPlugin } from '@/utils';

export default createPlugin<
  {
    handler: SongInfoCallback | null;
  },
  unknown,
  unknown
>({
  name: () => t('plugins.touchbar.name'),
  description: () => t('plugins.touchbar.description'),
  restartNeeded: true,
  platform: Platform.macOS,
  config: {
    enabled: false,
  },
  backend: {
    handler: null,
    start({ window }) {
      const {
        TouchBarButton,
        TouchBarLabel,
        TouchBarSpacer,
        TouchBarSegmentedControl,
        TouchBarScrubber,
      } = TouchBar;

      const songTitle = new TouchBarLabel({
        label: '',
      });
      let controls: (() => void)[] = [];

      const songImage: {
        icon?: NativeImage;
      } = {};

      const pausePlayButton = new TouchBarButton({});

      // Order matches the control functions.
      const buttons = new TouchBarSegmentedControl({
        mode: 'buttons',
        segments: [
          new TouchBarButton({
            label: '⏮',
          }),
          pausePlayButton,
          new TouchBarButton({
            label: '⏭',
          }),
          new TouchBarButton({
            label: '👎',
          }),
          new TouchBarButton({
            label: '👍',
          }),
        ],
        change: (i) => controls[i]?.(),
      });

      const touchBar = new TouchBar({
        items: [
          new TouchBarScrubber({
            items: [songImage, songTitle],
            continuous: false,
          }),
          new TouchBarSpacer({
            size: 'flexible',
          }),
          buttons,
        ],
      });

      const { playPause, next, previous, dislike, like } =
        getSongControls(window);

      // The latest song reported to the TouchBar; an artwork decode that lands
      // after a track change must not overwrite the newer icon.
      let currentVideoId: string | undefined;

      controls = [previous, playPause, next, dislike, like];

      const handler: SongInfoCallback = (songInfo, event) => {
        if (event === SongInfoEvent.TimeChanged) return;

        songTitle.label = songInfo.title;

        pausePlayButton.label = songInfo.isPaused ? '▶️' : '⏸';

        currentVideoId = songInfo.videoId;

        const fallbackIcon = () =>
          nativeImage.createFromPath(appIconPath()).resize({ height: 23 });
        const applyIcon = (icon: NativeImage) => {
          if (currentVideoId !== songInfo.videoId) return;

          songImage.icon = icon;
          // The scrubber item was already created; re-set the bar to repaint it.
          window.setTouchBar(touchBar);
        };

        if (songInfo.imageSrc) {
          getImage(songInfo.imageSrc)
            .then((image) =>
              applyIcon(
                image.isEmpty() ? fallbackIcon() : image.resize({ height: 23 }),
              ),
            )
            .catch(() => applyIcon(fallbackIcon()));
        } else {
          songImage.icon = fallbackIcon();
        }

        window.setTouchBar(touchBar);
      };

      this.handler = handler;
      registerCallback(handler);
    },
    stop({ window }) {
      if (this.handler) {
        unregisterCallback(this.handler);
        this.handler = null;
      }
      window.setTouchBar(null);
    },
  },
});
