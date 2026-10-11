import { nativeImage, type NativeImage, TouchBar } from 'electron';

import { t } from '@/i18n';
import { appIconPath } from '@/providers/app-icon';
import { getSongControls } from '@/providers/song-controls';
import { registerCallback, SongInfoEvent } from '@/providers/song-info';
import { Platform } from '@/types/plugins';
import { createPlugin } from '@/utils';

export default createPlugin({
  name: () => t('plugins.touchbar.name'),
  description: () => t('plugins.touchbar.description'),
  restartNeeded: true,
  platform: Platform.macOS,
  config: {
    enabled: false,
  },
  backend({ window }) {
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
      change: (i) => controls[i](),
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

    window.once('ready-to-show', () => {
      controls = [previous, playPause, next, dislike, like];

      registerCallback((songInfo, event) => {
        if (event === SongInfoEvent.TimeChanged) return;
        // Ignore time ticks; anything else is a song info change.

        songTitle.label = songInfo.title;

        pausePlayButton.label = songInfo.isPaused ? '▶️' : '⏸';

        songImage.icon = (
          songInfo.image
            ? songInfo.image
            : nativeImage.createFromPath(appIconPath())
        ).resize({ height: 23 });

        window.setTouchBar(touchBar);
      });
    });
  },
});
