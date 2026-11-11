// YTM's own `title`s on the volume elements, kept so disabling the plugin
// restores its tooltips instead of leaving the plugin's last `NN%` behind.

/** Writes volume tooltips, remembering (and restoring) the titles YTM had. */
export class VolumeTitles {
  readonly #original = new Map<HTMLElement, string | null>();

  /** Shows `volume` on `element`, capturing YTM's title the first time it is written. */
  set(element: HTMLElement, volume: number) {
    if (!this.#original.has(element)) this.#original.set(element, element.getAttribute("title"));
    element.title = `${volume}%`;
  }

  /** Puts every captured title back (or removes the attribute YTM did not have). */
  restore() {
    for (const [element, title] of this.#original) {
      if (title === null) element.removeAttribute("title");
      else element.title = title;
    }
    this.#original.clear();
  }
}
