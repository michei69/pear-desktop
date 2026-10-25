// The Flags section: Music's experiment flags, with the values the page
// is running and the user's overrides. The overrides are the core "site"
// section's `siteFlags` list (so they persist) and are also applied live through
// the page runtime (so a change shows without a restart).

import { type FlagValue, type Flags, flagOverrides, withFlagOverride } from "@pear/sdk/core-config";
import type { FlagMetadataMap } from "@pear/sdk/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { Switch } from "../fields.tsx";
import { Icon } from "../icons.tsx";
import { useText } from "../strings.ts";
import { liveFeatureFlags } from "./live-flags.ts";
import type { Dialog } from "./state.ts";

/** A typed value when the text is JSON, the text itself when it is not. */
const parseValue = (text: string): FlagValue => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") return parsed;
  } catch {
    // Not JSON: the text is the value.
  }
  return text;
};

export function FlagsSection({ dialog, query }: { dialog: Dialog; query: string }) {
  const text = useText();
  const model = dialog.model;
  const [metadata, setMetadata] = useState<FlagMetadataMap>({});
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("true");

  useEffect(() => {
    let alive = true;
    model
      .flagMetadata()
      .then((next) => {
        if (alive) setMetadata(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [model]);

  const stored = (): string[] => {
    const list = model.core("site")?.config.siteFlags;
    return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : [];
  };
  const overrides = (): Flags => flagOverrides(stored());
  const served = (): Flags => model.siteFlags?.()?.served ?? {};
  const valueOf = (name: string): FlagValue | undefined => (Object.hasOwn(overrides(), name) ? overrides()[name] : served()[name]);

  const commit = (name: string, value: FlagValue | undefined) => {
    void model.setCoreConfig("site", { siteFlags: withFlagOverride(stored(), name, value) });
    const live = liveFeatureFlags();
    if (value === undefined) live?.remove(name);
    else live?.set(name, value);
    // The page applies it live; only flags the site says need one ask for a restart.
    if (metadata[name]?.requires_restart) dialog.restarts.flag(`site:${name}`);
  };

  const needle = query.trim().toLowerCase();
  const allNames = [...new Set([...Object.keys(served()), ...Object.keys(overrides())])].sort((a, b) => a.localeCompare(b));
  const names = needle ? allNames.filter((name) => name.toLowerCase().includes(needle)) : allNames;
  const canAdd = () => newName.trim().length > 0 && !allNames.includes(newName.trim());

  const add = () => {
    if (!canAdd()) return;
    const name = newName.trim();
    commit(name, parseValue(newValue));
    setNewName("");
    setNewValue("true");
  };

  return (
    <div class="flags">
      {/* Shown every time the section is opened, never dismissed for good. */}
      <div class="flags-warning" role="alert">
        <Icon name="warning" />
        <span>{text("settings-ui.flags.warning")}</span>
      </div>

      <div class="flags-add">
        <input
          class="text flags-add-name"
          type="text"
          spellcheck={false}
          aria-label={text("settings-ui.flags.add-name")}
          placeholder={text("settings-ui.flags.add-name")}
          value={newName}
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <input
          class="text flags-add-value"
          type="text"
          spellcheck={false}
          aria-label={text("settings-ui.flags.add-value")}
          placeholder="true"
          title={text("settings-ui.flags.add-value-hint")}
          value={newValue}
          onInput={(e) => setNewValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" class="field-button" disabled={!canAdd()} onClick={add}>
          {text("settings-ui.flags.add")}
        </button>
      </div>

      {names.length === 0 ? (
        <div class="empty">{needle ? text("settings-ui.flags.no-match", { query: query.trim() }) : text("settings-ui.flags.empty")}</div>
      ) : (
        <div class="card">
          {names.map((name) => (
            <FlagRow
              key={name}
              name={name}
              value={valueOf(name)}
              metadata={metadata[name]}
              overridden={Object.hasOwn(overrides(), name)}
              onCommit={(value) => commit(name, value)}
              onUndo={() => commit(name, undefined)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FlagRow(props: {
  name: string;
  value: FlagValue | undefined;
  metadata: { description?: string; requires_restart: boolean; family: string } | undefined;
  overridden: boolean;
  onCommit(value: FlagValue): void;
  onUndo(): void;
}) {
  const text = useText();
  const boolean = typeof props.value === "boolean" || props.value === undefined;
  const shown = typeof props.value === "boolean" ? String(props.value) : (JSON.stringify(props.value) ?? "null");
  const [draft, setDraft] = useState(shown);
  const draftFor = useRef(shown);
  // Follow values from outside (the page's flag arriving, an undo).
  useEffect(() => {
    if (draftFor.current === shown) return;
    draftFor.current = shown;
    setDraft(shown);
  }, [shown]);

  return (
    <div class="field flag-row" data-flag={props.name}>
      <div class="field-row">
        <div class="field-text">
          <div class="label-line">
            <span class="field-label flags-name">{props.name}</span>
            {props.metadata?.family && <span class="pill flags-family">{props.metadata.family}</span>}
            {props.metadata?.requires_restart && (
              <span class="pill" title={text("settings-ui.restart-pill-hint")}>
                {text("settings-ui.restart-pill")}
              </span>
            )}
            {props.overridden && <span class="pill">{text("settings-ui.flags.overridden")}</span>}
          </div>
          {props.metadata?.description && <div class="field-desc">{props.metadata.description}</div>}
        </div>

        {boolean && <Switch checked={props.value === true} label={props.name} onChange={(on) => props.onCommit(on)} />}
        <button
          type="button"
          class="field-button flags-undo"
          disabled={!props.overridden}
          title={text("settings-ui.flags.undo-hint")}
          onClick={props.onUndo}
        >
          {text("settings-ui.flags.undo")}
        </button>
      </div>

      {!boolean && (
        <div class="field-control">
          <input
            class="text"
            type="text"
            spellcheck={false}
            aria-label={props.name}
            value={draft}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onChange={(e) => {
              const next = e.currentTarget.value;
              draftFor.current = next;
              props.onCommit(parseValue(next));
            }}
            onBlur={() => setDraft(shown)}
          />
        </div>
      )}
    </div>
  );
}
