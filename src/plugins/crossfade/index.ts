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

import { fadeVolumeAt, VolumeFader } from './fader';

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
    /**
     * The renderer publishes the video's audio graph as `Compressor`
     * (`peard:audio-can-play`); the crossfade splices a gain node into it.
     */
    audioGraph?: Compressor;
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
        // A number in dB, and one the fader's scaler accepts: a zero or negative
        // dynamic range is not a fade.
        fadeScaling = Math.abs(Number(res[3]));
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
      // The graph itself is picked up in `attachFadeInGain`, which the plugin
      // registers once the player API is ready.
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

      // Crossfade currently in flight: the outgoing audio, the fader fading it
      // and the gain ramp waiting on the video's next play.
      let fadingAudio: Howl | null = null;
      let fadeOutFader: VolumeFader | null = null;
      let fadeInVideo: HTMLVideoElement | null = null;
      let fadeInOnPlay: (() => void) | null = null;
      /**
       * Gain node in front of the video's audio, so the crossfade owns the
       * incoming track's level. The player keeps rewriting the element's own
       * volume while a track starts, which makes `video.volume` useless for a
       * fade (and is why the element is left untouched here).
       */
      let fadeInGain: GainNode | null = null;
      /** Source the gain node is wired to, so it is not rebuilt per announce. */
      let fadeInGainAttachedTo: MediaElementAudioSourceNode | null = null;

      /** Ramps the incoming track from silence with the graph's gain node. */
      const fadeInTrack = () => {
        if (!fadeInGain) return;

        const { context, gain } = fadeInGain;
        const duration = (this.config?.fadeInDuration ?? 5000) / 1000;
        const start = context.currentTime;

        gain.cancelScheduledValues(start);

        if (duration <= 0) {
          gain.setValueAtTime(1, start);
          return;
        }

        // A curve keeps the fade in sample-accurate, and keeps it out of an
        // animation frame loop that the audio thread would have to follow.
        const points = 64;
        const curve = new Float32Array(points + 1);
        for (let point = 0; point <= points; point += 1) {
          curve[point] = fadeVolumeAt(point / points, this.config?.fadeScaling);
        }

        gain.setValueCurveAtTime(curve, start, duration);
      };

      // Drop an in-flight crossfade: its fader keeps writing to the outgoing
      // audio, and its fade-in listener waits on a video that may not play the
      // track it was armed for.
      const cancelTransition = () => {
        // The incoming audio waits at zero gain for the video to play, so it
        // pauses along with it without ever being heard out of place. The
        // already audible track is left alone: only the player pauses its video.
        const audioIsMuted = fadeInVideo !== null;

        // The auto-transition belongs to the track it was armed for: left on the
        // reused element it would cut the next track short as well.
        document
          .querySelector('video')
          ?.removeEventListener('timeupdate', transitionBeforeEnd);

        fadeOutFader?.cancelFade();
        fadeOutFader = null;

        if (fadeInVideo && fadeInOnPlay) {
          fadeInVideo.removeEventListener('play', fadeInOnPlay);
        }
        fadeInVideo = null;
        fadeInOnPlay = null;

        // An interrupted fade in would leave the track quiet, so hand its level
        // back to the player. Switching tracks mid ramp just cuts it short.
        if (fadeInGain) {
          fadeInGain.gain.cancelScheduledValues(0);
          fadeInGain.gain.value = 1;
        }

        if (syncedAudio && audioIsMuted) {
          syncedAudio.pause();
        }

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

        // Claim the track right away: the player still reports it as loading
        // (through `dataloaded`) while its audio is being fetched, and a second
        // pass would cancel the crossfade that is already under way.
        currentID = nextID;

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

            // The outgoing track fades out on its own media element, to a
            // volume of its own: nothing else writes to it.
            const volumeWrapper = {
              get volume() {
                return outgoing.volume();
              },
              set volume(v: number) {
                outgoing.volume(v);
              },
            };

            // The fade out is deliberately independent of the video: it plays
            // on its own media element and runs to completion on wall clock
            // time, so a buffer stall on the incoming track cannot stutter it.
            const fadeOutFader = new VolumeFader(volumeWrapper, {
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
              // The gain node sits in front of the video's audio, so this fade
              // is ours alone: the player keeps rewriting the element's volume
              // while it starts a track, which would flatten an element fade.
              fadeInGain?.gain.cancelScheduledValues(0);
              if (fadeInGain) fadeInGain.gain.value = 0;

              const onPlay = () => {
                video.removeEventListener('play', onPlay);
                fadeInVideo = null;
                fadeInOnPlay = null;
                fadeInTrack();
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
          // A newer navigation started while this audio was downloading, so it
          // no longer belongs to the track being played.
          if (!bytes || generation !== navigationGeneration) return;

          // Without a video to sync against there is nothing to crossfade.
          if (!video) return;

          // The player is currently stalled on an empty buffer: a pause event
          // arriving in that state comes from the stall, not from the user.
          let buffering = false;
          const onBuffering = () => {
            buffering = true;
          };
          const onPlaying = () => {
            buffering = false;
          };

          const audio = createAudio(bytes.bytes, bytes.mimeType);
          syncedAudio = audio;

          const onSeeking = () => audio.seek(video.currentTime);
          const onPlay = () => {
            audio.play();
            audio.seek(video.currentTime);

            // A fade in that was cancelled while the video stalled resumes here.
            if (fadeInVideo === video) {
              fadeInTrack();
            }
          };
          // A pause stops the track for real (a buffer stall never changes
          // `paused`), so it drops the whole transition mid flight. A track
          // running out is a transition of its own, not a cancel.
          const onPause = () => {
            if (video.paused && !video.ended && !buffering) cancelTransition();
          };

          video.addEventListener('waiting', onBuffering);
          video.addEventListener('playing', onPlaying);
          video.addEventListener('seeking', onSeeking);
          video.addEventListener('play', onPlay);
          video.addEventListener('pause', onPause);
          video.addEventListener('timeupdate', transitionBeforeEnd);

          cleanupListeners = () => {
            video.removeEventListener('waiting', onBuffering);
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('seeking', onSeeking);
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('timeupdate', transitionBeforeEnd);
          };

          if (!video.paused) {
            audio.play();
            audio.seek(video.currentTime);
          }
        });
      };

      // The renderer routes the video's audio through a gain-capable graph.
      // Insert the crossfade's own gain node there: the player never writes to
      // it, so the fade in survives where an element volume fade does not.
      const attachFadeInGain = ({
        audioContext: context,
        audioSource: source,
      }: Compressor) => {
        // The renderer announces the graph on every track, but the source only
        // changes when the player builds a new one. Rebuilding the node on each
        // announcement would throw away a fade that is already scheduled on it.
        if (fadeInGainAttachedTo === source) return;

        const gain = context.createGain();

        // A track that is about to be faded in has to start from silence. This
        // can run after the crossfade armed its ramp, and a fresh gain node
        // would otherwise open at full volume.
        if (fadeInVideo) gain.gain.value = 0;

        source.disconnect();
        source.connect(gain);
        gain.connect(context.destination);

        fadeInGain?.disconnect();
        fadeInGain = gain;
        fadeInGainAttachedTo = source;
      };

      const onAudioCanPlay = (event: CustomEvent<Compressor>) => {
        // Kept so a plugin re-enable, which starts listening after the current
        // track was announced, can still attach to its graph.
        this.audioGraph = event.detail;
        attachFadeInGain(event.detail);
      };

      // A graph caught before this plugin (re)loaded, for a track already playing.
      if (this.audioGraph) attachFadeInGain(this.audioGraph);

      document.addEventListener('peard:audio-can-play', onAudioCanPlay, {
        passive: true,
      });

      // A song loaded back on startup (restored queue, last played track)
      // never navigates, so the very first track has to be picked up from the
      // player's own data event instead.
      api.addEventListener('videodatachange', (name, videoData) => {
        if (name !== 'dataloaded') return;

        const nextID = videoData.videoId;
        if (!currentID && nextID) {
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
