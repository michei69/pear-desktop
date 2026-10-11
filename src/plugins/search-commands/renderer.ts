import { createRenderer } from '@/utils';

import { registerBuiltinCommands } from './builtins';
import {
  getCommand,
  getCommands,
  isCommandLine,
  matchCommands,
  tokenize,
  type CommandContext,
  type CommandRow,
} from './commands';
import {
  defaultSearchCommandsConfig,
  type SearchCommandsConfig,
} from './config';
import { matchesKeybind, parseKeybind, type Keybind } from './keybind';

const TAG = '[search-commands]';

const log = (...args: unknown[]) => console.log(TAG, ...args);

/** The parts of YTM's `ytmusic-search-box` this plugin drives. */
type SearchBox = HTMLElement & {
  opened: boolean;
  hasQuery: boolean;
  isSuggestedQuery: boolean;
  originalQuery: string;
  suggestionData: unknown[];
  searchBoxInput: HTMLInputElement;
};

type Watched = {
  el: SearchBox;
  input: HTMLInputElement;
  observer: MutationObserver;
  onBlur: () => void;
};

let box: SearchBox | undefined;
let rows: CommandRow[] = [];
let selected = -1;
let watched: Watched | undefined;
let config: SearchCommandsConfig = defaultSearchCommandsConfig;
let openBind: Keybind | undefined = parseKeybind(
  defaultSearchCommandsConfig.openKeybind,
);

/**
 * The search box an event came from.
 *
 * HACK: YTM installs its handlers as own properties via lazy registration, and
 * patching them did not stick; a capture-phase listener runs first by spec.
 */
const boxFrom = (event: Event): SearchBox | undefined => {
  const target = event.target;
  if (!(target instanceof Element)) return undefined;

  return target.closest<SearchBox>('ytmusic-search-box') ?? undefined;
};

/** Every native suggestion row currently rendered, in `rows` order. */
const suggestionElements = (el: SearchBox): HTMLElement[] =>
  Array.from(el.querySelectorAll<HTMLElement>('ytmusic-search-suggestion'));

/** Releases the native list back to YTM, but only if we were the ones using it. */
const release = () => {
  if (rows.length === 0) return;

  rows = [];
  selected = -1;
  if (box) box.suggestionData = [];
};

/**
 * Wipes the box after a command was consumed, so the next open starts clean.
 * `originalQuery` too: YTM restores it into the input when the box closes.
 */
const clearBox = (el: SearchBox) => {
  el.searchBoxInput.value = '';
  el.hasQuery = false;
  el.originalQuery = '';
  el.suggestionData = [];
  rows = [];
  selected = -1;
};

/**
 * Hands our rows to YTM's own autocomplete: `searchSuggestionRenderer` is the
 * component YTM uses for query suggestions, so it follows the theme for free.
 */
const render = () => {
  const el = box;
  if (!el) return;

  const { value } = el.searchBoxInput;

  if (!isCommandLine(value)) {
    release();
    return;
  }

  rows = matchCommands(value);
  selected = -1;
  el.suggestionData =
    rows.length === 0
      ? []
      : [
          {
            searchSuggestionsSectionRenderer: {
              contents: rows.map((row) => ({
                searchSuggestionRenderer: {
                  suggestion: { runs: [{ text: row.text }] },
                  icon: { iconType: 'SEARCH' },
                },
              })),
            },
          },
        ];

  log(
    'input:',
    value,
    '→ command line,',
    rows.length,
    'rows (native autocomplete)',
  );

  decorate();
};

/**
 * `ytmusic-search-suggestion` has no slot for a description, so hang one off
 * the row itself. Idempotent: the observer also sees our own insertion.
 */
const decorate = () => {
  const el = box;
  if (!el || rows.length === 0) return;

  suggestionElements(el).forEach((element, index) => {
    const row = rows[index];
    if (!row || element.querySelector('.pcmd-desc')) return;

    const description = document.createElement('span');
    description.className = 'pcmd-desc';
    description.textContent = row.description;
    element.append(description);
  });
};

const highlight = (index: number) => {
  const el = box;
  if (!el) return;

  const elements = suggestionElements(el);

  if (selected >= 0)
    elements[selected]?.classList.remove('selected-suggestion');
  selected = index;

  const element = selected >= 0 ? elements[selected] : undefined;
  if (element) {
    // YTM's own highlight class, so it picks up the theme.
    element.classList.add('selected-suggestion');
    element.scrollIntoView({ block: 'nearest' });
  }
};

