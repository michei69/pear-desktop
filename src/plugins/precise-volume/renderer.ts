import { debounce } from '@/providers/decorators';

import { type PreciseVolumePluginConfig } from './index';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

function $<E extends Element = Element>(selector: string) {
  return document.querySelector<E>(selector);
}

let api: MusicPlayer;

/**
 * Every listener, observer and DOM node `onPlayerApiReady` installs registers
 * its undo here, so `onUnload` can take the renderer half down live.
 */
const teardownHandlers: (() => void)[] = [];

const registerTeardown = (handler: () => void) => {
  teardownHandlers.push(handler);
};

// Probe marker for song-controls.ts: routing on config would drop commands sent too early.
const markReceiverReady = () => {
  document.documentElement.dataset.preciseVolumeReceiver = '1';
};

const clearReceiverReady = () => {
  delete document.documentElement.dataset.preciseVolumeReceiver;
};

const teardown = () => {
  for (const handler of teardownHandlers.splice(0)) {
    handler();
  }
  clearReceiverReady();
};

type YtMusicAppElement = HTMLElement & {
  dispatch?: (action: { type: string; payload?: unknown }) => void;
};

/**
 * YTM's own volume slider reads the app's redux state, which `player.setVolume`
 * does not update. Dispatching the action the API server uses keeps the bar in
 * step with the effective volume.
 */
const syncPlayerBarVolume = (volume: number) => {
  const app = $<YtMusicAppElement>('ytmusic-app');
  app?.dispatch?.({ type: 'SET_VOLUME', payload: volume });
};

export const moveVolumeHud = debounce((showVideo: boolean) => {
  const volumeHud = $<HTMLElement>('#volumeHud');
  if (!volumeHud) {
    return;
  }

  volumeHud.style.top = showVideo
    ? `${($('ytmusic-player')!.clientHeight - $('video')!.clientHeight) / 2}px`
    : '0';
}, 250);

let options: PreciseVolumePluginConfig;

const newSliderSelector =
  'ytmusic-miniplayer .ytMusicMiniPlayerVolumePopup input[type="range"]';

/**
 * Script that applies the saved volume as soon as the player exists.
 * Injected from the preload: YTM can start playing at its default (full)
 * volume well before the renderer plugins and onPlayerApiReady are loaded.
 * `setVolume` alone leaves the player bar's slider on its startup value, so the
 * same `SET_VOLUME` action the API server dispatches is sent too.
 */
export const restoreVolumeScript = (volume: number) => `(() => {
  const apply = () => {
    const player = document.querySelector('#movie_player');
    if (typeof player?.setVolume !== 'function') return false;
    player.setVolume(${volume});
    document.querySelector('ytmusic-app')?.dispatch?.({ type: 'SET_VOLUME', payload: ${volume} });
    return true;
  };
  if (apply()) return;
  const finish = () => {
    if (!apply()) return;
    observer.disconnect();
    document.removeEventListener('play', finish, true);
  };
  // MutationObserver instead of polling: timers can be throttled during startup
  const observer = new MutationObserver(finish);
  observer.observe(document, { childList: true, subtree: true });
  // In case the player API shows up without a later DOM mutation:
  // apply when playback starts at the latest (media events don't bubble, so capture)
  document.addEventListener('play', finish, true);
})(); 0`;

let onNewSliderChange: ((event: Event) => void) | undefined;

/** Remove the new UI's slider listener (plugin disabled or re-initialized) */
export const removeNewSliderListener = () => {
  if (!onNewSliderChange) return;
  document.removeEventListener('change', onNewSliderChange, true);
  onNewSliderChange = undefined;
};

