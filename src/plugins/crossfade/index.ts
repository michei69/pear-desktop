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

/**
 * The renderer builds the video's Web Audio graph (`peard:audio-can-play`). Its
 * source is tracked here so the crossfade can put a gain node in front of the
 * video's audio, which the player's own volume handling never touches.
 */
type CrossfadeAudioGraph = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
};

export default createPlugin<
  unknown,
  unknown,
  {
    config?: CrossfadePluginConfig;
    ipc?: RendererContext<CrossfadePluginConfig>['ipc'];
    /** Audio graph the renderer published for the video. */
    audioGraph?: CrossfadeAudioGraph;
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
      console.log('[crossfade] renderer start, listening for the audio graph');

      // The renderer builds the video's audio graph once, while the player API
      // loads, and announces it on every track. Plugins start before that, so
      // listening here is early enough to catch the very first announcement.
      document.addEventListener(
        'peard:audio-can-play',
        (event) => {
          console.log('[crossfade] audio graph published by the renderer');
          this.audioGraph = {
            context: event.detail.audioContext,
            source: event.detail.audioSource,
          };
        },
        { passive: true },
      );
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
      /** Pauses the audio currently synced to the video, if any. */
      let pauseSyncedAudio: (() => void) | null = null;
      /**
       * Gain node in front of the video's audio, so the crossfade owns the
       * incoming track's level. The player keeps rewriting the element's own
       * volume while a track starts, which makes `video.volume` useless for a
       * fade (and is why the element is left untouched here).
       */
      let fadeInGain: GainNode | null = null;
      /** Source the gain node is wired to, so it is not rebuilt per announce. */
      let fadeInGainAttachedTo: MediaElementAudioSourceNode | null = null;

      /**
       * Gain of a fade at the given progress, in the same shapes `VolumeFader`
       * uses for the outgoing track: an equal power fade out is a cosine, so
       * its paired fade in has to be a sine to keep the combined power level.
       * Anything else would make the two halves of a crossfade mismatch.
       */
      const fadeInGainAt = (progress: number) => {
        const scaling = this.config?.fadeScaling;

        if (scaling === 'linear') return progress;

        if (scaling === 'equalPower') {
          return Math.sin((progress * Math.PI) / 2);
        }

        const dynamicRange =
          typeof scaling === 'number' && scaling > 0 ? scaling / 2 / 10 : 3;

        // Special case for zero, matching the fader's scaler: the limited
        // dynamic range would otherwise leave audible silence at 0.001.
        if (progress === 0) return 0;

        return 10 ** ((progress - 1) * dynamicRange);
      };

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
          curve[point] = fadeInGainAt(point / points);
        }

        gain.setValueCurveAtTime(curve, start, duration);
      };

      // Drop an in-flight crossfade: its fader keeps writing to the outgoing
      // audio, which the next track would otherwise inherit.
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
          pauseSyncedAudio?.();
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

        // Claim the track right away: the player still reports it as loading
        // (through `dataloaded`) while its audio is being fetched, and a second
        // pass would cancel the crossfade that is already under way.
        currentID = nextID;

        // The player is currently stalled on an empty buffer: a pause event
        // arriving in that state comes from the stall, not from the user.
        let buffering = false;
        const onBuffering = () => {
          buffering = true;
        };
        const onPlaying = () => {
          buffering = false;
        };

        if (video) {
          video.addEventListener('waiting', onBuffering);
          video.addEventListener('playing', onPlaying);
        }

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

            const outgoingVolume = {
              get volume() {
                return outgoing.volume();
              },
              set volume(v: number) {
                outgoing.volume(v);
              },
            };

            // TEMP DIAGNOSTIC (remove once the fade in works): prints both
            // fades once a second, so a ramp that never runs or that something
            // else overwrites shows up in the console timeline.
            const diagnosticFader = (tag: string) => {
              const started = Date.now();
              let nextSample = 0;

              return (volume: number) => {
                const elapsed = Date.now() - started;

                if (elapsed >= nextSample) {
                  nextSample += 1000;
                  console.warn(
                    `[crossfade:diag] ${tag} fade +${elapsed}ms volume ${volume}`,
                  );
                }
              };
            };

            const probeFadeOut = diagnosticFader('outgoing');

            const volumeWrapper = {
              get volume() {
                return outgoingVolume.volume;
              },
              set volume(v: number) {
                outgoingVolume.volume = v;
                probeFadeOut(v);
              },
            };

            // The fade out is deliberately independent of the video: it plays
            // on its own media element and runs to completion on wall clock
            // time, so a buffer stall on the incoming track cannot stutter it.
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
          console.log('meow', bytes?.bytes.length);
          // A newer navigation started while this audio was downloading, so it
          // no longer belongs to the track being played.
          if (!bytes || generation !== navigationGeneration) return;

          // Without a video to sync against there is nothing to crossfade.
          if (!video) return;

          // The player may have swapped the element while the audio was
          // downloading, which would leave the sync bound to a stale one.
          const current = document.querySelector('video');
          if (current !== video) {
            console.debug('[crossfade] video element swapped during sync');
          }

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

          video.addEventListener('seeking', onSeeking);
          video.addEventListener('play', onPlay);
          video.addEventListener('pause', onPause);
          video.addEventListener('timeupdate', transitionBeforeEnd);

          pauseSyncedAudio = () => audio.pause();

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
      const attachFadeInGain = () => {
        if (!this.audioGraph) {
          console.log('[crossfade] no audio graph published yet');
          return;
        }

        const { context, source } = this.audioGraph;

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

        console.log(
          '[crossfade] fade-in gain node ready, gain',
          gain.gain.value,
        );
      };

      // `start` already caught the graph, or caught it for a later track.
      attachFadeInGain();

      document.addEventListener(
        'peard:audio-can-play',
        () => {
          attachFadeInGain();
        },
        { passive: true },
      );

      // A song loaded back on startup (restored queue, last played track)
      // never navigates, so the very first track has to be picked up from the
      // player's own data event instead.
      api.addEventListener('videodatachange', (name, videoData) => {
        if (name !== 'dataloaded') return;

        const nextID = videoData.videoId;
        if (!currentID && nextID) {
          console.log('[crossfade] syncing restored track', nextID);
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
