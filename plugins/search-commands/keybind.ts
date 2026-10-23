/**
 * In-page keyboard shortcuts, written the way Electron accelerators are:
 * `Ctrl+/`, `CmdOrCtrl+K`, `Alt+Shift+Space`.
 */

export interface Keybind {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Lowercased `KeyboardEvent.key` this shortcut accepts. */
  key: string;
}

/** Spellings people reach for, mapped onto what `KeyboardEvent.key` reports. */
const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

const isMac = () => /Mac/.test(navigator.userAgent);

/** Returns undefined for anything that is not a shortcut we can match. */
export const parseKeybind = (accelerator: string): Keybind | undefined => {
  // The key is whatever follows the last `+`; an empty one means the
  // accelerator was malformed, so it is rejected rather than read as a modifier.
  const parts = accelerator.split("+").map((part) => part.trim().toLowerCase());

  const key = parts.pop() ?? "";
  if (!key) return undefined;

  const bind: Keybind = { ctrl: false, meta: false, alt: false, shift: false, key: "" };

  for (const part of parts) {
    if (part === "") continue;

    switch (part) {
      case "ctrl":
      case "control":
        bind.ctrl = true;
        break;
      case "cmdorctrl":
      case "commandorcontrol":
        if (isMac()) bind.meta = true;
        else bind.ctrl = true;
        break;
      case "cmd":
      case "command":
      case "meta":
      case "super":
        bind.meta = true;
        break;
      case "alt":
      case "option":
        bind.alt = true;
        break;
      case "shift":
        bind.shift = true;
        break;
      default:
        return undefined;
    }
  }

  bind.key = KEY_ALIASES[key] ?? key;
  return bind;
};

/**
 * A character carries shift in the character itself — `/` needs shift on a
 * German layout — so a symbol binding must not also demand a shift state.
 */
const isSymbol = (key: string) => key.length === 1 && !/[a-z0-9]/.test(key);

export const matchesKeybind = (bind: Keybind, event: KeyboardEvent): boolean => {
  if (event.ctrlKey !== bind.ctrl) return false;
  if (event.metaKey !== bind.meta) return false;
  if (event.altKey !== bind.alt) return false;
  if (!isSymbol(bind.key) && event.shiftKey !== bind.shift) return false;

  return event.key.toLowerCase() === bind.key;
};
