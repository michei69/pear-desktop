import prompt from 'custom-electron-prompt';
import { Howl } from 'howler';

import { t } from '@/i18n';
import {
  getAudioBytes,
  getInnertubeSession,
  type AudioBytes,
} from '@/plugins/utils/main';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';

import { VolumeFader } from './fader';

import type { RendererContext } from '@/types/contexts';
import type { BrowserWindow } from 'electron';

export type CrossfadePluginConfig = {
  enabled: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
  secondsBeforeEnd: number;
  fadeScaling: 'linear' | 'logarithmic' | 'equalPower' | number;
};

export default createPlugin<
  unknown,
  unknown,
  {
    config?: CrossfadePluginConfig;
    ipc?: RendererContext<CrossfadePluginConfig>['ipc'];
  },
  CrossfadePluginConfig
>({
  name: () => t('plugins.crossfade.name'),
  description: () => t('plugins.crossfade.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    /**
     * The duration of the fade in and fade out in milliseconds.
     *
     * @default 5000ms
     */
    fadeInDuration: 5000,
    /**
     * The duration of the fade in and fade out in milliseconds.
     *
     * @default 5000ms
     */
    fadeOutDuration: 5000,
    /**
     * The duration of the fade in and fade out in seconds.
     *
     * @default 10s
     */
    secondsBeforeEnd: 10,
    /**
     * The scaling algorithm to use for the fade.
     * (or a positive number in dB)
     *
     * @default 'equalPower'
     */
    fadeScaling: 'equalPower',
  },
  menu({ window, getConfig, setConfig }) {
    const promptCrossfadeValues = async (
      win: BrowserWindow,
      options: CrossfadePluginConfig,
    ): Promise<Omit<CrossfadePluginConfig, 'enabled'> | undefined> => {
      const res = await prompt(
        {
          title: t('plugins.crossfade.prompt.options'),
          type: 'multiInput',
          multiInputOptions: [
            {
              label: t(
                'plugins.crossfade.prompt.options.multi-input.fade-in-duration',
              ),
              value: options.fadeInDuration,
              inputAttrs: {
                type: 'number',
                required: true,
                min: '0',
                step: '100',
              },
            },
            {
              label: t(
                'plugins.crossfade.prompt.options.multi-input.fade-out-duration',
              ),
              value: options.fadeOutDuration,
              inputAttrs: {
                type: 'number',
                required: true,
                min: '0',
                step: '100',
              },
            },
            {
              label: t(
                'plugins.crossfade.prompt.options.multi-input.seconds-before-end',
              ),
              value: options.secondsBeforeEnd,
              inputAttrs: {
                type: 'number',
                required: true,
                min: '0',
              },
            },
            {
              label: t(
                'plugins.crossfade.prompt.options.multi-input.fade-scaling.label',
              ),
              selectOptions: {
                linear: t(
                  'plugins.crossfade.prompt.options.multi-input.fade-scaling.linear',
                ),
                logarithmic: t(
                  'plugins.crossfade.prompt.options.multi-input.fade-scaling.logarithmic',
                ),
                equalPower: t(
                  'plugins.crossfade.prompt.options.multi-input.fade-scaling.equal-power',
                ),
              },
              value: options.fadeScaling,
            },
          ],
          resizable: true,
          height: 360,
          ...promptOptions(),
        },
        win,
      ).catch(console.error);

      if (!res) {
        return undefined;
      }

      let fadeScaling: 'linear' | 'logarithmic' | 'equalPower' | number;
      if (
        res[3] === 'linear' ||
        res[3] === 'logarithmic' ||
        res[3] === 'equalPower'
      ) {
        fadeScaling = res[3];
      } else if (isFinite(Number(res[3]))) {
        fadeScaling = Number(res[3]);
      } else {
        fadeScaling = options.fadeScaling;
      }

      return {
        fadeInDuration: Number(res[0]),
        fadeOutDuration: Number(res[1]),
        secondsBeforeEnd: Number(res[2]),
        fadeScaling,
      };
    };

    return [
      {
        label: t('plugins.crossfade.menu.advanced'),
        async click() {
          const newOptions = await promptCrossfadeValues(
            window,
            await getConfig(),
          );
          if (newOptions) {
            setConfig(newOptions);
          }
        },
      },
    ];
  },

  async backend({ window, ipc }) {
    const yt = await getInnertubeSession(window);

    ipc.handle('audio-bytes', (videoID: string) => getAudioBytes(yt, videoID));
  },

  renderer: {
    async start({ ipc, getConfig }) {
      this.config = await getConfig();
      this.ipc = ipc;
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
    },
    onPlayerApiReady(api) {
      let syncedAudio: Howl | null = null;
      /** Video ID the current audio is playing, once its bytes arrived. */
      let currentID: string | null = null;
      let isAutoTransition = false;
      let cleanupListeners: (() => void) | null = null;
      let navigationGeneration = 0;

      // Crossfade currently in flight: the outgoing audio, the faders fading the
      // two tracks and the fade-in listener waiting on the video's next play.
      let fadingAudio: Howl | null = null;
      let fadeOutFader: VolumeFader | null = null;
      let fadeInFader: VolumeFader | null = null;
      let fadeInVideo: HTMLVideoElement | null = null;
      let fadeInOnPlay: (() => void) | null = null;
      let fadeInTargetVolume = 1;

      // Drop an in-flight crossfade: its faders keep writing to the <video>
      // element, which the next track reuses.
      const cancelTransition = () => {
        fadeOutFader?.cancelFade();
        fadeInFader?.cancelFade();
        fadeOutFader = null;
        fadeInFader = null;

        if (fadeInVideo) {
          if (fadeInOnPlay) {
            fadeInVideo.removeEventListener('play', fadeInOnPlay);
          }

          // An interrupted fade in leaves the track at a partial volume, so put
          // it back where it was fading to.
          fadeInVideo.volume = fadeInTargetVolume;
        }
        fadeInVideo = null;
        fadeInOnPlay = null;

        if (fadingAudio) {
          releaseAudio(fadingAudio);
          fadingAudio = null;
        }
      };

      // A track's audio, fetched by the backend as a Blob the media element can
      // actually decode. YouTube's own stream URLs are UMP-wrapped and the CDN
      // stops serving them to a page after the first one, so the bytes have to
      // come from the backend (the same path the downloader uses).
      /** Object URL backing each Howl, revoked when the Howl is unloaded. */
      const audioURLs = new WeakMap<Howl, string>();

      const createAudio = (
        bytes: Uint8Array<ArrayBuffer>,
        mimeType: string,
      ) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        const audio = new Howl({
          src: url,
          html5: true,
          volume: 0,
          format: /webm/i.test(mimeType) ? 'webm' : 'mp4',
          onloaderror: (_id, error) =>
            console.error('[crossfade] stream failed to load', error),
        });

        audioURLs.set(audio, url);
        return audio;
      };

      /** Stops a track once nothing will play it again. */
      const releaseAudio = (audio: Howl) => {
        audio.unload();
        const url = audioURLs.get(audio);
        if (url) {
          URL.revokeObjectURL(url);
          audioURLs.delete(audio);
        }
      };

      const getAudio = async (videoID: string) => {
        const bytes = (await this.ipc?.invoke('audio-bytes', videoID)) as
          | AudioBytes
          | undefined;

        return bytes?.bytes?.length ? bytes : undefined;
      };

      const getVideoIDFromURL = (url: string) =>
        new URLSearchParams(url.split('?')?.at(-1)).get('v');

      const transitionBeforeEnd = () => {
        const video = document.querySelector('video');
        if (!video) return;

        console.warn('bafjbia', syncedAudio?.state());
        if (
          video.currentTime >=
            video.duration - (this.config?.secondsBeforeEnd ?? 10) &&
          syncedAudio &&
          syncedAudio.state() === 'loaded'
        ) {
          isAutoTransition = true;
          video.removeEventListener('timeupdate', transitionBeforeEnd);
          document.querySelector<HTMLButtonElement>('.next-button')?.click();
        }
      };

      /** Hands the current video over to the audio of `nextID`. */
      const playVideo = (nextID: string) => {
        const video = document.querySelector('video');
        const generation = ++navigationGeneration;

        if (cleanupListeners) {
          cleanupListeners();
          cleanupListeners = null;
        }

        // Nothing from the previous navigation may keep touching the video
        // element or the audio it was playing.
        cancelTransition();

        if (syncedAudio) {
          // Only an automatic transition can be crossfaded: the outgoing track
          // has to still be playing while the incoming one fades in.
          if (isAutoTransition && syncedAudio.state() === 'loaded') {
            isAutoTransition = false;

            const outgoing = syncedAudio;
            syncedAudio = null;
            fadingAudio = outgoing;

            const targetVolume = video ? video.volume : 1;
            if (video) video.volume = 0;

            const volumeWrapper = {
              get volume() {
                return outgoing.volume();
              },
              set volume(v: number) {
                outgoing.volume(v);
              },
            };

            fadeOutFader = new VolumeFader(volumeWrapper, {
              initialVolume: targetVolume,
              fadeScaling: this.config?.fadeScaling,
              fadeDuration: this.config?.fadeOutDuration,
            });

            fadeOutFader.fadeOut(() => {
              releaseAudio(outgoing);
              if (fadingAudio === outgoing) {
                fadingAudio = null;
              }
            });

            if (video) {
              fadeInTargetVolume = targetVolume;
              fadeInFader = new VolumeFader(video, {
                initialVolume: 0,
                fadeScaling: this.config?.fadeScaling,
                fadeDuration: this.config?.fadeInDuration,
              });

              const onPlay = () => {
                video.removeEventListener('play', onPlay);
                fadeInVideo = null;
                fadeInOnPlay = null;
                fadeInFader?.fadeTo(targetVolume);
              };

              fadeInVideo = video;
              fadeInOnPlay = onPlay;
              video.addEventListener('play', onPlay);
            }
          } else {
            releaseAudio(syncedAudio);
            syncedAudio = null;
          }
        }

        getAudio(nextID).then((bytes) => {
          console.log('meow', bytes?.bytes.length);
          // A newer navigation started while this audio was downloading, so it
          // no longer belongs to the track being played.
          if (!bytes || generation !== navigationGeneration) return;

          // Without a video to sync against there is nothing to crossfade.
          if (!video) return;

          currentID = nextID;

          const audio = createAudio(bytes.bytes, bytes.mimeType);
          syncedAudio = audio;

          const onSeeking = () => audio.seek(video.currentTime);
          const onPause = () => audio.pause();
          const onPlay = () => {
            audio.play();
            audio.seek(video.currentTime);
          };

          video.addEventListener('seeking', onSeeking);
          video.addEventListener('pause', onPause);
          video.addEventListener('play', onPlay);
          video.addEventListener('timeupdate', transitionBeforeEnd);

          cleanupListeners = () => {
            video.removeEventListener('seeking', onSeeking);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('play', onPlay);
            video.removeEventListener('timeupdate', transitionBeforeEnd);
            cancelTransition();
          };

          if (!video.paused) {
            audio.play();
            audio.seek(video.currentTime);
          }
        });
      };

      // A song loaded back on startup (restored queue, last played track)
      // never navigates, so the very first track has to be picked up from the
      // player's own data event instead.
      api.addEventListener('videodatachange', (name, videoData) => {
        if (name !== 'dataloaded') return;

        const nextID = videoData.videoId;
        if (!currentID && nextID) {
          console.debug('[crossfade] syncing restored track', nextID);
          playVideo(nextID);
        }
      });

      window.navigation.addEventListener('navigate', (event) => {
        const nextVideoID = getVideoIDFromURL(event.destination.url ?? '');

        if (!nextVideoID) return;

        // Its audio is already being synced, either from the previous
        // navigation or from the player's data event when the track was loaded
        // back on startup.
        if (nextVideoID === currentID) return;

        playVideo(nextVideoID);
      });
    },
  },
});
