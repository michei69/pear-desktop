// Cards: a core section's field groups, a plugin's card, the developer tools.

import type { ConfigShape } from "@pear/sdk";
import { CORE_SECTIONS, type CoreSection } from "@pear/sdk/core-config";
import type { PluginInfo } from "@pear/sdk/protocol";
import { remoteErrorMessage } from "@pear/sdk/util";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { SettingsField, Switch } from "../fields.tsx";
import { Icon } from "../icons.tsx";
import type { SettingsModel } from "../model.ts";
import { useText } from "../strings.ts";
import { type FieldFilter, type Group, groupFields, hasFields } from "./groups.ts";
import { type Block, joinTitles } from "./sections.ts";
import type { Dialog } from "./state.ts";
import { ThemeCard } from "./themes.tsx";

export function CardGroup(props: { title: string | undefined; children: ComponentChildren; "data-core"?: string }) {
  return (
    <div class="group" data-core={props["data-core"]}>
      {props.title && <div class="group-title">{props.title}</div>}
      <div class="card">{props.children}</div>
    </div>
  );
}

/** A core section's field groups, if the host has its state; `exclude` leaves out fields shown elsewhere. */
export function coreGroups(dialog: Dialog, section: CoreSection, filter?: FieldFilter, exclude?: readonly string[]): Group[] {
  if (!dialog.model.core(section)) return [];
  const keep = (key: string, field: Parameters<FieldFilter>[1]) => !exclude?.includes(key) && (!filter || filter(key, field));
  return groupFields(CORE_SECTIONS[section] as ConfigShape, dialog.platform, dialog.localizer("core"), keep);
}

/** Some of a core section's fields, keeping their declared groups. */
export function coreKeyGroups(dialog: Dialog, section: CoreSection, keys: readonly string[]): Group[] {
  const shape = CORE_SECTIONS[section] as ConfigShape;
  const subset = Object.fromEntries(keys.flatMap((key) => (shape[key] ? [[key, shape[key]]] : [])));
  return groupFields(subset, dialog.platform, dialog.localizer("core"));
}

/**
 * One card per field group; the first one also says what the core is doing with
 * the section. `joinTitle` prefixes the section's name, for search results.
 */
export function CoreCards(props: {
  dialog: Dialog;
  section: CoreSection;
  groups: Group[];
  title?: string | undefined;
  joinTitle?: boolean | undefined;
}) {
  const { dialog, section } = props;
  const text = useText();
  const state = dialog.model.core(section);
  if (!state) return null;
  const status = state.error ?? text("settings-ui.api-server-status", { address: state.status });
  return (
    <>
      {props.groups.map((group, index) => (
        <CardGroup
          key={`${section}-${index}`}
          title={props.joinTitle ? joinTitles(props.title, group.title) : (group.title ?? props.title)}
          data-core={section}
        >
          {group.fields.map(([key, field]) => (
            <SettingsField
              key={key}
              name={`core-${section}-${key}`}
              field={field}
              value={state.config[key]}
              model={dialog.model}
              onChange={(value) => dialog.setCore(section, key, field, value)}
            />
          ))}
          {index === 0 && (state.status || state.error) && (
            <div class="card-status" data-status={state.status ? "" : undefined} data-error={state.error ? "" : undefined}>
              {status}
            </div>
          )}
        </CardGroup>
      ))}
    </>
  );
}

export function BlockView({ dialog, block }: { dialog: Dialog; block: Block }) {
  const text = useText();
  switch (block.kind) {
    case "core": {
      const title = block.title && text(block.title);
      return (
        <CoreCards
          dialog={dialog}
          section={block.section}
          groups={coreGroups(dialog, block.section, undefined, block.exclude)}
          title={title}
          joinTitle={block.prefix}
        />
      );
    }
    case "core-keys": {
      const title = block.title && text(block.title);
      return <CoreCards dialog={dialog} section={block.section} groups={coreKeyGroups(dialog, block.section, block.keys)} title={title} />;
    }
    case "plugin": {
      const plugin = dialog.plugins.find((p) => p.id === block.id);
      return plugin ? (
        <div class="group">
          <div class="group-title">{text(block.title)}</div>
          <PluginCard dialog={dialog} plugin={plugin} />
        </div>
      ) : null;
    }
    case "themes":
      return <ThemeCard dialog={dialog} />;
    case "updates":
      // Dev builds have no updater, so the options do nothing there.
      return dialog.model.app.channel === "dev" ? null : (
        <CoreCards dialog={dialog} section="general" groups={coreKeyGroups(dialog, "general", ["autoUpdates", "updateChannel"])} />
      );
    case "configuration":
      return (
        <CardGroup title={text("settings-ui.blocks.configuration")}>
          <div class="field actions">
            <button type="button" class="outlined" onClick={() => void dialog.model.toggleDevTools()}>
              {text("settings-ui.toggle-devtools")}
            </button>
            <button type="button" class="outlined" onClick={() => void dialog.model.editConfig()}>
              {text("settings-ui.edit-config")}
            </button>
          </div>
        </CardGroup>
      );
  }
}

