export const trays: FakeTray[] = [];

export class FakeTray {
  titles: string[] = [];
  destroyed = false;

  constructor() {
    trays.push(this);
  }

  setTitle(title: string) {
    this.titles.push(title);
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }
}

export const nativeImage = { createEmpty: () => ({}) };

/** The name the plugin imports (`Tray`). */
export { FakeTray as Tray };
