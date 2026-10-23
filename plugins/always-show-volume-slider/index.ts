import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  id: "always-show-volume-slider",
  name: "Always show volume slider",
  description: "Keeps the volume slider visible in the player bar, so it can be dragged without hovering it first.",
  style: css`
    sel(player_bar.volume_sliders) {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    /* The new player bar puts its slider in a popup that YTM shows on hover. */
    sel(player_bar.volume_popup) {
      display: flex !important;
    }
  `,
});
