import { createRenderer } from '@/utils';

import {
  createAudio,
  elementOf,
  gainOf,
  releaseAudio,
  routeAudio,
} from './audio';
import {
  FOLLOW_EVENTS,
  HANDOVER_MS,
  MAX_START_LEAD,
  REANCHOR_ABOVE,
} from './constants';
import { fadeCurve } from './fader';
import { alignAudio, isStalled } from './sync';

import type {
  CrossfadePluginConfig,
  CrossfadeRendererProperties,
} from './types';
import type { AudioBytes } from '@/plugins/utils/main';
import type { Howl } from 'howler';

/** Attempts a track's audio is fetched for before giving up. */
const AUDIO_FETCH_ATTEMPTS = 3;

/** Delay between audio fetch attempts, in milliseconds. */
const AUDIO_FETCH_RETRY_MS = 500;

export const renderer = createRenderer<
  CrossfadeRendererProperties,
  CrossfadePluginConfig
>({
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
      document.removeEventListener('peard:audio-can-play', this.onAudioCanPlay);
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
    /** Ends the fade out of the outgoing track, freeing the audio behind it. */
    let stopFadeOut: (() => void) | null = null;
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

      gain.setValueCurveAtTime(
        fadeCurve(this.config?.fadeScaling, 'in'),
        start,
        duration,
      );
    };

    // Drop an in-flight crossfade: its fade out carries on over the outgoing
    // audio, and its fade-in listener waits on a video that may not play the
    // track it was armed for.
    const cancelTransition = () => {
      // With a fade in armed, the synced audio is the incoming track, sitting
      // at zero gain until the video plays, so it follows the pause. Without
      // one it is left alone: it may be the track about to be faded out.
      const fadeInArmed = fadeIn !== null;

      // Cancelling the fade out frees the audio it was fading.
      stopFadeOut?.();
      stopFadeOut = null;

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

    const getAudio = async (videoID: string) => {
      for (let attempt = 1; attempt <= AUDIO_FETCH_ATTEMPTS; attempt += 1) {
        try {
          const bytes = (await this.ipc?.invoke('audio-bytes', videoID)) as
            | AudioBytes
            | undefined;

          return bytes?.bytes?.length ? bytes : undefined;
        } catch {
          console.warn(
            `[crossfade] failed fetching ${videoID}, attempt ${attempt}/${AUDIO_FETCH_ATTEMPTS}`,
          );
        }

        if (attempt < AUDIO_FETCH_ATTEMPTS) {
          await new Promise((resolve) =>
            setTimeout(resolve, AUDIO_FETCH_RETRY_MS),
          );
        }
      }

      return undefined;
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

          const element = elementOf(outgoing);
          const gain = fadeInGain;
          const outgoingGain = gainOf(outgoing);
          const context = outgoingGain?.context;
          const fadeOut = (this.config?.fadeOutDuration ?? 5000) / 1000;
          const handover = HANDOVER_MS / 1000;

          // The audio of the outgoing track is the audio of the video it
          // mirrors, so it plays at the volume the player has set there.
          element.volume = video.volume;

          if (gain && outgoingGain && context) {
            // The track moves out of the video's audio and into its own over a
            // moment, the two playing it either side of one another: the few ms
            // they are apart are crossed while both are heard, instead of
            // stepping the waveform at the switch.
            const now = context.currentTime;
            handoverUntil = now + handover;

            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(0, now + handover);

            outgoingGain.gain.cancelScheduledValues(now);
            outgoingGain.gain.setValueAtTime(0, now);

            // From the moment the track has the audio to itself it fades out on
            // the audio clock, which runs whether the incoming track stalls or
            // the window is being drawn. A fade out of no length is a cut, and
            // the track is never brought in to be cut.
            if (fadeOut > 0) {
              outgoingGain.gain.linearRampToValueAtTime(1, now + handover);
              outgoingGain.gain.setValueCurveAtTime(
                fadeCurve(this.config?.fadeScaling, 'out'),
                now + handover,
                fadeOut,
              );
            }
          } else if (gain) {
            gain.gain.cancelScheduledValues(0);
            gain.gain.value = 0;
          }

          // Whatever level the fade ends at, the audio behind it is freed once
          // it is over, or as soon as a cancel takes it out.
          const timer = window.setTimeout(
            () => {
              if (stopFadeOut === cancelFadeOut) stopFadeOut = null;
              releaseAudio(outgoing);
            },
            (handover + fadeOut) * 1000,
          );

          const cancelFadeOut = () => {
            window.clearTimeout(timer);

            // Cut, rather than left wherever the curve had reached: the audio
            // behind it is freed in the same breath, and a curve cancelled
            // mid-run may hold the level it had before it started.
            if (outgoingGain) {
              outgoingGain.gain.cancelScheduledValues(
                outgoingGain.context.currentTime,
              );
              outgoingGain.gain.value = 0;
            }

            releaseAudio(outgoing);
          };

          stopFadeOut = cancelFadeOut;

          // The incoming track starts from silence, and only ramps once the
          // video plays: the player parks the element while it loads.
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

          const audio = createAudio(
            bytes.bytes,
            bytes.mimeType,
            this.audioGraph?.audioContext,
          );
          syncedAudio = audio;

          const element = elementOf(audio);
          /** Whether the audio is between being told to play and running. */
          let starting = false;

          /**
           * Starts the audio on the video's clock from where it stands.
           *
           * The position is only handed over while the element is stopped: a
           * position change on a playing element takes time it comes back
           * behind by, and one taken any earlier is one the video has already
           * moved past. What the start itself costs the clock is carried by the
           * lead the last start measured.
           */
          const startAudio = () => {
            element.pause();
            // Measured from a start at the normal rate, and heard at one.
            element.playbackRate = 1;
            element.currentTime = video.currentTime + startLead;
            starting = true;
            element
              .play()
              .catch((error) =>
                console.error('[crossfade] audio failed to play', error),
              );
          };

          /**
           * Runs the audio with the video: stopped while the video's clock is
           * parked (a pause, a seek, a stall) and started on that clock when it
           * runs again.
           */
          const followVideo = () => {
            if (isStalled(video)) {
              starting = false;
              element.pause();
              return;
            }

            if (!element.paused) return;

            startAudio();

            // The audio starting is the other moment a fade in can begin: the
            // video's own `play` may have gone by while it was being fetched,
            // and the armed listener is what takes the fade in off the video.
            fadeIn?.onPlay();
          };

          /**
           * Measures what starting the audio cost the clock it follows, for the
           * next start to carry. The element was handed a position `startLead`
           * ahead, so the offset it comes up with is the cost of the start less
           * that lead.
           */
          const onPlaying = () => {
            if (!starting) return;

            starting = false;

            const lead = video.currentTime - element.currentTime + startLead;

            // Anything else was measured across a seek, not a start.
            if (lead >= 0 && lead <= MAX_START_LEAD) startLead = lead;
          };

          /**
           * Clicks through to the next track `secondsBeforeEnd` before the end.
           * Armed per track on the video and released with that track's other
           * listeners, not by a cancel: pausing before the end must not cost
           * the track its crossfade.
           */
          const transitionBeforeEnd = () => {
            if (
              video.currentTime >=
                video.duration - (this.config?.secondsBeforeEnd ?? 10) &&
              syncedAudio?.state() === 'loaded'
            ) {
              isAutoTransition = true;
              video.removeEventListener('timeupdate', transitionBeforeEnd);

              // The crossfade is a moment away from handing this track over to
              // the audio, and a drift this far out — a seek into the last
              // seconds of the track — is one the alignment will not have run
              // out by then. The audio is started on the clock again here,
              // where it is still silent.
              if (
                Math.abs(video.currentTime - element.currentTime) >
                REANCHOR_ABOVE
              ) {
                startAudio();
              }

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

          stopAligning = alignAudio(element, video, startAudio);

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
    // player never writes to it, so a fade in survives where an element volume
    // fade does not.
    const attachFadeInGain = ({
      audioContext: context,
      audioSource: source,
    }: Compressor) => {
      // The graph is announced per track, but the source only changes when the
      // player builds a new one. Rebuilding the node on every announce would
      // throw away a fade already scheduled on it.
      if (fadeInGainAttachedTo === source) return;

      // The previous splice has to come out before a new graph goes in, or its
      // edge would keep feeding a gain node nothing writes to.
      detachFadeInGain?.();

      const gain = context.createGain();

      // A track that is about to be faded in has to start from silence. This
      // can run after the crossfade armed its ramp, and a fresh gain node would
      // otherwise open at full volume.
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

      // A track whose audio was fetched before the graph was announced is still
      // playing straight out of its element: move it in, where its level can be
      // shaped without stepping on the waveform.
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
});
