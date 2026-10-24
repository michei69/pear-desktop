/** @jsxImportSource @pear/sdk */
import { definePlugin, type PageContextOf } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const SIDEBAR = "sidebar";
const DIALOG = "dialog";
const SIDEBAR_ROW = "ytmusic-guide-entry-renderer";
const DIALOG_ROW = "ytmusic-playlist-add-to-option-renderer";

type Ctx = PageContextOf<{}>;

const style = css`
  .pear-pls-wrapper {
    position: relative;
    padding: 8px 16px;
  }
  #pear-pls-dialog-wrapper {
    margin-top: 10px;
  }
  .pear-pls-input {
    border: none;
    height: 40px;
    width: 192px;
    padding: 8px 0 8px 10px;
    box-sizing: border-box;
    font-family: inherit;
    font-size: 14px;
    text-indent: 35px;
    background-color: transparent;
    color: rgba(255, 255, 255, 0.87);
    border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    transition: border-bottom-color 0.6s ease;
  }
  .pear-pls-input::placeholder {
    color: rgba(154, 152, 152, 0.93);
    font-size: 14px;
    font-weight: 400;
  }
  .pear-pls-input:focus {
    border-bottom-color: rgba(255, 255, 255, 0.87);
    outline: none;
  }
  .pear-pls-no-results-message {
    padding: 24px;
    text-align: center;
    color: rgba(154, 152, 152, 0.93);
    font-size: 14px;
  }
  .pear-pls-no-results-message[hidden] {
    display: none;
  }
  #pear-pls-sidebar-no-results-message {
    padding: 16px;
    font-size: 12px;
  }
  .pear-pls-search-icon {
    position: absolute;
    top: 50%;
    left: 28px;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    color: rgba(154, 152, 152, 0.93);
  }
  .pear-pls-search-icon svg {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
`;

interface SearchOptions {
  /** Prefix of the elements' ids (`pear-pls-<id>-…`) and their names in the CSS. */
  id: string;
  rowSelector: string;
  rowTitle(row: Element): string;
  /** The list the rows live in. */
  container(): HTMLElement | null;
  placeInput(element: Element): void;
  placeNoResults(element: Element): void;
  /** Hide the whole list (not just its rows) when nothing matches, e.g. in the dialog. */
  hideContainerWhenEmpty: boolean;
}

interface Search {
  readonly input: HTMLInputElement;
  apply(): void;
  reset(): void;
}

const MAGNIFIER = "M16.296 16.996a8 8 0 11.707-.708l3.909 3.91-.707.707-3.909-3.909zM18 11a7 7 0 00-14 0 7 7 0 1014 0z";

/** One search box: a persisted input, its "no results" note and the row filter. */
function createSearch(ctx: Ctx, options: SearchOptions): Search {
  const placeholder = ctx.t("plugins.playlist-search.templates.search-placeholder", "Search playlists");
  const noResultsText = ctx.t("plugins.playlist-search.templates.no-results", "No playlists found");

  const input = (
    <input class="pear-pls-input" id={`pear-pls-${options.id}-search-input`} type="search" autocomplete="off" placeholder={placeholder} />
  ) as HTMLInputElement;

  const wrapper = (
    <div class="pear-pls-wrapper" id={`pear-pls-${options.id}-wrapper`}>
      <span class="pear-pls-search-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          ref={(svg) => {
            svg.setAttribute("width", "24");
            svg.setAttribute("height", "24");
          }}
          fill="currentColor"
          aria-hidden="true"
        >
          <path d={MAGNIFIER} clip-rule="evenodd" fill-rule="evenodd" stroke="currentColor" stroke-width="0.5" />
        </svg>
      </span>
      {input}
    </div>
  );

  const noResults = (
    <div class="pear-pls-no-results-message" id={`pear-pls-${options.id}-no-results-message`} hidden>
      {noResultsText}
    </div>
  );

  const apply = () => {
    const container = options.container();
    const term = input.value.toLowerCase().trim();
    let visible = 0;

    for (const row of container?.querySelectorAll<HTMLElement>(options.rowSelector) ?? []) {
      const matches = term.length === 0 || options.rowTitle(row).toLowerCase().includes(term);
      row.style.display = matches ? "" : "none";
      if (matches) visible++;
    }

    const empty = term.length > 0 && visible === 0;
    noResults.hidden = !empty;
    if (options.hideContainerWhenEmpty && container) container.style.display = empty ? "none" : "";
  };

  // ctx.mount puts the input back when YTM re-renders the section or the dialog,
  // and takes it away when the plugin stops.
  ctx.mount(wrapper, (element) => options.placeInput(element));
  ctx.mount(noResults, (element) => options.placeNoResults(element));
  ctx.listen(input, "input", apply);

  return {
    input,
    apply,
    reset() {
      input.value = "";
      apply();
    },
  };
}