const moveSelection = (step: number) => {
  if (rows.length === 0) return;

  const next = selected + step;
  highlight(next < 0 ? rows.length - 1 : next >= rows.length ? 0 : next);
};

const unwatch = () => {
  const current = watched;
  if (!current) return;

  current.input.removeEventListener('blur', current.onBlur);
  current.observer.disconnect();
  watched = undefined;
};

/** Wires up the element once seen, and keeps descriptions on the rows YTM renders from our data. */
const watchElement = (el: SearchBox) => {
  if (watched?.el === el) return;
  unwatch();

  const input = el.searchBoxInput;

  const onBlur = () => {
    // Clicking a suggestion row blurs the input but leaves the box open: a
    // pick, not a dismissal. Releasing here would drop the rows the pick uses.
    if (el.opened) return;

    release();
    exitSpotlight();
  };

  input.addEventListener('blur', onBlur);

  const observer = new MutationObserver(() => {
    if (box === el) decorate();
  });
  observer.observe(el, { childList: true, subtree: true });

  watched = { el, input, observer, onBlur };
};

/** Remembers the element the event came from, and wires it up once. */
const track = (el: SearchBox) => {
  box = el;
  watchElement(el);
};

/** The state YTM's own `onInput` would have set, minus its suggestion request. */
const markCommandLine = (el: SearchBox) => {
  const { value } = el.searchBoxInput;

  el.opened = true;
  el.isSuggestedQuery = false;
  el.hasQuery = value.trim().length > 0;
  el.originalQuery = value;
};

const context = (onInsert?: () => void): CommandContext => ({
  insert: (text) => {
    const el = box;
    if (!el) return;

    onInsert?.();

    const { searchBoxInput } = el;
    searchBoxInput.value = text;
    searchBoxInput.focus();
    searchBoxInput.setSelectionRange(text.length, text.length);

    markCommandLine(el);
    render();
  },
});

/** Picking a row: click, or Enter on a highlighted one. */
const accept = async (row: CommandRow) => {
  const ctx = context();

  log(
    'accept:',
    row.text,
    row.command.onSelect ? '(command onSelect)' : '(default insert)',
  );

  if (row.command.onSelect) await row.command.onSelect(row, ctx);
  else ctx.insert(row.text);
};

/**
 * Row clicks arrive as `ytmusic-suggestion-activated`, which YTM's search box
 * handles by searching; stop it and write the command line into the box.
 */
const onSuggestionActivated = (event: Event) => {
  const el = boxFrom(event);
  if (!el || !isCommandLine(el.searchBoxInput.value)) return;

  const { suggestion } = (event as CustomEvent<{ suggestion?: string }>).detail;
  const row = rows.find((candidate) => candidate.text === suggestion);
  if (!row) return;

  event.stopImmediatePropagation();
  log('click: accepting row', row.text);
  accept(row);
};

const onDocumentInput = (event: Event) => {
  const el = boxFrom(event);
  if (!el) return;

  track(el);

  if (!isCommandLine(el.searchBoxInput.value)) {
    // Not ours: YTM's onInput runs untouched. `release` only drops rows we took.
    release();
    return;
  }

  // Swallowing here stops YTM's handler — and its suggestion request.
  event.stopImmediatePropagation();
  markCommandLine(el);
  render();
};

const findSearchBox = (): SearchBox | undefined =>
  document.querySelector<SearchBox>('ytmusic-nav-bar ytmusic-search-box') ??
  document.querySelector<SearchBox>('ytmusic-search-box') ??
  undefined;

/** Width of the floating field, and how far down the viewport it sits. */
const SPOTLIGHT_WIDTH = 680;
const SPOTLIGHT_TOP = 0.22;
/** One below the box's own `z-index`, which the stylesheet sets. */
const SCRIM_Z = 2147482000;

type Lifted = {
  el: HTMLElement;
  /** We had to give it `position: relative` for `z-index` to apply. */
  positioned: boolean;
  zIndex: string;
  zPriority: string;
};

let scrim: HTMLElement | undefined;
let spotlightEl: SearchBox | undefined;
let containingBlock: HTMLElement | undefined;
let lifted: Lifted[] = [];

/**
 * The ancestor `position: fixed` resolves against: a transform, filter or
 * `will-change` makes one, and the box is nested inside one, so viewport
 * coordinates would land it in the wrong place.
 */
