// The settings dialog: a sidebar with search and sections and the selected
// section's cards. Shared by the in-page overlay and the standalone settings
// window.

import { useEffect, useRef, useState } from "preact/hooks";
import type { SettingsModel } from "./model.ts";
import { SearchResults, SectionBody } from "./settings/body.tsx";
import { Header, RestartBanner, Sidebar } from "./settings/chrome.tsx";
import { buildDebugInfo, storedFlagOverrides, useCopyFeedback } from "./settings/debug-info.ts";
import { FlagsSection } from "./settings/flags.tsx";
import { SECTIONS, type SectionId, sectionLabel } from "./settings/sections.ts";
import { useDialog } from "./settings/state.ts";
import { TranslateContext, useText } from "./strings.ts";

export type { SettingsModel } from "./model.ts";

interface SettingsProps {
  model: SettingsModel;
  onClose(): void;
  standalone?: boolean;
  /** Set while the exit animation plays; the renderer unmounts afterwards. */
  closing?: boolean;
}

/** What the user last dragged the dialog and its sidebar to. */
interface Layout {
  width?: number;
  height?: number;
  sidebarWidth?: number;
}

/** Sizes survive closing and reopening the dialog in this session, like pear-desktop's. */
let rememberedLayout: Layout = {};

/** Resize bounds; the dialog's sit inside the stylesheet's 100vw - 40px cap. */
const MODAL_MIN_WIDTH = 520;
const MODAL_MIN_HEIGHT = 360;
const MODAL_MARGIN = 40;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function Settings(props: SettingsProps) {
  return (
    <TranslateContext.Provider value={props.model.t}>
      <SettingsDialog {...props} />
    </TranslateContext.Provider>
  );
}

function SettingsDialog({ model, onClose, standalone = false, closing = false }: SettingsProps) {
  const dialog = useDialog(model);
  const text = useText();
  const debug = useCopyFeedback();
  const [active, setActive] = useState<SectionId>("general");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<Layout>(rememberedLayout);
  const search = useRef<HTMLInputElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => search.current?.focus(), []);

  // Escape closes, from anywhere in the dialog. Captured because the overlay's
  // host stops YTM's global shortcuts by stopping key events as they bubble.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const trimmed = query.trim();
  const isFlags = active === "flags";
  const searching = trimmed !== "" && !isFlags;
  const view = searching ? "search" : active;
  // Another section, or the search results, starts at the top, not where the last one was scrolled to.
  useEffect(() => body.current?.scrollTo(0, 0), [view]);

  const section = SECTIONS[active];
  const title = searching ? text("settings-ui.search-results") : sectionLabel(text, active);
  const sub = searching ? text("settings-ui.search-matching", { query: trimmed }) : undefined;
  const enabled = dialog.plugins.filter((plugin) => model.state(plugin.id)?.enabled).map((plugin) => plugin.name);
  const showSection = (id: SectionId) => {
    setActive(id);
    setQuery("");
    dialog.collapse();
  };
  const patchLayout = (patch: Layout) =>
    setLayout((current) => {
      rememberedLayout = { ...current, ...patch };
      return rememberedLayout;
    });

  // Apply the remembered sizes; the stylesheet's defaults stand in until there are any.
  useEffect(() => {
    if (sidebar.current) sidebar.current.style.width = layout.sidebarWidth ? `${layout.sidebarWidth}px` : "";
  }, [layout.sidebarWidth]);
  useEffect(() => {
    if (!modal.current || standalone) return;
    modal.current.style.width = layout.width ? `${layout.width}px` : "";
    modal.current.style.height = layout.height ? `${layout.height}px` : "";
  }, [layout.width, layout.height, standalone]);

  /**
   * Runs `onMove` for every pointer event of the drag, on the grip itself:
   * pointer capture keeps it reporting once the cursor leaves the window.
   */
  const trackDrag = (event: PointerEvent, onMove: (move: PointerEvent) => void) => {
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    grip.setPointerCapture(event.pointerId);

    const stop = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", stop);
      grip.removeEventListener("pointercancel", stop);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", stop);
    grip.addEventListener("pointercancel", stop);
  };

  /**
   * Drag the (invisible) bottom-right grip. The dialog is centred, so growing it
   * by `w` moves that corner only `w / 2`: doubling the pointer delta keeps the
   * corner under the cursor.
   */
  const startCornerDrag = (event: PointerEvent) => {
    const startX = event.clientX;
    const startY = event.clientY;
    const box = modal.current?.getBoundingClientRect();
    const startWidth = box?.width ?? 0;
    const startHeight = box?.height ?? 0;

    trackDrag(event, (move) => {
      patchLayout({
        width: clamp(startWidth + (move.clientX - startX) * 2, MODAL_MIN_WIDTH, window.innerWidth - MODAL_MARGIN),
        height: clamp(startHeight + (move.clientY - startY) * 2, MODAL_MIN_HEIGHT, window.innerHeight - MODAL_MARGIN),
      });
    });
  };

  /** The sidebar is flush with the dialog's left edge, so it tracks the cursor 1:1. */
  const startSidebarDrag = (event: PointerEvent) => {
    const startX = event.clientX;
    const startWidth = sidebar.current?.getBoundingClientRect().width ?? 0;

    trackDrag(event, (move) => {
      patchLayout({
        sidebarWidth: clamp(startWidth + move.clientX - startX, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
      });
    });
  };

  const copyDebug = async () => {
    try {
      const meta = await model.appMeta();
      const live = model.siteFlags?.();
      const performanceMode = model.core("advanced")?.config.performanceMode === true;
      debug.copy(buildDebugInfo(meta, enabled, live?.served ?? {}, live?.overrides ?? storedFlagOverrides(model), performanceMode));
    } catch (error) {
      console.error("[pear] reading the debug info failed", error);
    }
  };

  return (
    <div class={`root${standalone ? " root--standalone" : ""}${closing ? " root--closing" : ""}`}>
      {!standalone && <div class="scrim" onMouseDown={onClose} />}
      <div class="dialog" role="dialog" aria-modal={!standalone} aria-labelledby="pear-title" ref={modal}>
        <Sidebar
          dialog={dialog}
          query={query}
          onQuery={setQuery}
          current={searching ? undefined : active}
          onSection={showSection}
          enabledCount={enabled.length}
          searchRef={search}
          sidebarRef={sidebar}
          onResizeStart={startSidebarDrag}
          onVersionClick={() => void copyDebug()}
          copied={debug.copied}
        />
        <section class="main">
          <Header title={title} sub={sub} onClose={standalone ? undefined : onClose} />
          <div class="body" ref={body}>
            <RestartBanner restarts={dialog.restarts} onRestart={() => void model.relaunch()} />
            {searching ? (
              <SearchResults dialog={dialog} query={trimmed} />
            ) : isFlags ? (
              <FlagsSection dialog={dialog} query={trimmed} />
            ) : (
              <SectionBody dialog={dialog} section={section} enabled={enabled} />
            )}
          </div>
        </section>
        {!standalone && <div class="modal-resizer" onPointerDown={startCornerDrag} />}
      </div>
    </div>
  );
}
