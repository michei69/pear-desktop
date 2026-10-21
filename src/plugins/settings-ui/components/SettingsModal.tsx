import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { allPlugins, rendererPlugins } from 'virtual:plugins';

import { t } from '@/i18n';
import {
  restartRequirementKey,
  type RestartRequirement,
} from '@/types/restart';
import {
  toSettingsGroups,
  type SettingField,
  type SettingsGroup,
} from '@/types/settings';
import { clamp } from '@/utils/math';

import { AboutSection } from './AboutSection';
import { FlagsSection } from './FlagsSection';
import { Icon } from './Icon';
import { PluginCard } from './PluginCard';
import { SettingsField } from './SettingsField';

import { buildDebugInfo, useCopyFeedback } from '../debug-info';
import { getByPath } from '../paths';
import { filterGroupsByPlatform } from '../platform';
import { buildAppSections } from '../schema/app-settings';
import {
  bridge,
  flushPendingPluginSliderWrites,
  getAppValue,
  getPluginConfig,
  layout,
  patchLayout,
  setAppValue,
  setPluginSliderValue,
  setPluginValue,
  store,
  type PluginConfigMap,
  type StoreShape,
} from '../state';

interface PluginMeta {
  id: string;
  name: string;
  description?: string;
  restartNeeded: boolean;
  /** Always on, so its card shows settings without an enable switch. */
  essential: boolean;
  config: Record<string, unknown>;
  groups: SettingsGroup[];
}

const matches = (query: string, ...parts: (string | undefined)[]) =>
  parts.filter(Boolean).some((p) => p.toLowerCase().includes(query));

/** Resize bounds; the modal's sit inside the stylesheet's 100vw - 40px cap. */
const MODAL_MIN_WIDTH = 520;
const MODAL_MIN_HEIGHT = 360;
const MODAL_MARGIN = 40;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;