const fixedContainingBlock = (el: SearchBox): HTMLElement | undefined => {
  for (
    let node = el.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);

    if (
      style.transform !== 'none' ||
      style.filter !== 'none' ||
      style.backdropFilter !== 'none' ||
      style.perspective !== 'none' ||
      style.contain !== 'none' ||
      /transform|filter|perspective/.test(style.willChange)
    ) {
      return node;
    }
  }

  return undefined;
};

/** Does this element paint as its own stacking context? */
const isStackingContext = (style: CSSStyleDeclaration): boolean =>
  (style.position !== 'static' && style.zIndex !== 'auto') ||
  style.transform !== 'none' ||
  style.filter !== 'none' ||
  style.backdropFilter !== 'none' ||
  style.perspective !== 'none' ||
  style.opacity !== '1' ||
  style.isolation === 'isolate' ||
  style.contain !== 'none' ||
  /transform|filter|perspective|opacity/.test(style.willChange);

/**
 * The scrim lives in the root stacking context, so any context the box is
 * nested inside would paint below it. Raise each on the way out; the walk stops
 * at the first ancestor that is not a context, where the z-index lands in root.
 */
const liftAboveScrim = (el: SearchBox): Lifted[] => {
  const raised: Lifted[] = [];

  for (
    let node = el.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (!isStackingContext(style)) break;

    raised.push({
      el: node,
      positioned: style.position === 'static',
      zIndex: node.style.zIndex,
      zPriority: node.style.getPropertyPriority('z-index'),
    });

    if (style.position === 'static') {
      node.style.setProperty('position', 'relative');
    }
    node.style.setProperty('z-index', String(SCRIM_Z + 1), 'important');
  }

  return raised;
};

const placeSpotlight = (el: SearchBox) => {
  const width = Math.min(SPOTLIGHT_WIDTH, Math.round(window.innerWidth * 0.88));
  const frame = containingBlock?.getBoundingClientRect();

  el.style.setProperty(
    '--pear-spotlight-left',
    `${Math.round((window.innerWidth - width) / 2) - (frame?.left ?? 0)}px`,
  );
  el.style.setProperty(
    '--pear-spotlight-top',
    `${Math.round(window.innerHeight * SPOTLIGHT_TOP) - (frame?.top ?? 0)}px`,
  );
  el.style.setProperty('--pear-spotlight-width', `${width}px`);
};

const onSpotlightResize = () => {
  if (spotlightEl) placeSpotlight(spotlightEl);
};

const exitSpotlight = () => {
  const el = spotlightEl;
  if (!el) return;

  window.removeEventListener('resize', onSpotlightResize);
  el.classList.remove('pear-spotlight');
  spotlightEl = undefined;

  for (const entry of lifted) {
    if (entry.positioned) entry.el.style.removeProperty('position');
    entry.el.style.removeProperty('z-index');
    if (entry.zIndex) {
      entry.el.style.setProperty('z-index', entry.zIndex, entry.zPriority);
    }
  }
  lifted = [];
  containingBlock = undefined;

  scrim?.removeAttribute('data-open');

  // Dismissing the overlay discards the command line with it.
  clearBox(el);

  log('spotlight: off');
};

const dismissSpotlight = () => {
  if (box) box.opened = false;
  exitSpotlight();
};

const enterSpotlight = (el: SearchBox) => {
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.id = 'pear-spotlight-scrim';
    // YTM only watches taps on its own elements, so the scrim must close itself.
    scrim.addEventListener('mousedown', dismissSpotlight);
    document.body.append(scrim);
  }

  containingBlock = fixedContainingBlock(el);
  lifted = liftAboveScrim(el);
  placeSpotlight(el);

  el.classList.add('pear-spotlight');
  scrim.setAttribute('data-open', '');
  spotlightEl = el;
  window.addEventListener('resize', onSpotlightResize);

  log(
    'spotlight: on; fixed resolves against',
    containingBlock ? `<${containingBlock.localName}>` : 'the viewport',
    '; lifted',
    lifted.map((entry) => `<${entry.el.localName}>`).join(' ') || 'nothing',
  );

  // Z-order cannot be read off the source, so probe what actually ends up on top.
  const rect = el.getBoundingClientRect();
  const probe = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  log(
    'spotlight: box is',
    probe?.closest('ytmusic-search-box')
      ? 'above the scrim'
      : `covered by ${probe?.id || probe?.tagName || 'nothing'}`,
  );
};

/**
 * Spotlight-style summon: float the box over a dimmed page, already in command
 * mode, so the list is there to filter. Pressing the shortcut again closes it.
 */
