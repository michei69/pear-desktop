// What the dialog's body shows: a section, or the search results.

import { CORE_SECTIONS, type CoreSection } from "@pear/sdk/core-config";
import type { ComponentChildren } from "preact";
import { useText } from "../strings.ts";
import { About } from "./about.tsx";
import { BlockView, CoreCards, coreGroups, PluginCard } from "./cards.tsx";
import { fieldMatches, groupFields, matches } from "./groups.ts";
import { type Section, coreSectionLabel } from "./sections.ts";
import type { Dialog } from "./state.ts";

export function SectionBody({ dialog, section, enabled }: { dialog: Dialog; section: Section; enabled: string[] }) {
  switch (section.id) {
    case "plugins":
      return (
        <>
          {dialog.plugins.map((plugin) => (
            <PluginCard key={plugin.id} dialog={dialog} plugin={plugin} />
          ))}
        </>
      );
    case "about":
      // About owns its cards; the update options are drawn under its actions.
      return (
        <About model={dialog.model} enabled={enabled}>
          {section.blocks.map((block, index) => (
            <BlockView key={index} dialog={dialog} block={block} />
          ))}
        </About>
      );
    case "flags":
      // Rendered by the dialog itself, which owns the search box while it is open.
      return null;
    default:
      return (
        <>
          {section.blocks.map((block, index) => (
            <BlockView key={index} dialog={dialog} block={block} />
          ))}
        </>
      );
  }
}

/** Core fields and plugins matching `query`: a plugin by its name or description, or by its fields (shown open). */
export function SearchResults({ dialog, query }: { dialog: Dialog; query: string }) {
  const text = useText();
  const needle = query.toLowerCase();
  const filter = fieldMatches(needle);
  const results: ComponentChildren[] = [];

  for (const name of Object.keys(CORE_SECTIONS) as CoreSection[]) {
    // The site section has no card of its own; its flag list is edited in the Flags section.
    if (name === "site") continue;
    const groups = coreGroups(dialog, name, filter);
    if (groups.length === 0) continue;
    results.push(<CoreCards key={name} dialog={dialog} section={name} groups={groups} title={coreSectionLabel(text, name)} joinTitle />);
  }
  for (const plugin of dialog.plugins) {
    if (matches(needle, plugin.name, plugin.description, plugin.id)) {
      results.push(<PluginCard key={plugin.id} dialog={dialog} plugin={plugin} />);
      continue;
    }
    const groups = groupFields(plugin.config, dialog.platform, dialog.localizer(plugin.id), filter);
    if (groups.length > 0) results.push(<PluginCard key={plugin.id} dialog={dialog} plugin={plugin} forceOpen groups={groups} />);
  }

  if (results.length === 0) return <div class="empty">{text("settings-ui.no-match", { query })}</div>;
  return <>{results}</>;
}
