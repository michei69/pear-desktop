import { type ConfigOf, type PageContextOf } from "@pear/sdk";
import { isTypingTarget } from "@pear/sdk/util";
import { type CommandContext, type CommandRow, getCommand, isCommandLine, matchCommands, registerCommand, tokenize } from "./commands.ts";
import { type schema, type SearchCommands } from "./config.ts";
import { type Keybind, matchesKeybind, parseKeybind } from "./keybind.ts";
import { parseVideoId } from "./video-id.ts";

/** The parts of YTM's `ytmusic-search-box` this plugin drives. */
interface SearchBox extends HTMLElement {
  opened: boolean;
  hasQuery: boolean;
  isSuggestedQuery: boolean;
  originalQuery: string;
  suggestionData: unknown[];
  searchBoxInput: HTMLInputElement;
}

interface Watched {
  el: SearchBox;
  input: HTMLInputElement;
  observer: MutationObserver;
  onBlur: () => void;
}

interface Lifted {
  el: HTMLElement;
  /** We had to give it `position: relative` for `z-index` to apply. */
  positioned: boolean;
  zIndex: string;
  zPriority: string;
}

/** Width of the floating field, and how far down the viewport it sits. */
const SPOTLIGHT_WIDTH = 680;
const SPOTLIGHT_TOP = 0.22;
/** One below the box's own `z-index`, which the stylesheet sets. */
const SCRIM_Z = 2147482000;

type Ctx = PageContextOf<typeof schema, SearchCommands>;