const openSearchBox = () => {
  const el = findSearchBox();

  if (!el) {
    log('shortcut: no search box on the page');
    return;
  }

  track(el);

  if (el.opened && isCommandLine(el.searchBoxInput.value)) {
    log('shortcut: closing the command box');
    dismissSpotlight();
    return;
  }

  enterSpotlight(el);

  el.searchBoxInput.value = '/';
  // YTM's own open path: `openedChanged` focuses the input for us.
  el.opened = true;
  el.searchBoxInput.setSelectionRange(1, 1);
  markCommandLine(el);
  render();

  log('shortcut: opened the command box');
};

const onOpenShortcut = (event: KeyboardEvent) => {
  if (!openBind || event.repeat || !matchesKeybind(openBind, event)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  openSearchBox();
};

const applyConfig = (next: SearchCommandsConfig) => {
  config = next;
  openBind = next.openShortcut ? parseKeybind(next.openKeybind) : undefined;

  if (next.openShortcut && !openBind) {
    log('cannot parse the open keybind:', next.openKeybind);
  }
};

const onDocumentKey = (event: KeyboardEvent) => {
  const el = boxFrom(event);
  if (!el || !isCommandLine(el.searchBoxInput.value)) return;

  if (event.key === 'Enter') {
    const { value } = el.searchBoxInput;
    const picked = rows[selected];
    const name = tokenize(value)[0] ?? '';
    const command = getCommand(name);

    // Not a command we know about: leave the event alone and let YTM search.
    if (!picked && !command) {
      log('enter: no command named', name, '→ YTM searches');
      return;
    }

    // YTM binds Enter on `keypress`, so both events have to be stopped.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type !== 'keydown') return;

    track(el);

    if (picked) {
      log('enter: accepting highlighted row', picked.text);
      accept(picked);
      return;
    }

    const args = tokenize(value)
      .slice(1)
      .filter((arg) => arg !== '');

    log('enter: running', `/${name}`, 'with args', args);

    // A command that wrote back into the box has not consumed the line; leave
    // it for editing.
    let inserted = false;
    command?.run(
      args,
      context(() => {
        inserted = true;
      }),
    );

    if (!inserted) {
      // `clearBox` too: without the overlay, a command should still leave the
      // box empty.
      clearBox(el);
      dismissSpotlight();
    }
    return;
  }

  // Tab completes the highlighted row, or the first one. Swallowed either way,
  // so focus cannot leave the box mid-command — YTM otherwise cycles the
  // search, clear and guide buttons on Tab.
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type !== 'keydown') return;

    const picked = rows[selected] ?? rows[0];
    if (!picked) return;

    track(el);
    log('tab: accepting row', picked.text);
    accept(picked);
    return;
  }

  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  if (event.type !== 'keydown') return;

  event.preventDefault();
  event.stopImmediatePropagation();

  track(el);
  moveSelection(event.key === 'ArrowUp' ? -1 : 1);
};

const LISTENERS: Array<[string, EventListener]> = [
  ['input', onDocumentInput as EventListener],
  ['keydown', onOpenShortcut as EventListener],
  ['keydown', onDocumentKey as EventListener],
  ['keypress', onDocumentKey as EventListener],
  ['ytmusic-suggestion-activated', onSuggestionActivated],
];

export const renderer = createRenderer({
  unregisterCommands: null as (() => void) | null,

  async start(ctx) {
    log('renderer start');

    this.unregisterCommands = registerBuiltinCommands(ctx);
    log(
      'registered commands:',
      getCommands().map((command) => `/${command.name}`),
    );

    for (const [type, listener] of LISTENERS) {
      document.addEventListener(type, listener, true);
    }

    log('listening for "/" in the search box');

    // Listeners are already registered, so a slow config round-trip cannot
    // leave the box unhooked; this only settles which shortcut opens it.
    applyConfig(await ctx.getConfig());
    log(
      'open shortcut:',
      config.openShortcut ? config.openKeybind || '(none)' : 'off',
    );
  },

  onConfigChange(newConfig: SearchCommandsConfig) {
    log('config changed:', newConfig);
    applyConfig(newConfig);
  },

  stop() {
    log('renderer stop');

    for (const [type, listener] of LISTENERS) {
      document.removeEventListener(type, listener, true);
    }

    this.unregisterCommands?.();
    this.unregisterCommands = null;

    release();
    exitSpotlight();
    unwatch();
    scrim?.remove();
    scrim = undefined;
    box = undefined;
  },
});
