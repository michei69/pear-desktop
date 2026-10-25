// The dialog's frame: the sidebar (search, sections), the header and the restart banner.

import type { Ref } from "preact";
import { Icon } from "../icons.tsx";
import { useText } from "../strings.ts";
import { SECTION_ORDER, SECTIONS, type SectionId, sectionLabel } from "./sections.ts";
import type { Dialog, PendingRestarts } from "./state.ts";

export function Sidebar(props: {
  dialog: Dialog;
  query: string;
  onQuery(query: string): void;
  /** The section shown, or undefined while searching. */
  current: SectionId | undefined;
  onSection(id: SectionId): void;
  enabledCount: number;
  searchRef: Ref<HTMLInputElement>;
  sidebarRef: Ref<HTMLElement>;
  /** Drag the divider to resize the sidebar. */
  onResizeStart(event: PointerEvent): void;
  /** Copies the debug info, like the version button pear-desktop had. */
  onVersionClick(): void;
  copied: boolean;
}) {
  const { dialog } = props;
  const text = useText();
  return (
    <aside class="sidebar" ref={props.sidebarRef}>
      <div class="sidebar-resizer" onPointerDown={props.onResizeStart} />
      <div class="sidebar-head">
        <div class="sidebar-title" id="pear-title">
          {text("settings-ui.title")}
        </div>
      </div>
      <label class="search">
        <Icon name="search" />
        <input
          ref={props.searchRef}
          type="search"
          placeholder={props.current === "flags" ? text("settings-ui.flags.search-placeholder") : text("settings-ui.search-placeholder")}
          aria-label={text("settings-ui.search-placeholder")}
          value={props.query}
          onInput={(e) => props.onQuery(e.currentTarget.value)}
        />
      </label>
      <nav class="nav" aria-label={text("settings-ui.sections-label")}>
        {SECTION_ORDER.map((id) => {
          const section = SECTIONS[id];
          return (
            <button
              key={id}
              type="button"
              class="nav-item"
              aria-current={props.current === id ? "page" : undefined}
              onClick={() => props.onSection(id)}
            >
              <Icon name={section.icon} />
              <span class="nav-label">{sectionLabel(text, id)}</span>
              {id === "plugins" && (
                <span class="nav-count">
                  {props.enabledCount}/{dialog.plugins.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div class="sidebar-foot">
        <button type="button" class="sidebar-version" title={text("settings-ui.about.copy-debug")} onClick={props.onVersionClick}>
          {props.copied ? text("settings-ui.about.copied") : `v${dialog.model.app.version}`}
        </button>
        <button type="button" class="link-button" onClick={() => void dialog.model.showSettingsFile()}>
          {text("settings-ui.show-config")}
        </button>
      </div>
    </aside>
  );
}

/** The section's (or the search's) title; a close button unless the dialog is a window of its own. */
export function Header(props: { title: string; sub?: string | undefined; onClose: (() => void) | undefined }) {
  const text = useText();
  return (
    <header class="header">
      <div class="header-text">
        <div class="header-title">{props.title}</div>
        {props.sub && <div class="header-sub">{props.sub}</div>}
      </div>
      {props.onClose && (
        <button type="button" class="icon-button" aria-label={text("settings-ui.close")} onClick={props.onClose}>
          <Icon name="close" size={22} />
        </button>
      )}
    </header>
  );
}

/**
 * Stays mounted and collapses, so showing and hiding animate both the fade and
 * the space it takes; `inert` keeps the hidden buttons out of the tab order.
 */
export function RestartBanner({ restarts, onRestart }: { restarts: PendingRestarts; onRestart(): void }) {
  const text = useText();
  return (
    <div class={`restart${restarts.show ? " restart-open" : ""}`} inert={!restarts.show}>
      <Icon name="schedule" />
      <span class="restart-text">{text("settings-ui.restart-banner")}</span>
      <button type="button" class="restart-later" onClick={restarts.dismiss}>
        {text("settings-ui.later")}
      </button>
      <button type="button" class="restart-now" onClick={onRestart}>
        {text("settings-ui.restart-now")}
      </button>
    </div>
  );
}