export function startSearchCommands(ctx: Ctx) {
  let box: SearchBox | undefined;
  let rows: CommandRow[] = [];
  let selected = -1;
  let watched: Watched | undefined;
  let openBind: Keybind | undefined = ctx.config.openShortcut ? parseKeybind(ctx.config.openKeybind) : undefined;
  let scrim: HTMLElement | undefined;
  let spotlightEl: SearchBox | undefined;
  let containingBlock: HTMLElement | undefined;
  let lifted: Lifted[] = [];

  const log = (...args: unknown[]) => ctx.log.info(...args);

  const unregister = [
    registerCommand({
      name: "settings",
      // pear-desktop's translation keys for the command list; they still describe it.
      description: ctx.t("plugins.search-commands.commands.settings", "Open the settings"),
      run: () => {
        void ctx.host.invoke("openSettings").catch((error: unknown) => ctx.log.warn("could not open the settings", error));
      },
    }),
    registerCommand({
      name: "play",
      description: ctx.t("plugins.search-commands.commands.play", "Play a video from a link or id"),
      args: [{ name: "url" }],
      run: (args) => {
        const videoId = parseVideoId(args[0] ?? "");
        if (!videoId) return;

        const app = document.querySelector<HTMLElement>(ctx.sel("app"));
        if (!app) {
          location.assign(`/watch?v=${encodeURIComponent(videoId)}`);
          return;
        }
        app.dispatchEvent(
          new CustomEvent("yt-navigate", {
            bubbles: true,
            composed: true,
            detail: { endpoint: { watchEndpoint: { videoId } } },
          }),
        );
      },
    }),
  ];

  /** The search box an event came from. */
  function boxFrom(event: Event): SearchBox | undefined {
    const target = event.target;
    if (!(target instanceof Element)) return undefined;
    return target.closest<SearchBox>(ctx.sel("nav_bar.search_box")) ?? undefined;
  }

  /** Every native suggestion row currently rendered, in `rows` order. */
  const suggestionElements = (el: SearchBox) => ctx.$$("nav_bar.search_suggestions", el);

  /** Releases the native list back to YTM, but only if we were the ones using it. */
  function release() {
    if (rows.length === 0) return;
    if (box) {
      for (const row of suggestionElements(box)) row.querySelector(".pcmd-desc")?.remove();
      box.suggestionData = [];
    }
    rows = [];
    selected = -1;
  }

  /**
   * Wipes the box after a command was consumed, so the next open starts clean.
   * `originalQuery` too: YTM restores it into the input when the box closes.
   */
  function clearBox(el: SearchBox) {
    el.searchBoxInput.value = "";
    el.hasQuery = false;
    el.originalQuery = "";
    el.suggestionData = [];
    for (const row of suggestionElements(el)) row.querySelector(".pcmd-desc")?.remove();
    rows = [];
    selected = -1;
  }

  /**
   * Hands our rows to YTM's own autocomplete: `searchSuggestionRenderer` is the
   * component YTM uses for query suggestions, so it follows the theme for free.
   */
  function render() {
    const el = box;
    if (!el) return;

    const value = el.searchBoxInput.value;
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
                    icon: { iconType: "SEARCH" },
                  },
                })),
              },
            },
          ];
    decorate();
  }

  /**
   * `ytmusic-search-suggestion` has no slot for a description, so hang one off
   * the row itself. Idempotent: the observer also sees our own insertion.
   */
  function decorate() {
    const el = box;
    if (!el || rows.length === 0) return;

    suggestionElements(el).forEach((element, index) => {
      const row = rows[index];
      if (!row || element.querySelector(".pcmd-desc")) return;

      const description = document.createElement("span");
      description.className = "pcmd-desc";
      description.textContent = row.description;
      element.append(description);
    });
  }

  function highlight(index: number) {
    const el = box;
    if (!el) return;

    const elements = suggestionElements(el);
    if (selected >= 0) elements[selected]?.classList.remove("selected-suggestion");
    selected = index;

    const element = selected >= 0 ? elements[selected] : undefined;
    if (!element) return;

    // YTM's own highlight class, so it picks up the theme.
    element.classList.add("selected-suggestion");
    element.scrollIntoView({ block: "nearest" });
  }

  function moveSelection(step: number) {
    if (rows.length === 0) return;
    const next = selected + step;
    highlight(next < 0 ? rows.length - 1 : next >= rows.length ? 0 : next);
  }

  function unwatch() {
    const current = watched;
    if (!current) return;
    current.input.removeEventListener("blur", current.onBlur);
    current.observer.disconnect();
    watched = undefined;
  }

  /** Wires up the element once seen, and keeps descriptions on the rows YTM renders from our data. */
  function watchElement(el: SearchBox) {
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
    input.addEventListener("blur", onBlur);

    const observer = new MutationObserver(() => {
      if (box === el) decorate();
    });
    observer.observe(el, { childList: true, subtree: true });

    watched = { el, input, observer, onBlur };
  }

  /** Remembers the element the event came from, and wires it up once. */
  function track(el: SearchBox) {
    box = el;
    watchElement(el);
  }

  /** The state YTM's own `onInput` would have set, minus its suggestion request. */
  function markCommandLine(el: SearchBox) {
    const value = el.searchBoxInput.value;
    el.opened = true;
    el.isSuggestedQuery = false;
    el.hasQuery = value.trim().length > 0;
    el.originalQuery = value;
  }

  function commandContext(onInsert?: () => void): CommandContext {
    return {
      insert: (text) => {
        const el = box;
        if (!el) return;

        onInsert?.();
        const input = el.searchBoxInput;
        input.value = text;
        input.focus();
        input.setSelectionRange(text.length, text.length);
        markCommandLine(el);
        render();
      },
    };
  }

  /** Picking a row: click, or Enter on a highlighted one. */
  async function accept(row: CommandRow) {
    if (!row.command.onSelect) {
      commandContext().insert(row.text);
      return;
    }
    await row.command.onSelect(row, commandContext());
  }

  /**
   * Row clicks arrive as `ytmusic-suggestion-activated`, which YTM's search box
   * handles by searching; stop it and write the command line into the box.
   */
  function onSuggestionActivated(event: Event) {
    const el = boxFrom(event);
    if (!el || !isCommandLine(el.searchBoxInput.value)) return;

    const suggestion = (event as CustomEvent<{ suggestion?: unknown }>).detail?.suggestion;
    if (typeof suggestion !== "string") return;
    const row = rows.find((candidate) => candidate.text === suggestion);
    if (!row) return;

    event.stopImmediatePropagation();
    void accept(row);
  }

  function onDocumentInput(event: Event) {
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
  }

  function findSearchBox(): SearchBox | undefined {
    return (
      document.querySelector<SearchBox>(`${ctx.sel("nav_bar")} ${ctx.sel("nav_bar.search_box")}`) ??
      document.querySelector<SearchBox>(ctx.sel("nav_bar.search_box")) ??
      undefined
    );
  }

  /**
   * The ancestor `position: fixed` resolves against: a transform, filter or
   * `will-change` makes one, and the box is nested inside one, so viewport
   * coordinates would land it in the wrong place.
   */
  function fixedContainingBlock(el: SearchBox): HTMLElement | undefined {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.transform !== "none" ||
        style.filter !== "none" ||
        style.backdropFilter !== "none" ||
        style.perspective !== "none" ||
        style.contain !== "none" ||
        /transform|filter|perspective/.test(style.willChange)
      ) {
        return node;
      }
    }
    return undefined;
  }

  /** Does this element paint as its own stacking context? */
  const isStackingContext = (style: CSSStyleDeclaration) =>
    (style.position !== "static" && style.zIndex !== "auto") ||
    style.transform !== "none" ||
    style.filter !== "none" ||
    style.backdropFilter !== "none" ||
    style.perspective !== "none" ||
    style.opacity !== "1" ||
    style.isolation === "isolate" ||
    style.contain !== "none" ||
    /transform|filter|perspective|opacity/.test(style.willChange);

  /**
   * The scrim lives in the root stacking context, so any context the box is
   * nested inside would paint below it. Raise each on the way out; the walk stops
   * at the first ancestor that is not a context, where the z-index lands in root.
   */
  function liftAboveScrim(el: SearchBox): Lifted[] {
    const raised: Lifted[] = [];
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (!isStackingContext(style)) break;

      raised.push({
        el: node,
        positioned: style.position === "static",
        zIndex: node.style.zIndex,
        zPriority: node.style.getPropertyPriority("z-index"),
      });

      if (style.position === "static") node.style.setProperty("position", "relative");
      node.style.setProperty("z-index", String(SCRIM_Z + 1), "important");
    }
    return raised;
  }

  function placeSpotlight(el: SearchBox) {
    const width = Math.min(SPOTLIGHT_WIDTH, Math.round(window.innerWidth * 0.88));
    const frame = containingBlock?.getBoundingClientRect();

    el.style.setProperty("--pear-spotlight-left", `${Math.round((window.innerWidth - width) / 2) - (frame?.left ?? 0)}px`);
    el.style.setProperty("--pear-spotlight-top", `${Math.round(window.innerHeight * SPOTLIGHT_TOP) - (frame?.top ?? 0)}px`);
    el.style.setProperty("--pear-spotlight-width", `${width}px`);
  }

  function onSpotlightResize() {
    if (spotlightEl) placeSpotlight(spotlightEl);
  }

  function exitSpotlight() {
    const el = spotlightEl;
    if (!el) {
      scrim?.removeAttribute("data-open");
      return;
    }

    window.removeEventListener("resize", onSpotlightResize);
    el.classList.remove("pear-spotlight");
    el.style.removeProperty("--pear-spotlight-left");
    el.style.removeProperty("--pear-spotlight-top");
    el.style.removeProperty("--pear-spotlight-width");
    spotlightEl = undefined;

    for (const entry of lifted) {
      if (entry.positioned) entry.el.style.removeProperty("position");
      entry.el.style.removeProperty("z-index");
      if (entry.zIndex) entry.el.style.setProperty("z-index", entry.zIndex, entry.zPriority);
    }
    lifted = [];
    containingBlock = undefined;

    scrim?.removeAttribute("data-open");

    // Dismissing the overlay discards the command line with it.
    clearBox(el);
    log("spotlight: off");
  }

  function dismissSpotlight() {
    if (box) box.opened = false;
    exitSpotlight();
  }

  function enterSpotlight(el: SearchBox) {
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.id = "pear-spotlight-scrim";
      // YTM only watches taps on its own elements, so the scrim must close itself.
      ctx.listen(scrim, "mousedown", dismissSpotlight);
      document.body.append(scrim);
    }

    containingBlock = fixedContainingBlock(el);
    lifted = liftAboveScrim(el);
    placeSpotlight(el);

    el.classList.add("pear-spotlight");
    scrim.setAttribute("data-open", "");
    spotlightEl = el;
    window.addEventListener("resize", onSpotlightResize);
    log("spotlight: on");
  }

  /**
   * Spotlight-style summon: float the box over a dimmed page, already in command
   * mode, so the list is there to filter. Pressing the shortcut again closes it.
   */
  function openSearchBox() {
    const el = findSearchBox();
    if (!el) {
      log("shortcut: no search box on the page");
      return;
    }

    track(el);
    if (el.opened && isCommandLine(el.searchBoxInput.value)) {
      dismissSpotlight();
      return;
    }

    // A second summon after the box was reused starts from a clean, unlifted state.
    exitSpotlight();
    enterSpotlight(el);
    el.searchBoxInput.value = "/";
    // YTM's own open path: `openedChanged` focuses the input for us.
    el.opened = true;
    el.searchBoxInput.setSelectionRange(1, 1);
    markCommandLine(el);
    render();
    log("shortcut: opened the command box");
  }

  function onOpenShortcut(event: Event) {
    const key = event as KeyboardEvent;
    if (!openBind || key.repeat || !matchesKeybind(openBind, key)) return;
    // A plain-typed binding must never steal normal typing.
    if (isTypingTarget(key.target) && !key.ctrlKey && !key.metaKey && !key.altKey) return;

    key.preventDefault();
    key.stopImmediatePropagation();
    openSearchBox();
  }

  function applyConfig(next: ConfigOf<typeof schema>) {
    openBind = next.openShortcut ? parseKeybind(next.openKeybind) : undefined;
    if (next.openShortcut && !openBind) log("cannot parse the open keybind:", next.openKeybind);
  }

  function onDocumentKey(event: Event) {
    const key = event as KeyboardEvent;
    const el = boxFrom(event);
    if (!el || !isCommandLine(el.searchBoxInput.value)) return;

    if (key.key === "Enter") {
      const value = el.searchBoxInput.value;
      const picked = rows[selected];
      const name = tokenize(value)[0] ?? "";
      const command = getCommand(name);

      // Not a command we know about: leave the event alone and let YTM search.
      if (!picked && !command) return;

      // YTM binds Enter on `keypress`, so both events have to be stopped.
      key.preventDefault();
      key.stopImmediatePropagation();
      if (key.type !== "keydown") return;

      track(el);
      if (picked) {
        void accept(picked);
        return;
      }

      const args = tokenize(value)
        .slice(1)
        .filter((arg) => arg !== "");
      // A command that wrote back into the box has not consumed the line.
      let inserted = false;
      void command?.run(
        args,
        commandContext(() => {
          inserted = true;
        }),
      );

      if (!inserted) {
        clearBox(el);
        dismissSpotlight();
      }
      return;
    }

    // Tab completes the highlighted row, or the first one. Swallowed either way,
    // so focus cannot leave the box mid-command — YTM otherwise cycles the
    // search, clear and guide buttons on Tab.
    if (key.key === "Tab" && !key.shiftKey) {
      key.preventDefault();
      key.stopImmediatePropagation();
      if (key.type !== "keydown") return;

      const picked = rows[selected] ?? rows[0];
      if (!picked) return;

      track(el);
      void accept(picked);
      return;
    }

    if (key.key !== "ArrowUp" && key.key !== "ArrowDown") return;
    if (key.type !== "keydown") return;

    key.preventDefault();
    key.stopImmediatePropagation();
    track(el);
    moveSelection(key.key === "ArrowUp" ? -1 : 1);
  }

  const listeners: [string, (event: Event) => void][] = [
    ["input", onDocumentInput],
    ["keydown", onOpenShortcut],
    ["keydown", onDocumentKey],
    ["keypress", onDocumentKey],
    ["ytmusic-suggestion-activated", onSuggestionActivated],
  ];
  for (const [type, listener] of listeners) ctx.listen(document, type, listener, { capture: true });

  ctx.onConfigChange((next) => applyConfig(next));
  applyConfig(ctx.config);

  return () => {
    for (const off of unregister) off();
    release();
    if (spotlightEl) {
      if (box) box.opened = false;
      exitSpotlight();
    }
    window.removeEventListener("resize", onSpotlightResize);
    unwatch();
    scrim?.remove();
    scrim = undefined;
    box = undefined;
    openBind = undefined;
  };
}
