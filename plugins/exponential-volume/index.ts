import { definePlugin } from "@pear/sdk";

// Volume exponent; 3 is what PulseAudio uses. The lowest step YTM's slider
// offers (5%) becomes 0.0125% instead of a still-loud 5%.
// https://gist.github.com/Barteks2x/a4e189a36a10c159bb1644ffca21c02a
const EXPONENT = 3;

/** Every media element the curve reaches: YTM may replace its <video>. */
const MEDIA = "video, audio";

export default definePlugin({
  id: "exponential-volume",
  name: "Exponential volume",
  description: "Makes the volume slider follow loudness perception, giving finer control at low volumes.",
  page: async (ctx) => {
    await ctx.player.videoReady();
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
    if (!native?.get || !native?.set) return;

    // Reads return what was set, not the cube root of the real value, which
    // would drift by rounding (YTM compares volumes it wrote).
    const written = new WeakMap<HTMLMediaElement, number>();
    const linear = native.get;
    const setLinear = native.set;

    // The prototype, like pear-desktop: a replaced <video> and any other media
    // element (the crossfade's second stream) follow the curve too.
    Object.defineProperty(HTMLMediaElement.prototype, "volume", {
      configurable: true,
      get(this: HTMLMediaElement) {
        const perceived = (linear.call(this) as number) ** (1 / EXPONENT);
        const stored = written.get(this);
        return stored !== undefined && Math.abs(stored - perceived) < 0.01 ? stored : perceived;
      },
      set(this: HTMLMediaElement, volume: number) {
        written.set(this, volume);
        setLinear.call(this, volume ** EXPONENT);
      },
    });

    // Re-map whatever is already playing through the curve (the plugin can be enabled mid-track).
    for (const element of document.querySelectorAll<HTMLMediaElement>(MEDIA)) {
      element.volume = linear.call(element) as number;
    }

    return () => {
      // Undo the scaled-down media volume before the native accessor returns,
      // so disabling does not leave the sound quieter than the slider says.
      for (const element of document.querySelectorAll<HTMLMediaElement>(MEDIA)) {
        setLinear.call(element, (linear.call(element) as number) ** (1 / EXPONENT));
      }
      Object.defineProperty(HTMLMediaElement.prototype, "volume", native);
    };
  },
});
