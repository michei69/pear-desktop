/* what */

const ignored = {
  id: ['volume-slider', 'expand-volume-slider'],
  types: ['mousewheel', 'keydown', 'keyup'],
} as const;

type CustomElementPrototype = typeof Element.prototype & {
  _addEventListener?: typeof Element.prototype.addEventListener;
};

function overrideAddEventListener() {
  // Save native addEventListener
  // @ts-expect-error - We know what we're doing
  // oxlint-disable-next-line typescript/unbound-method
  Element.prototype._addEventListener = Element.prototype.addEventListener;
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
  overrideAddEventListener();
  // Restore the original after load, so Element.prototype is not left altered
  window.addEventListener(
    'load',
    () => {
      Element.prototype.addEventListener = (
        Element.prototype as CustomElementPrototype
      )._addEventListener!;
      (Element.prototype as CustomElementPrototype)._addEventListener =
        undefined;
    },
    { once: true },
  );
};
