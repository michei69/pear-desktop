// YTM's like buttons toggle: pressing an active one clears the rating. pear-desktop's
// like/dislike actions set the status instead, so the player actions and the API
// handlers share this guarded setter rather than clicking blindly.

import type { LikeStatus } from "@pear/sdk";
import { selectors, type SelectorName } from "@pear/sdk/selectors";

/** The classic bar's `#like-button-renderer`, which has YTM's own setter. */
interface LikeButtons extends HTMLElement {
  updateLikeStatus?(status: string): void;
}

const LIKE_BUTTONS: Record<string, { status: LikeStatus; button: SelectorName }> = {
  LIKE: { status: "like", button: "player_bar.like" },
  DISLIKE: { status: "dislike", button: "player_bar.dislike" },
};

const $ = <E extends Element = HTMLElement>(name: SelectorName) => document.querySelector<E>(selectors[name]);

/** "LIKE", "DISLIKE" or "INDIFFERENT": sets the rating; a repeated side stays set. */
export function setLikeStatus(current: LikeStatus, status: string) {
  const classic = $<LikeButtons>("player_bar.like_buttons");
  if (classic?.updateLikeStatus) return classic.updateLikeStatus(status);
  if (status === "INDIFFERENT") {
    if (current === "like") $("player_bar.like")?.click();
    else if (current === "dislike") $("player_bar.dislike")?.click();
    return;
  }
  const wanted = LIKE_BUTTONS[status];
  if (wanted && current !== wanted.status) $(wanted.button)?.click();
}
