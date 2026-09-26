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

/**
 * How close the synced audio has to sit on the video's clock before it is left
 * alone, in seconds: below this a splice is not heard.
 */
const ALIGNED_WITHIN = 0.002;

/** Seconds a drift is closed over, once the audio runs at its own rate. */
const ALIGN_WINDOW = 0.5;

/** How far the alignment may take the rate: it only ever runs while silent. */
const ALIGN_RATE_LIMIT = 0.05;

/** Milliseconds between alignment checks. */
const ALIGN_INTERVAL = 50;

/**
 * Milliseconds the outgoing track takes to move from the video's audio to its
 * own. Long enough that the two levels cross without a step in the waveform,
 * short enough that the two copies of the track are only both heard for a
 * moment.
 */
const HANDOVER_MS = 100;

/**
 * Video events that can change whether the synced audio should be running.
 * `timeupdate` carries the automatic transition as well, but that listener is
 * armed and released on its own: a pause must not take the crossfade off.
 */
const FOLLOW_EVENTS = [
  'seeking',
  'seeked',
  'playing',
  'waiting',
  'pause',
  'timeupdate',
] as const;

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
     * Video audio graph, as last announced on `peard:audio-can-play`. The
     * announcement can arrive before `onPlayerApiReady` has somewhere to splice
     * it into, so the last one is kept here.
     */
    audioGraph?: Compressor;
    /** `peard:audio-can-play` listener, so `stop` can detach it. */
    onAudioCanPlay?: (event: CustomEvent<Compressor>) => void;
    /** Splices the crossfade's gain node into the announced graph. */
    attachFadeInGain?: (graph: Compressor) => void;
    /** Drops the gain node, the listeners and the audio the plugin holds. */
    teardown?: () => void;
  },
  CrossfadePluginConfig