export default definePlugin({
  id: "playlist-search",
  name: "Playlist search",
  description: "Adds search boxes to the sidebar's playlists and to the add-to-playlist dialog.",
  authors: ["Milano Slesarik", "michei69"],
  style,
  page: (ctx) => {
    const sidebar = createSearch(ctx, {
      id: SIDEBAR,
      rowSelector: SIDEBAR_ROW,
      rowTitle: (row) => row.querySelector(".title")?.textContent ?? "",
      container: () => ctx.$("guide.playlist_items"),
      placeInput: (element) => ctx.$("guide.new_playlist_button")?.after(element),
      placeNoResults: (element) => ctx.$("guide.playlist_items")?.after(element),
      hideContainerWhenEmpty: false,
    });

    const dialog = createSearch(ctx, {
      id: DIALOG,
      rowSelector: DIALOG_ROW,
      rowTitle: (row) => {
        const title = row.querySelector("#title");
        return title?.getAttribute("title") ?? title?.textContent ?? "";
      },
      container: () => ctx.$("dialog.add_to_playlist_items"),
      placeInput: (element) => ctx.$("dialog.add_to_playlist_heading")?.after(element),
      placeNoResults: (element) => ctx.$("dialog.add_to_playlist_items")?.after(element),
      hideContainerWhenEmpty: true,
    });

    // Reset the dialog's filter when it closes; focus it when it opens.
    let dialogOpen = false;
    const syncDialog = () => {
      const renderer = ctx.$("dialog.add_to_playlist");
      const paper = renderer?.closest("tp-yt-paper-dialog");
      const hidden =
        paper instanceof HTMLElement && (paper.hidden || paper.style.display === "none" || paper.getAttribute("aria-hidden") === "true");
      const open = !!renderer && !hidden;
      if (open === dialogOpen) return;
      dialogOpen = open;
      if (!open) {
        dialog.reset();
        return;
      }
      dialog.apply();
      dialog.input.focus();
    };

    // Rows (and the dialog) are re-rendered by YTM; coalesce bursts into one pass.
    let pending: ReturnType<typeof setTimeout> | undefined;
    ctx.observe("app", { childList: true, subtree: true }, () => {
      if (pending !== undefined) return;
      pending = ctx.setTimeout(() => {
        pending = undefined;
        syncDialog();
        sidebar.apply();
        dialog.apply();
      }, 50);
    });

    syncDialog();

    ctx.onCleanup(() => {
      ctx.clearTimeout(pending);
      pending = undefined;
      for (const [container, rowSelector] of [
        [ctx.$("guide.playlist_items"), SIDEBAR_ROW],
        [ctx.$("dialog.add_to_playlist_items"), DIALOG_ROW],
      ] as const) {
        if (!container) continue;
        container.style.display = "";
        for (const row of container.querySelectorAll<HTMLElement>(rowSelector)) row.style.display = "";
      }
    });
  },
});
