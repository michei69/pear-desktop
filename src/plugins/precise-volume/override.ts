/* what */

const ignored = {
  id: ['volume-slider', 'expand-volume-slider'],
  types: ['mousewheel', 'keydown', 'keyup'],
} as const;

type CustomElementPrototype = typeof Element.prototype & {
  _addEventListener?: typeof Element.prototype.addEventListener;
};

/**
 * Resolved lazily: the plugin entry (and so this module) is also evaluated in
 * the main process bundle, where `Element` does not exist.
 */
const elementPrototype = () => Element.prototype as CustomElementPrototype;

/** Undoes the addEventListener override; set only while it is installed. */
let restorePrototype: (() => void) | undefined;

const restore = () => {
  if (!restorePrototype) return;

  const prototype = elementPrototype();
  const nativeAddEventListener = prototype._addEventListener;
  if (nativeAddEventListener) {
    Element.prototype.addEventListener = nativeAddEventListener;
  }
  delete prototype._addEventListener;
  restorePrototype = undefined;
};

// Restore as soon as the page finished booting: only its own startup listeners
// have to be filtered, and a live enable happens after 'load' already fired.
const onWindowLoad = () => {
  window.removeEventListener('load', onWindowLoad);
  restore();
};

function overrideAddEventListener() {
  const prototype = elementPrototype();
  // Save native addEventListener
  // oxlint-disable-next-line typescript/unbound-method
  prototype._addEventListener = Element.prototype.addEventListener;
  // Override addEventListener to ignore specific events in volume-slider
  Element.prototype.addEventListener = function (
    type: string,
    listener: (event: Event) => void,
    useCapture = false,
  ) {
    if (!(ignored.id.includes(this.id) && ignored.types.includes(type))) {
      (this as CustomElementPrototype)._addEventListener!(
        type,
        listener,
        useCapture,
      );
    } else if (window.electronIs.dev()) {
      console.log(`Ignoring event: "${this.id}.${type}()"`);
    }
  };
}

export const overrideListener = () => {
  if (restorePrototype) return;

  overrideAddEventListener();
  restorePrototype = restore;

  if (document.readyState === 'complete') {
    // Enabling after the page loaded: there are no startup listeners left to
    // filter, so do not leave the prototype patched for the whole session.
    restore();
    return;
  }

  window.addEventListener('load', onWindowLoad, { once: true });
};

/** Undo a pending or installed override (called when the plugin is disabled). */
export const restoreOverrideListener = () => {
  window.removeEventListener('load', onWindowLoad);
  restore();
};
