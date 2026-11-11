// Electron's Tray, Menu and nativeImage as the tray plugin uses them, for its
// tests: records the handlers, the images and the menu templates.

type Handler = (...args: unknown[]) => void;

export class FakeImage {
  templateImage = false;
  constructor(readonly data: unknown) {}
  setTemplateImage(template: boolean) {
    this.templateImage = template;
  }
}

export class FakeTray {
  readonly handlers = new Map<string, Handler>();
  contextMenu: unknown;
  destroyed = false;
  image: unknown;
  ignoresDoubleClickEvents: boolean | undefined;
  tooltip = "";

  /** The Tray the plugin created last. */
  static last() {
    return trays.at(-1);
  }

  constructor(image: unknown) {
    this.image = image;
    trays.push(this);
  }

  on(event: string, handler: Handler) {
    this.handlers.set(event, handler);
  }

  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args);
  }

  removeListener(event: string) {
    this.handlers.delete(event);
  }

  setImage(image: unknown) {
    this.image = image;
  }

  setToolTip(text: string) {
    this.tooltip = text;
  }

  setContextMenu(menu: unknown) {
    this.contextMenu = menu;
  }

  getBounds() {
    return { x: 0, y: 0, width: 16, height: 16 };
  }

  setIgnoreDoubleClickEvents(ignore: boolean) {
    this.ignoresDoubleClickEvents = ignore;
  }

  destroy() {
    this.destroyed = true;
  }
}

export const trays: FakeTray[] = [];
export const images: FakeImage[] = [];
export const menuTemplates: unknown[][] = [];

export const Menu = {
  buildFromTemplate(template: unknown[]) {
    menuTemplates.push(template);
    return { template };
  },
};

export const nativeImage = {
  createFromBitmap(data: unknown) {
    const image = new FakeImage(data);
    images.push(image);
    return image;
  },
};

/** The name the plugin imports (`Tray`). */
export { FakeTray as Tray };