>({
  name: () => t('plugins.crossfade.name'),
  description: () => t('plugins.crossfade.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    /** Milliseconds the incoming track is faded in over. @default 5000 */
    fadeInDuration: 5000,
    /** Milliseconds the outgoing track is faded out over. @default 5000 */
    fadeOutDuration: 5000,
    /** Seconds before the end of a track that triggers the next one. @default 10 */
    secondsBeforeEnd: 10,
    /**
     * Scaling algorithm for the fade: 'linear', 'equalPower', 'logarithmic' or
     * a positive number of dB.
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

      // A number in dB, and one the fader's scaler accepts: a zero, negative or
      // non-finite dynamic range is not a fade, so the previous setting is kept.
      const decibels = Math.abs(Number(res[3]));
      let fadeScaling: 'linear' | 'logarithmic' | 'equalPower' | number;

      if (
        res[3] === 'linear' ||
        res[3] === 'logarithmic' ||
        res[3] === 'equalPower'
      ) {
        fadeScaling = res[3];
      } else if (Number.isFinite(decibels) && decibels > 0) {
        fadeScaling = decibels;
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

    ipc.handle('audio-bytes', (videoID: string) => getAudioBytes(yt, videoID, window));
  },

  renderer: {
    async start({ ipc, getConfig }) {
      // Registered before the config round trip: this listener is what splices
      // the gain node in, and the renderer announces the graph per track.
      this.onAudioCanPlay = (event) => {
        this.audioGraph = event.detail;
        this.attachFadeInGain?.(event.detail);
      };

      document.addEventListener('peard:audio-can-play', this.onAudioCanPlay, {
        passive: true,
      });

      this.config = await getConfig();
      this.ipc = ipc;
    },
    stop() {
      if (this.onAudioCanPlay) {
        document.removeEventListener(
          'peard:audio-can-play',
          this.onAudioCanPlay,
        );
        this.onAudioCanPlay = undefined;
      }

      this.teardown?.();
      this.teardown = undefined;
      // A session of its own is what splices the graph again, so the old one
      // must not be left reachable through the listener registered above.
      this.attachFadeInGain = undefined;
      this.audioGraph = undefined;
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
    },
    onPlayerApiReady(api) {
      // A second session would leave the listeners and the audio of the first
      // one behind: everything below belongs to this closure, so the old one is
      // torn down before a new one is built.
      this.teardown?.();

      /** Video ID the current audio is playing, once its bytes arrived. */
      let currentID: string | null = null;
      let isAutoTransition = false;
      let navigationGeneration = 0;

      /**
       * Audio of the current track, kept in sync with the video and silent until
       * it takes over.
       */
      let syncedAudio: Howl | null = null;
      /**
       * Gain node in front of the video's audio, so the crossfade owns the
       * incoming track's level: the player keeps rewriting the element's own
       * volume while a track starts, which would flatten a fade on it.
       */
      let fadeInGain: GainNode | null = null;
      /** Fader fading the outgoing track out. */
      let fadeOutFader: VolumeFader | null = null;
      /** Removes the listeners of the track currently synced. */
      let cleanupListeners: (() => void) | null = null;
      /** Takes the splice of `fadeInGain` back out, as the graph was found. */
      let detachFadeInGain: (() => void) | null = null;

      // Crossfade in flight: the incoming video, waiting for the `play` that
      // starts its gain ramp, and the listener that starts it. Held together, so
      // a listener can never outlive the video it was armed on.
      let fadeIn: { video: HTMLVideoElement; onPlay: () => void } | null = null;
      /** Source the gain node is wired to, so it is not rebuilt per announce. */
      let fadeInGainAttachedTo: MediaElementAudioSourceNode | null = null;
      /**
       * Seconds a media element takes to run after it is told to play, as last
       * measured. The video's clock keeps going in the meantime, so the audio has
       * to be started that much ahead of it to end up level with it.
       */
      let startLead = 0;
      /** Stops the alignment running for the track that is synced right now. */
      let stopAligning: (() => void) | null = null;
      /** Context time a handover of the outgoing track runs until. */
      let handoverUntil = 0;

      /** Whether an element's clock is parked, on a pause, a seek or a stall. */
      const isStalled = (element: HTMLMediaElement) =>
        element.paused ||
        element.seeking ||
        element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;

      /** Ramps the incoming track from silence with the graph's gain node. */
      const fadeInTrack = () => {
        if (!fadeInGain) return;

        const { context, gain } = fadeInGain;
        const duration = (this.config?.fadeInDuration ?? 5000) / 1000;
        // Not before the outgoing track has finished moving over into its own
        // audio: the ramp down of the video's audio is part of that handover.
        const start = Math.max(context.currentTime, handoverUntil);

        gain.cancelScheduledValues(start);

        if (duration <= 0) {
          gain.setValueAtTime(1, start);
          return;
        }

        // A curve keeps the fade sample-accurate, with no animation frame loop
        // for the audio thread to follow.
        const points = 64;
        const curve = new Float32Array(points + 1);
        for (let point = 0; point <= points; point += 1) {
          curve[point] = fadeVolumeAt(point / points, this.config?.fadeScaling);
        }

        gain.setValueCurveAtTime(curve, start, duration);
      };

      /**
       * Pulls the audio's clock onto the video's by playing it a hair faster or
       * slower, and hands back the way to stop doing that.
       *
       * The audio is silent until a crossfade hands the track over to it, so
       * whatever rate it takes to close a drift is not heard. A position cannot
       * be written instead: an element that is playing stalls on one and comes
       * back that much further behind.
       */
      const alignAudio = (
        element: HTMLMediaElement,
        video: HTMLVideoElement,
      ) => {
        const tick = () => {
          if (isStalled(video) || isStalled(element)) return;

          const drift = video.currentTime - element.currentTime;

          if (Math.abs(drift) < ALIGNED_WITHIN) {
            if (element.playbackRate !== 1) element.playbackRate = 1;
            return;
          }

          // Playback rate that closes the drift over the next `ALIGN_WINDOW`
          // seconds: a follower behind its clock (a positive drift, in seconds)
          // plays faster to catch up, one ahead of it plays slower to let it
          // pass, and neither takes the rate further than the limit.
          const rate = Math.min(
            Math.max(1 + drift / ALIGN_WINDOW, 1 - ALIGN_RATE_LIMIT),
            1 + ALIGN_RATE_LIMIT,
          );

          if (element.playbackRate !== rate) element.playbackRate = rate;
        };

        const timer = window.setInterval(tick, ALIGN_INTERVAL);

        return () => {
          window.clearInterval(timer);
          element.playbackRate = 1;
        };
      };

      // Drop an in-flight crossfade: its fader keeps writing to the outgoing
      // audio, and its fade-in listener waits on a video that may not play the
      // track it was armed for.
      const cancelTransition = () => {
        // With a fade in armed, the synced audio is the incoming track, sitting
        // at zero gain until the video plays, so it follows the pause. Without
        // one it is left alone: it may be the track about to be faded out.
        const fadeInArmed = fadeIn !== null;

        // Cancelling the fade out runs its callback, which releases the audio.
        fadeOutFader?.cancelFade();
        fadeOutFader = null;

        if (fadeIn) {
          fadeIn.video.removeEventListener('play', fadeIn.onPlay);
          fadeIn = null;
        }

        // An interrupted fade in would leave the track quiet, so hand its level
        // back to the player.
        if (fadeInGain) {
          fadeInGain.gain.cancelScheduledValues(0);
          fadeInGain.gain.value = 1;
        }

        if (syncedAudio && fadeInArmed) {
          elementOf(syncedAudio).pause();
        }
      };

      /** Object URL backing each Howl, so `releaseAudio` can revoke it. */
      const audioURLs = new WeakMap<Howl, string>();

      /** Gain node carrying each Howl's audio in the player's graph. */
      const audioGains = new WeakMap<Howl, GainNode>();

      /**
       * Media element behind a Howl. Howler queues the `play` and `seek` calls
       * made while a sound is still loading, applies the position sampled back
       * then, and restarts a playing element on a seek — none of which the sync
       * below can live with, so the element is driven directly.
       */
      const elementOf = (audio: Howl) => audio._sounds[0]._node;

      /**
       * Hands a track's audio to the player's own audio graph, with a gain node
       * of its own in front of it.
       *
       * Its level then sits on the clock the video's audio runs on, so the two
       * can be handed over to each other by shaping the graph rather than by
       * stepping the element's volume — a step in the waveform is exactly what a
       * seam is heard as.
       */
      const routeAudio = (audio: Howl, context: AudioContext) => {
        if (audioGains.has(audio)) return;

        const gain = context.createGain();
        gain.gain.value = 0;
        gain.connect(context.destination);
        context.createMediaElementSource(elementOf(audio)).connect(gain);

        audioGains.set(audio, gain);
      };

      // A media element cannot play YouTube's own stream URLs, so the backend
      // hands the audio over as bytes (see `getAudioBytes`) and a Blob turns
      // them back into something the element decodes.
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

        // The graph is announced per track, so on the first one of a session it
        // may not be known yet: `attachFadeInGain` routes whatever is synced
        // when it turns up. The audio is silent until a crossfade needs it, so
        // arriving in the graph late costs nothing.
        const context = this.audioGraph?.audioContext;
        if (context) routeAudio(audio, context);

        return audio;
      };

      /** Stops a track once nothing will play it again. */
      const releaseAudio = (audio: Howl) => {
        // Howler only stops an element it started itself, and this one was
        // started here, so it is stopped here as well.
        elementOf(audio).pause();
        audioGains.get(audio)?.disconnect();
        audioGains.delete(audio);
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

      /** Hands the current video over to the audio of `nextID`. */
      const playVideo = (nextID: string) => {
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

        // Read and cleared up front: an auto-transition that never became a
        // crossfade must not turn the next manual skip into one.
        const isAuto = isAutoTransition;
        isAutoTransition = false;

        // Without a video element there is nothing left to sync or fade in, and
        // the previous navigation is already dropped above.
        const video = document.querySelector('video');
        if (!video) return;

        if (syncedAudio) {
          // Only an automatic transition can be crossfaded: the outgoing track
          // has to still be playing while the incoming one fades in.
          if (isAuto && syncedAudio.state() === 'loaded') {
            const outgoing = syncedAudio;
            syncedAudio = null;

            // The outgoing track fades out on its own media element, to a
            // volume of its own: nothing else writes to it.
            //
            // Wall clock time, not the video's: the fade out has to run to
            // completion even if the incoming track stalls.
            const fader = new VolumeFader(elementOf(outgoing), {
              initialVolume: video.volume,
              fadeScaling: this.config?.fadeScaling,
              fadeDuration: this.config?.fadeOutDuration,
            });

            fadeOutFader = fader;

            fader.fadeOut(() => {
              releaseAudio(outgoing);
              if (fadeOutFader === fader) {
                fadeOutFader = null;
              }
            });

            // The incoming track starts from silence, and only ramps once the
            // video plays: the player parks the element while it loads.
            const gain = fadeInGain;
            const outgoingGain = audioGains.get(outgoing);
            const context = outgoingGain?.context;

            if (gain && outgoingGain && context) {
              // The track moves out of the video's audio and into its own over
              // a moment, the two playing it either side of one another: the
              // few ms they are apart are crossed while both are heard, instead
              // of stepping the waveform at the switch.
              const now = context.currentTime;
              const handover = HANDOVER_MS / 1000;
              handoverUntil = now + handover;

              gain.gain.cancelScheduledValues(now);
              gain.gain.setValueAtTime(gain.gain.value, now);
              gain.gain.linearRampToValueAtTime(0, now + handover);

              outgoingGain.gain.cancelScheduledValues(now);
              outgoingGain.gain.setValueAtTime(0, now);
              outgoingGain.gain.linearRampToValueAtTime(1, now + handover);
            } else if (gain) {
              gain.gain.cancelScheduledValues(0);
              gain.gain.value = 0;
            }

            const onPlay = () => {
              video.removeEventListener('play', onPlay);
              fadeIn = null;
              fadeInTrack();
            };

            fadeIn = { video, onPlay };
            video.addEventListener('play', onPlay);
          } else {
            releaseAudio(syncedAudio);
            syncedAudio = null;
          }
        }

        getAudio(nextID)
          .then((bytes) => {
            // A newer navigation started while this audio was downloading, so it
            // no longer belongs to the track being played.
            if (!bytes || generation !== navigationGeneration) return;

            const audio = createAudio(bytes.bytes, bytes.mimeType);
            syncedAudio = audio;

            const element = elementOf(audio);
            /** Whether the audio is between being told to play and running. */
            let starting = false;

            /**
             * Runs the audio with the video: stopped while the video's clock is
             * parked (a pause, a seek, a stall) and started on that clock when
             * it runs again.
             *
             * The position has to be handed over while the element is stopped.
             * One that is playing stops for as long as a position change takes
             * and comes back that much behind, and a position taken any earlier
             * is one the video has already moved past — either way the audio
             * ends up behind the clock it follows, and that offset is what is
             * heard when the crossfade hands the track over to this audio.
             */
            const followVideo = () => {
              if (isStalled(video)) {
                starting = false;
                element.pause();
                return;
              }

              if (!element.paused) return;

              // Measured from a start at the normal rate, and heard at one.
              element.playbackRate = 1;
              element.currentTime = video.currentTime + startLead;
              starting = true;
              element
                .play()
                .catch((error) =>
                  console.error('[crossfade] audio failed to play', error),
                );

              // The audio starting is the other moment a fade in can begin: the
              // video's own `play` may have gone by while it was being fetched,
              // and the armed listener is what takes the fade in off the video.
              fadeIn?.onPlay();
            };

            /**
             * Measures what starting the audio cost the clock it follows, for
             * the next start to carry. The element takes the position it was
             * given, so how far the video has moved on since is the lead.
             */
            const onPlaying = () => {
              if (!starting) return;

              starting = false;

              // Capped, so a measurement taken across a seek in between cannot
              // push the audio most of a track out of the video.
              startLead = Math.min(
                video.currentTime - element.currentTime,
                0.5,
              );
            };

            /**
             * Clicks through to the next track `secondsBeforeEnd` before the
             * end. Armed per track on the video and released with that track's
             * other listeners, not by a cancel: pausing before the end must not
             * cost the track its crossfade.
             */
            const transitionBeforeEnd = () => {
              if (
                video.currentTime >=
                  video.duration - (this.config?.secondsBeforeEnd ?? 10) &&
                syncedAudio?.state() === 'loaded'
              ) {
                isAutoTransition = true;
                video.removeEventListener('timeupdate', transitionBeforeEnd);

                // The audio is about to be the one you hear: it goes back to its
                // own rate before any of it can be heard.
                stopAligning?.();

                document
                  .querySelector<HTMLButtonElement>('.next-button')
                  ?.click();
              }
            };

            for (const type of FOLLOW_EVENTS) {
              video.addEventListener(type, followVideo);
            }
            video.addEventListener('timeupdate', transitionBeforeEnd);
            element.addEventListener('playing', onPlaying);

            stopAligning = alignAudio(element, video);

            cleanupListeners = () => {
              for (const type of FOLLOW_EVENTS) {
                video.removeEventListener(type, followVideo);
              }
              video.removeEventListener('timeupdate', transitionBeforeEnd);
              element.removeEventListener('playing', onPlaying);
              stopAligning?.();
              stopAligning = null;
            };

            followVideo();
          })
          .catch((error) =>
            console.error('[crossfade] audio fetch failed', error),
          );
      };

      // Splice the crossfade's own gain node into the video's audio graph: the
      // player never writes to it, so a fade in survives where an element
      // volume fade does not.
      const attachFadeInGain = ({
        audioContext: context,
        audioSource: source,
      }: Compressor) => {
        // The graph is announced per track, but the source only changes when
        // the player builds a new one. Rebuilding the node on every announce
        // would throw away a fade already scheduled on it.
        if (fadeInGainAttachedTo === source) return;

        // The previous splice has to come out before a new graph goes in, or its
        // edge would keep feeding a gain node nothing writes to.
        detachFadeInGain?.();

        const gain = context.createGain();

        // A track that is about to be faded in has to start from silence. This
        // can run after the crossfade armed its ramp, and a fresh gain node
        // would otherwise open at full volume.
        if (fadeIn) gain.gain.value = 0;

        // Only the renderer's own edge is removed, like the equalizer does it:
        // another plugin splices its chain in the same way, so taking the whole
        // node down would silence it.
        source.disconnect(context.destination);
        source.connect(gain);
        gain.connect(context.destination);

        fadeInGain = gain;
        fadeInGainAttachedTo = source;

        // Undoes this splice in an order where every `disconnect` names an edge
        // that exists: dropping the gain first would leave the source -> gain
        // edge behind and play the track over two paths at once.
        detachFadeInGain = () => {
          source.disconnect(gain);
          gain.disconnect();
          source.connect(context.destination);
        };

        // A track whose audio was fetched before the graph was announced is
        // still playing straight out of its element: move it in, where its level
        // can be shaped without stepping on the waveform. It is silent until a
        // crossfade hands it over, so arriving late costs nothing.
        if (syncedAudio) routeAudio(syncedAudio, context);
      };

      // `start` hands every announcement to this, and covers a graph that was
      // published before the plugin loaded.
      this.attachFadeInGain = attachFadeInGain;

      if (this.audioGraph) attachFadeInGain(this.audioGraph);

      // A song loaded back on startup (restored queue, last played track) never
      // navigates, so the first track comes from the player's data event.
      const onVideoDataChange: Parameters<typeof api.addEventListener>[1] = (
        name,
        videoData,
      ) => {
        if (name !== 'dataloaded') return;

        const nextID = videoData.videoId;
        if (!currentID && nextID) {
          playVideo(nextID);
        }
      };

      // The auto-transition fires before the end of a track, and the outgoing
      // audio is already fading out while the incoming one is still being
      // fetched, so a pause has to be caught for the whole session rather than
      // by the listeners of whichever track happens to be synced.
      const onPause = (event: Event) => {
        const video = event.target;
        if (!(video instanceof HTMLVideoElement) || video.ended) return;

        // The player parks the element on an empty buffer while it loads the
        // next track and reports itself buffering (state 3) there; state 2 is
        // the user stopping playback, which drops the transition mid flight.
        if (api.getPlayerState() === 2) cancelTransition();
      };

      const onNavigate = (event: NavigateEvent) => {
        const nextVideoID = getVideoIDFromURL(event.destination.url ?? '');

        if (!nextVideoID) return;

        // Its audio is already being synced, either from the previous
        // navigation or from the player's data event on startup.
        if (nextVideoID === currentID) return;

        playVideo(nextVideoID);
      };

      api.addEventListener('videodatachange', onVideoDataChange);
      window.navigation.addEventListener('navigate', onNavigate);
      // `pause` does not bubble, so the catch needs the capture phase.
      document.addEventListener('pause', onPause, { capture: true });

      // On unload the crossfade has to leave the graph and the video as it found
      // them, and stop the audio it plays alongside it.
      this.teardown = () => {
        // Drops a fetch still in flight, so it cannot install listeners or
        // audio on a plugin that is already unloaded.
        navigationGeneration += 1;

        api.removeEventListener('videodatachange', onVideoDataChange);
        window.navigation.removeEventListener('navigate', onNavigate);
        document.removeEventListener('pause', onPause, { capture: true });

        cleanupListeners?.();
        cleanupListeners = null;

        // Cancels the fade out as well, which releases the outgoing audio.
        cancelTransition();

        // Whatever is synced is the crossfade's own audio, so it goes too.
        if (syncedAudio) {
          releaseAudio(syncedAudio);
          syncedAudio = null;
        }

        // Put the renderer's own source back on the destination.
        detachFadeInGain?.();
        detachFadeInGain = null;
        fadeInGain = null;
      };
    },
  },
});
