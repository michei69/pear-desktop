// The player bar in either of YTM's layouts (see @pear/sdk/selectors): the
// classic one, or the new one YTM gives some visitors, picked per profile.

import { selectors, type SelectorName } from "@pear/sdk/selectors";
import type { Page } from "@playwright/test";

/** A registry selector; the player bar's match either layout. */
export const sel = (name: SelectorName): string => selectors[name];

/** `css` inside the player bar, whichever layout YTM picked. */
export const inBar = (css: string) => `:is(${selectors.player_bar}) ${css}`;

/** Which player bar the page shows. */
export const barLayout = (page: Page) =>
  page.evaluate((newBar) => (document.querySelector(newBar) ? "new" : "classic"), selectors["player_bar.new"]);

export const sliderVolume = (page: Page) =>
  page.evaluate(
    (slider) => Number(document.querySelector<HTMLElement & { value: number | string }>(slider)!.value),
    selectors["player_bar.volume_slider"],
  );