export function PluginCard(props: {
  dialog: Dialog;
  plugin: PluginInfo;
  /** Open regardless of the expanded card (search results). */
  forceOpen?: boolean;
  /** The field groups to show; default: all of them (search results pass the matching ones). */
  groups?: Group[];
}) {
  const { dialog, plugin } = props;
  const { model } = dialog;
  const text = useText();
  const open = props.forceOpen ?? dialog.expanded === plugin.id;
  const state = model.state(plugin.id);
  const enabled = state?.enabled ?? false;
  const error = model.error(plugin.id);
  const status = model.status(plugin.id);
  const groups = props.groups ?? groupFields(plugin.config, dialog.platform, dialog.localizer(plugin.id));
  const actions = plugin.actions ?? [];
  const configurable = hasFields(plugin.config, dialog.platform) || actions.length > 0;
  const showActions = enabled && actions.length > 0;
  const hasBody = open && state && (groups.length > 0 || showActions);

  return (
    <section class="card plugin" data-plugin={plugin.id} data-open={open}>
      <div class="plugin-head">
        <button
          type="button"
          class="plugin-toggle"
          disabled={!configurable}
          aria-expanded={configurable ? open : undefined}
          aria-label={text("settings-ui.configure", { name: plugin.name })}
          onClick={() => dialog.toggleExpanded(plugin.id)}
        >
          <span class="field-text">
            <span class="label-line">
              <span class="field-label">{plugin.name}</span>
              {model.meta(plugin.id)?.restartRequired && (
                <span class="pill" title={text("settings-ui.restart-plugin-hint")}>
                  {text("settings-ui.restart-pill")}
                </span>
              )}
              {error && enabled && <span class="pill error">{text("settings-ui.error-pill")}</span>}
            </span>
            {plugin.description && <span class="field-desc">{plugin.description}</span>}
          </span>
          {configurable && <Icon name={open ? "chevronDown" : "chevronRight"} />}
        </button>
        <Switch
          checked={enabled}
          label={text("settings-ui.enable", { name: plugin.name })}
          onChange={(on) => dialog.setPluginEnabled(plugin, on)}
        />
      </div>
      {error && enabled && <p class="error-text">{error}</p>}
      {status && enabled && !error && (
        <p class="status-text" role="status">
          {status}
        </p>
      )}
      {hasBody && (
        <div class="plugin-body">
          {showActions && <PluginActions id={plugin.id} actions={actions} model={model} />}
          {groups.map((group, index) => (
            <div key={index} class="plugin-group">
              {group.title && <div class="plugin-group-title">{group.title}</div>}
              {group.fields.map(([key, field]) => (
                <SettingsField
                  key={key}
                  name={`${plugin.id}-${key}`}
                  field={field}
                  value={state.config[key]}
                  model={model}
                  onChange={(value) => dialog.setPluginConfig(plugin, key, field, value)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The plugin's settings buttons (e.g. "Connect"); each runs its host command. */
function PluginActions(props: { id: string; actions: NonNullable<PluginInfo["actions"]>; model: SettingsModel }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const run = async (name: string) => {
    setBusy(name);
    setFailed(null);
    try {
      await props.model.runAction(props.id, name);
    } catch (error) {
      setFailed(remoteErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="plugin-group plugin-actions">
      {props.actions.map((action) => (
        <div key={action.name} class="field" data-action={action.name}>
          <div class="field-row">
            <div class="field-text">{action.description && <div class="field-desc">{action.description}</div>}</div>
            <button type="button" class="outlined" disabled={busy !== null} onClick={() => void run(action.name)}>
              {action.label}
            </button>
          </div>
        </div>
      ))}
      {failed && <p class="error-text">{failed}</p>}
    </div>
  );
}