export const SettingsModal = (props: {
  onClose: () => void;
  /** Set while the exit animation plays; the renderer unmounts afterwards. */
  closing?: boolean;
  standalone?: boolean;
}) => {
  const [active, setActive] = createSignal<string>('general');
  const [query, setQuery] = createSignal('');
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [restartFlagged, setRestartFlagged] = createSignal(false);
  const [restartRequirements, setRestartRequirements] = createSignal<
    RestartRequirement[]
  >([]);
  const debugCopied = useCopyFeedback();
  let modalEl: HTMLDivElement | undefined;
  let sidebarEl: HTMLElement | undefined;
  let isClosing = false;
  let searchInputRef: HTMLInputElement | undefined;
  let previousFocus: HTMLElement | null = null;

  const [appSections] = createResource(() =>
    buildAppSections().map((section) => ({
      ...section,
      groups: filterGroupsByPlatform(section.groups),
    })),
  );
  const [appMeta] = createResource(() => bridge.appMeta());
  const [rendererDefs] = createResource(() => rendererPlugins());

  const [plugins] = createResource<PluginMeta[]>(async () => {
    const stubs = await allPlugins();
    return Object.entries(stubs)
      .map(([id, def]) => ({
        id,
        name: def.name?.() ?? id,
        description: def.description?.(),
        restartNeeded: Boolean(def.restartNeeded),
        essential: Boolean(def.essential),
        config: (def.config ?? { enabled: false }) as Record<string, unknown>,
        groups: def.settings
          ? filterGroupsByPlatform(toSettingsGroups(def.settings))
          : [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Resolve a `"<pluginId>.<name>"` custom field component. */
  const resolveComponent = (id: string) => {
    const dot = id.indexOf('.');
    if (dot < 0) return undefined;

    const renderer = rendererDefs()?.[id.slice(0, dot)]?.renderer;
    if (!renderer || typeof renderer === 'function') return undefined;

    return renderer.components?.[id.slice(dot + 1)];
  };

  onMount(() => {
    bridge.restartSessionOpen();

    // Move focus into the dialog, restoring it to the trigger on close.
    previousFocus = document.activeElement as HTMLElement | null;
    searchInputRef?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus?.();
      // The window can also go away without close() (the tray window's X, a
      // renderer reload); the main process would otherwise never show its
      // restart dialog again.
      bridge.restartSessionClose(restartRequirements());
    });
  });

  // Apply the remembered sizes; the stylesheet's defaults stand in until there
  // are any.
  createEffect(() => {
    const { height, sidebarWidth, width } = layout();
    if (sidebarEl)
      sidebarEl.style.width = sidebarWidth ? `${sidebarWidth}px` : '';
    if (!modalEl || props.standalone) return;
    modalEl.style.width = width ? `${width}px` : '';
    modalEl.style.height = height ? `${height}px` : '';
  });

  /**
   * Runs `onMove` for every pointer event of the drag, on the grip itself:
   * pointer capture keeps it reporting once the cursor leaves the window.
   */
  const trackDrag = (e: PointerEvent, onMove: (move: PointerEvent) => void) => {
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);

    const stop = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', stop);
      grip.removeEventListener('pointercancel', stop);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
  };

  /**
   * Drag the (invisible) bottom-right grip. The modal is centred, so growing it
   * by `w` moves that corner only `w / 2`: doubling the pointer delta keeps the
   * corner under the cursor.
   */
  const startCornerDrag = (e: PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const box = modalEl?.getBoundingClientRect();
    const startWidth = box?.width ?? 0;
    const startHeight = box?.height ?? 0;

    trackDrag(e, (move) => {
      patchLayout({
        width: clamp(
          startWidth + (move.clientX - startX) * 2,
          MODAL_MIN_WIDTH,
          window.innerWidth - MODAL_MARGIN,
        ),
        height: clamp(
          startHeight + (move.clientY - startY) * 2,
          MODAL_MIN_HEIGHT,
          window.innerHeight - MODAL_MARGIN,
        ),
      });
    });
  };

  /** The sidebar is flush with the modal's left edge, so it tracks the cursor 1:1. */
  const startSidebarDrag = (e: PointerEvent) => {
    const startX = e.clientX;
    const startWidth = sidebarEl?.getBoundingClientRect().width ?? 0;

    trackDrag(e, (move) => {
      patchLayout({
        sidebarWidth: clamp(
          startWidth + move.clientX - startX,
          SIDEBAR_MIN_WIDTH,
          SIDEBAR_MAX_WIDTH,
        ),
      });
    });
  };

  // ---- value plumbing ----
  /**
   * The merged config per plugin, reused until that plugin's stored config
   * changes. Every field of a card reads through `pluginVal`, so merging per
   * call would re-deep-merge the plugin's whole config per field per render.
   */
  const pluginConfigs = new Map<
    string,
    { source: unknown; merged: Record<string, unknown> }
  >();
  const pluginConfig = (snap: StoreShape, meta: PluginMeta) => {
    const source = (snap.plugins as PluginConfigMap)[meta.id];
    const cached = pluginConfigs.get(meta.id);
    if (cached && cached.source === source) return cached.merged;

    const merged = getPluginConfig(snap, meta.id, meta.config);
    pluginConfigs.set(meta.id, { source, merged });
    return merged;
  };

  const appVal = (key: string) => {
    const snap = store();
    return snap ? getAppValue(snap, key) : undefined;
  };
  const pluginVal = (meta: PluginMeta, key: string) => {
    const snap = store();
    if (!snap) return undefined;
    // Plugin keys are dotted paths (`scrobblers.lastfm.apiKey`).
    return getByPath(pluginConfig(snap, meta), key);
  };
  const isPluginEnabled = (meta: PluginMeta) => {
    const snap = store();
    const stored = snap
      ? (snap.plugins as Record<string, { enabled?: boolean }>)[meta.id]
      : undefined;
    return stored?.enabled ?? (meta.config.enabled as boolean);
  };

  const enabledPlugins = createMemo(() =>
    (plugins() ?? []).filter(isPluginEnabled),
  );

  /**
   * Only the changed field decides this: a plugin's own `restartNeeded` is about
   * enabling it (see onToggle), not its settings (crossfade needs a restart to
   * turn on, not to change a fade duration). Custom components may write below the
   * field's key (`presets.classical`).
   */
  const fieldNeedsRestart = (groups: SettingsGroup[], key: string): boolean =>
    groups.some((group) =>
      group.fields.some(
        (field) =>
          field.restartNeeded &&
          (key === field.key || key.startsWith(`${field.key}.`)),
      ),
    );

  const flagIfRestart = (requirement: RestartRequirement, needed?: boolean) => {
    if (!needed) return;

    setRestartFlagged(true);
    setRestartRequirements((current) =>
      current.some(
        (item) =>
          restartRequirementKey(item) === restartRequirementKey(requirement),
      )
        ? current
        : [...current, requirement],
    );
  };

  const close = async () => {
    if (isClosing) return;
    isClosing = true;

    // Flush debounced slider writes so recent changes are not lost.
    await flushPendingPluginSliderWrites();
    props.onClose();
    bridge.restartSessionClose(restartRequirements());
  };

  const closeNow = async () => {
    await flushPendingPluginSliderWrites();
    bridge.restart();
  };

  const sections = () => appSections() ?? [];
  const currentSection = () => sections().find((s) => s.id === active());

  const isSearching = () => query().trim().length > 0;

  const search = () => query().trim().toLowerCase();

  /** The flags section owns the search box while it is open. */
  const isFlags = () => active() === 'flags';

  /** Searching settings, as opposed to filtering the flags. */
  const isSearchMode = () => isSearching() && !isFlags();

  /**
   * Match a field by its own text, keeping only the groups that still have one.
   * Some `visible` callbacks read the settings store, so this runs on every
   * option write; returning a cached group while its visible fields are
   * unchanged keeps `<For>` from remounting the section and resetting its scroll
   * position.
   */
  const filteredGroups = new WeakMap<
    SettingsGroup,
    { fields: SettingField[]; group: SettingsGroup }
  >();
  const matchingGroups = (groups: SettingsGroup[]) =>
    groups.flatMap((group) => {
      const fields = group.fields.filter(
        (field) =>
          (field.visible?.() ?? true) &&
          matches(search(), field.label(), field.description?.()),
      );
      if (fields.length === 0) return [];

      const cached = filteredGroups.get(group);
      if (
        cached &&
        cached.fields.length === fields.length &&
        cached.fields.every((field, index) => field === fields[index])
      ) {
        return [cached.group];
      }

      const next =
        fields.length === group.fields.length ? group : { ...group, fields };
      filteredGroups.set(group, { fields, group: next });
      return [next];
    });

  // The flags section carries no groups, which is what keeps it out of here.
  const appMatches = createMemo(() =>
    sections().flatMap((section) =>
      matchingGroups(section.groups).map((group) => ({
        title: `${section.label()} · ${group.title?.() ?? ''}`,
        group,
      })),
    ),
  );

  const pluginMatches = createMemo(() =>
    (plugins() ?? []).flatMap((meta) => {
      const groups = matches(search(), meta.name, meta.description)
        ? meta.groups
        : matchingGroups(meta.groups);
      return groups.length ? [{ meta, groups }] : [];
    }),
  );

  const AppGroupView = (p: {
    title?: string;
    group: SettingsGroup;
    /** About groups use the About cards' title and row treatment. */
    about?: boolean;
  }) => (
    <div class="sui-group" classList={{ 'sui-group--about': p.about }}>
      <Show when={p.title}>
        <div class="sui-group__title">{p.title}</div>
      </Show>
      <div class="sui-group__card">
        <For each={p.group.fields.filter((field) => field.visible?.() ?? true)}>
          {(field) => (
            <SettingsField
              accessors={{ getValue: appVal, setValue: setAppValue }}
              field={field}
              onChange={(value) => {
                setAppValue(field.key, value);
                // The banner only needs the requirement, not the write's result.
                flagIfRestart(
                  { type: 'setting', label: field.label() },
                  field.restartNeeded,
                );
              }}
              resolveComponent={resolveComponent}
              value={appVal(field.key)}
            />
          )}
        </For>
      </div>
    </div>
  );

  const PluginCardView = (p: { meta: PluginMeta; groups: SettingsGroup[] }) => (
    <PluginCard
      description={p.meta.description}
      enabled={p.meta.essential || isPluginEnabled(p.meta)}
      essential={p.meta.essential}
      expanded={expanded().has(p.meta.id)}
      getValue={(key) => pluginVal(p.meta, key)}
      groups={p.groups}
      hasSettings={p.groups.length > 0}
      name={p.meta.name}
      onExpand={() =>
        setExpanded((current) => {
          const next = new Set(current);
          if (next.has(p.meta.id)) next.delete(p.meta.id);
          else next.add(p.meta.id);
          return next;
        })
      }
      onToggle={(enabled) => {
        bridge.pluginToggle(p.meta.id, enabled);
        flagIfRestart({ type: 'plugin', id: p.meta.id }, p.meta.restartNeeded);
      }}
      resolveComponent={resolveComponent}
      restartNeeded={p.meta.restartNeeded}
      setSliderValue={(key, value) => {
        setPluginSliderValue(p.meta.id, key, value);
        flagIfRestart(
          { type: 'plugin', id: p.meta.id },
          fieldNeedsRestart(p.groups, key),
        );
      }}
      setValue={(key, value) => {
        setPluginValue(p.meta.id, key, value);
        flagIfRestart(
          { type: 'plugin', id: p.meta.id },
          fieldNeedsRestart(p.groups, key),
        );
      }}
    />
  );

  return (
    <div
      class="sui-root"
      classList={{
        'sui-root--standalone': props.standalone,
        'sui-root--closing': props.closing,
      }}
    >
      <Show when={!props.standalone}>
        <div class="sui-scrim" onClick={close} />
      </Show>

      <div
        aria-modal="true"
        class="sui-modal"
        ref={(el) => {
          modalEl = el;
        }}
        role="dialog"
      >
        {/* sidebar */}
        <aside
          class="sui-sidebar"
          ref={(el) => {
            sidebarEl = el;
          }}
        >
          <div class="sui-sidebar__resizer" onPointerDown={startSidebarDrag} />
          <div class="sui-sidebar__head">
            <div class="sui-sidebar__title">{t('settings-ui.title')}</div>
          </div>

          <div class="sui-search">
            <Icon name="search" />
            <input
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder={
                isFlags()
                  ? t('settings-ui.flags.search-placeholder')
                  : t('settings-ui.search-placeholder')
              }
              ref={(el) => (searchInputRef = el)}
              type="text"
              value={query()}
            />
          </div>

          <nav class="sui-nav">
            <For each={sections()}>
              {(section) => (
                <button
                  class="sui-nav__item"
                  classList={{
                    'sui-nav__item--active':
                      !isSearchMode() && active() === section.id,
                  }}
                  onClick={() => {
                    setActive(section.id);
                    setQuery('');
                    // Switching sections starts them all collapsed again.
                    setExpanded(new Set<string>());
                  }}
                  type="button"
                >
                  <Icon name={section.icon} />
                  <span>{section.label()}</span>
                  <Show when={section.id === 'plugins'}>
                    <span class="sui-nav__count">
                      {enabledPlugins().length}/{(plugins() ?? []).length}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </nav>

          <div class="sui-sidebar__foot">
            <button
              class="sui-sidebar__version"
              onClick={() => {
                const meta = appMeta();
                if (meta) {
                  debugCopied.copy(
                    buildDebugInfo(
                      meta,
                      enabledPlugins().map((plugin) => plugin.name),
                      store()?.options.featureFlags ?? {},
                    ),
                  );
                }
              }}
              title={t('settings-ui.about.copy-debug')}
              type="button"
            >
              {debugCopied.copied()
                ? t('settings-ui.about.copied')
                : `v${appMeta()?.version ?? ''}`}
            </button>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                bridge.configEdit();
              }}
            >
              {t('settings-ui.edit-config')}
            </a>
          </div>
        </aside>

        {/* main */}
        <section class="sui-main">
          <header class="sui-header">
            <div class="sui-header__text">
              <div class="sui-header__title">
                {isSearchMode()
                  ? t('settings-ui.search-results')
                  : (currentSection()?.label() ?? '')}
              </div>
              <Show when={isSearchMode()}>
                <div class="sui-header__sub">
                  {t('settings-ui.search-matching', {
                    query: query().trim(),
                  })}
                </div>
              </Show>
            </div>
            <button
              aria-label={t('settings-ui.close')}
              class="sui-iconbtn"
              onClick={close}
              type="button"
            >
              <Icon name="close" size={22} />
            </button>
          </header>

          <div class="sui-body">
            {/* Always mounted so it can animate out; `inert` keeps the hidden
                buttons out of the tab order. */}
            <div
              class="sui-restart"
              classList={{ 'sui-restart--open': restartFlagged() }}
              inert={!restartFlagged()}
            >
              <Icon name="schedule" />
              <span class="sui-restart__text">
                {t('settings-ui.restart-banner')}
              </span>
              <button
                class="sui-restart__later"
                onClick={() => setRestartFlagged(false)}
                type="button"
              >
                {t('settings-ui.later')}
              </button>
              <button class="sui-restart__now" onClick={closeNow} type="button">
                {t('settings-ui.restart-now')}
              </button>
            </div>

            <Show fallback={<div class="sui-empty">…</div>} when={store()}>
              {/* search mode */}
              <Show when={isSearchMode()}>
                <Show
                  when={
                    appMatches().length === 0 && pluginMatches().length === 0
                  }
                >
                  <div class="sui-empty">
                    {t('settings-ui.no-match', { query: query().trim() })}
                  </div>
                </Show>
                <For each={appMatches()}>
                  {(block) => (
                    <AppGroupView group={block.group} title={block.title} />
                  )}
                </For>
                <For each={pluginMatches()}>
                  {(block) => (
                    <PluginCardView groups={block.groups} meta={block.meta} />
                  )}
                </For>
              </Show>

              {/* section mode */}
              <Show when={!isSearchMode()}>
                <Show when={active() !== 'about'}>
                  <For each={matchingGroups(currentSection()?.groups ?? [])}>
                    {(group) => (
                      <AppGroupView group={group} title={group.title?.()} />
                    )}
                  </For>
                </Show>

                <Show when={active() === 'plugins'}>
                  <For each={plugins()}>
                    {(meta) => (
                      <PluginCardView groups={meta.groups} meta={meta} />
                    )}
                  </For>
                </Show>

                <Show when={isFlags()}>
                  <FlagsSection
                    // A flag override is a setting to the restart banner and its
                    // dialog: both name the flag.
                    onChanged={(name, needsRestart) =>
                      flagIfRestart(
                        { type: 'setting', label: name },
                        needsRestart,
                      )
                    }
                    query={query()}
                  />
                </Show>

                <Show when={active() === 'about'}>
                  <AboutSection
                    enabledPlugins={enabledPlugins().map((p) => p.name)}
                    meta={appMeta()}
                  >
                    {/* Update settings live under the "Check for updates"
                        button rather than above the app logo. */}
                    <For each={matchingGroups(currentSection()?.groups ?? [])}>
                      {(group) => (
                        <AppGroupView
                          about
                          group={group}
                          title={group.title?.()}
                        />
                      )}
                    </For>
                  </AboutSection>
                </Show>
              </Show>
            </Show>
          </div>
        </section>

        <Show when={!props.standalone}>
          <div class="sui-modal__resizer" onPointerDown={startCornerDrag} />
        </Show>
      </div>
    </div>
  );
};