export const onPlayerApiReady = async (
  playerApi: MusicPlayer,
  context: RendererContext<PreciseVolumePluginConfig>,
) => {
  // The hook can run again without an unload between (a repeated enable), so
  // start from a clean slate instead of stacking duplicate listeners.
  teardown();

  options = await context.getConfig();
  api = playerApi;

  // Without this, changing the volume by 20 rewrites the config 20 times
  const writeOptions = debounce(() => {
    context.setConfig(options);
  }, 1000);

  const hideVolumeHud = debounce((volumeHud: HTMLElement) => {
    volumeHud.style.opacity = '0';
  }, 2000);

  const hideVolumeSlider = debounce((slider: HTMLElement) => {
    slider.classList.remove('on-hover');
  }, 2500);

  /** Restore the saved volume and set up the tooltip */
  async function firstRun() {
    if (typeof options.savedVolume === 'number') {
      setTooltip(options.savedVolume);

      if (api.getVolume() !== options.savedVolume) {
        setVolume(options.savedVolume);
      } else {
        // The preload restored the volume before YTM built its UI: the audio is
        // correct, but the player bar still shows the startup volume.
        syncPlayerBarVolume(options.savedVolume);
        updateVolumeSlider();
      }
    }

    setupPlaybar();

    setupLocalArrowShortcuts();

    // HACK: computedStyleMap().get(string) returns CSSKeywordValue instead of CSSStyleValue
    const noVid =
      ($('#main-panel')?.computedStyleMap().get('display') as CSSKeywordValue)
        ?.value === 'none';
    injectVolumeHud(noVid);
    if (!noVid) {
      setupVideoPlayerOnwheel();
      if (!(await window.mainConfig.plugins.isEnabled('video-toggle'))) {
        // Video-toggle handles hud positioning on its own
        const videoMode = () =>
          api.getPlayerResponse().videoDetails?.musicVideoType !==
          'MUSIC_VIDEO_TYPE_ATV';
        const video = $<HTMLVideoElement>('video');
        const onVideoSrcChanged = () => moveVolumeHud(videoMode());
        if (video) {
          video.addEventListener('peard:src-changed', onVideoSrcChanged);
          registerTeardown(() => {
            video.removeEventListener('peard:src-changed', onVideoSrcChanged);
          });
        }
      }
    }
  }

  function injectVolumeHud(noVid: boolean) {
    if (noVid) {
      const position = 'top: 18px; right: 60px;';
      const mainStyle = 'font-size: xx-large;';

      $('.center-content.ytmusic-nav-bar')?.insertAdjacentHTML(
        'beforeend',
        `<span id="volumeHud" style="${position + mainStyle}"></span>`,
      );
    } else {
      const position = 'top: 10px; left: 10px;';
      const mainStyle =
        'font-size: xxx-large; webkit-text-stroke: 1px black; font-weight: 600;';

      $('#song-video')?.insertAdjacentHTML(
        'afterend',
        `<span id="volumeHud" style="${position + mainStyle}"></span>`,
      );
    }

    registerTeardown(() => {
      $<HTMLElement>('#volumeHud')?.remove();
    });
  }

  function showVolumeHud(volume: number) {
    const volumeHud = $<HTMLElement>('#volumeHud');
    if (!volumeHud) {
      return;
    }

    volumeHud.textContent = `${volume}%`;
    volumeHud.style.opacity = '1';

    hideVolumeHud(volumeHud);
  }

  /** Add the onwheel event to the video player */
  function setupVideoPlayerOnwheel() {
    const panel = $<HTMLElement>('#main-panel');
    if (!panel) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Event.deltaY < 0 means wheel-up
      changeVolume(event.deltaY < 0);
    };
    panel.addEventListener('wheel', onWheel);
    registerTeardown(() => {
      panel.removeEventListener('wheel', onWheel);
    });
  }

  function saveVolume(volume: number) {
    options.savedVolume = volume;
    writeOptions();
  }

  /** Add onwheel event to play bar and also track if play bar is hovered */
  function setupPlaybar() {
    // YTM's newer UI replaced ytmusic-player-bar with ytmusic-miniplayer
    const playerbar =
      $<HTMLElement>('ytmusic-player-bar') ??
      $<HTMLElement>('ytmusic-miniplayer');
    if (!playerbar) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      changeVolume(event.deltaY < 0);
    };

    // Hover state for showVolumeSlider()
    const onMouseEnter = () => {
      playerbar.classList.add('on-hover');
    };

    const onMouseLeave = () => {
      playerbar.classList.remove('on-hover');
    };

    playerbar.addEventListener('wheel', onWheel);
    playerbar.addEventListener('mouseenter', onMouseEnter);
    playerbar.addEventListener('mouseleave', onMouseLeave);

    registerTeardown(() => {
      playerbar.removeEventListener('wheel', onWheel);
      playerbar.removeEventListener('mouseenter', onMouseEnter);
      playerbar.removeEventListener('mouseleave', onMouseLeave);
      playerbar.classList.remove('on-hover');
    });

    setupSliderObserver();
    setupNewSliderListener();
  }

  /** Save volume when the newer UI's native range slider is manually changed */
  function setupNewSliderListener() {
    // Re-enabling the plugin calls onPlayerApiReady again; don't stack listeners
    removeNewSliderListener();
    onNewSliderChange = (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.matches(newSliderSelector)) return;

      const volume = Number((target as HTMLInputElement).value);
      setTooltip(volume);
      saveVolume(volume);
    };
    // The slider is re-rendered inside a hover popup, so listen on the document.
    // Capture phase, in case YTM stops propagation on the slider itself
    document.addEventListener('change', onNewSliderChange, true);
  }

  let sliderObserver: MutationObserver | undefined;

  // Distinguishes the plugin's own slider write from a manual drag; `value` is the only signal.
  let programmaticSliderValue: string | null = null;

  /** Save the volume and update the tooltip when volume-slider is changed manually */
  function setupSliderObserver() {
    sliderObserver?.disconnect();
    const observer = new MutationObserver((mutations) => {
      const written = programmaticSliderValue;
      programmaticSliderValue = null;
      for (const mutation of mutations) {
        if (mutation.target.nodeName === 'TP-YT-PAPER-SLIDER') {
          const target = mutation.target as HTMLInputElement;
          const targetValueNumeric = Number(target.value);
          if (mutation.oldValue === target.value) continue;
          if (written !== null && target.value === written) continue;

          setTooltip(targetValueNumeric);
          saveVolume(targetValueNumeric);
        }
      }
    });

    sliderObserver = observer;

    const slider = $('#volume-slider');
    if (!slider) return;

    observer.observe(slider, {
      attributeFilter: ['value'],
      attributeOldValue: true,
    });
  }

  function setVolume(value: number) {
    api.setVolume(value);
    syncPlayerBarVolume(value);
    saveVolume(value);

    updateVolumeSlider();

    setTooltip(value);
    showVolumeSlider();
    showVolumeHud(value);
  }

  /** `toIncrease = false` decreases the volume */
  function changeVolume(toIncrease: boolean) {
    const steps = Number(options.steps || 1);
    setVolume(
      toIncrease
        ? Math.min(api.getVolume() + steps, 100)
        : Math.max(api.getVolume() - steps, 0),
    );
  }

  /** Move the volume sliders (old and new UI) to the saved volume */
  function updateVolumeSlider() {
    const savedVolume = options.savedVolume ?? 0;
    // The slider rounds to multiples of 5
    const sliderValue = String(
      savedVolume > 0 && savedVolume < 5 ? 5 : savedVolume,
    );
    // Cleared in a microtask: the observer runs first, and an unchanged slider leaves no marker.
    programmaticSliderValue = sliderValue;

    for (const slider of ['#volume-slider', '#expand-volume-slider']) {
      const silderElement = $<HTMLInputElement>(slider);
      if (silderElement) {
        silderElement.value = sliderValue;
      }
    }

    // The newer UI's slider doesn't follow api.setVolume() on its own
    const newSlider = $<HTMLInputElement>(newSliderSelector);
    if (newSlider) {
      newSlider.value = String(savedVolume);
      newSlider.style.setProperty(
        '--yt-slider-shape-gradient-percent',
        `${savedVolume}%`,
      );
    }

    queueMicrotask(() => {
      programmaticSliderValue = null;
    });
  }

  function showVolumeSlider() {
    const slider = $<HTMLElement>('#volume-slider');
    if (!slider) return;

    // The class shows the volume slider when not minimized
    slider.classList.add('on-hover');

    hideVolumeSlider(slider);
  }

  // Tooltip targets: the slider, the icon, and the expanding slider shown in small windows
  const tooltipTargets = [
    '#volume-slider',
    'tp-yt-paper-icon-button.volume',
    '#expand-volume-slider',
    '#expand-volume',
  ];

  /** Titles the tooltip targets had before the plugin wrote its own. */
  const originalTitles = new Map<HTMLElement, string | null>();

  function setTooltip(volume: number) {
    for (const target of tooltipTargets) {
      const tooltipTargetElement = $<HTMLElement>(target);
      if (tooltipTargetElement) {
        if (!originalTitles.has(tooltipTargetElement)) {
          originalTitles.set(
            tooltipTargetElement,
            tooltipTargetElement.getAttribute('title'),
          );
        }
        tooltipTargetElement.title = `${volume}%`;
      }
    }
  }

  function setupLocalArrowShortcuts() {
    if (!options.arrowsShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ($<HTMLElement & { opened: boolean }>('ytmusic-search-box')?.opened) {
        return;
      }

      switch (event.code) {
        case 'ArrowUp': {
          event.preventDefault();
          changeVolume(true);
          break;
        }

        case 'ArrowDown': {
          event.preventDefault();
          changeVolume(false);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    registerTeardown(() => {
      window.removeEventListener('keydown', onKeyDown);
    });
  }

  const onChangeVolume = (toIncrease: boolean) => changeVolume(toIncrease);
  const onSetVolume = (value: number) => setVolume(value);
  context.ipc.on('changeVolume', onChangeVolume);
  context.ipc.on('setVolume', onSetVolume);
  markReceiverReady();
  registerTeardown(() => {
    context.ipc.off('changeVolume', onChangeVolume);
    context.ipc.off('setVolume', onSetVolume);
  });

  registerTeardown(() => {
    sliderObserver?.disconnect();
    sliderObserver = undefined;
  });

  registerTeardown(() => {
    for (const [element, title] of originalTitles) {
      if (title === null) element.removeAttribute('title');
      else element.title = title;
    }
    originalTitles.clear();
  });

  await firstRun();
};

/** Undo every registration and DOM side effect of the renderer half (disable). */
export const onUnload = () => {
  teardown();
  removeNewSliderListener();
};

export const onConfigChange = (config: PreciseVolumePluginConfig) => {
  options = config;
};
