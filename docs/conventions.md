# Conventions

## Commit messages

The history follows [Conventional Commits](https://www.conventionalcommits.org/).
New commits should keep doing so, because the changelog is generated from commit subjects.

```
<type>(<optional scope>): <subject>

<body: why this change>

<trailers>
```

- `type` is one of `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert`.
- `scope` is the plugin id or the subsystem (e.g. `fix(synced-lyrics)`)
- The subject is imperative and does not end with a period: `add plugin that skips explicit songs`, not `Added plugin`.
- The body explains the problem and the chosen fix. Bullet lists are common and welcome when a change has several parts.
- Trailers go either in a parantheses `fix: something something (#123)` (only referencing), or after a blank line: `Closes #123`, `ref: #123`, etc. When utilizing an AI agent, please mention it either via `Co-authored-by:` or `Assisted-by:` (e.g. `Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>`, `Assisted-by: MiMo V2.6 Pro`)
- One logical change per commit. Do not mix a refactor, a dependency bump and a feature. Formatting-only changes are usually separate (`style:`/`chore:`).
- Upstream work is merged with merge commits so provenance and credits are preserved.

Work-in-progress commits (`wip(scope): ...`) exist on topic branches. They are fine while iterating, but refrain from overusing them.

## User-facing text and translations

**Any string a normal user can see in-app must come from the translation files.** A feature that surfaces text without an English entry is incomplete, even if it works.

- Use `t` from `@/i18n`. Do not hardcode language strings in your work.
- Add the English string to `src/i18n/resources/en.json`. English is the required baseline; translations in other locales are optional and are normally supplied later either through Weblate, LLM generations, or future PRs/commits
- Labels and descriptions are passed as functions (`() => t(...)`), not computed strings, because the language can change at runtime without a reload.

```ts
name: () => t('plugins.my-plugin.name'),
description: () => t('plugins.my-plugin.description'),
```

Key layout:

| Prefix                      | Used for                                                   |
| --------------------------- | ---------------------------------------------------------- |
| `plugins.<id>.*`            | A plugin's name, description, menu and settings strings    |
| `settings-ui.*`             | The settings UI plugin itself (top-level, not under `plugins`) |
| `main.*`                    | Main-process strings: dialogs, native menu, tray, console  |
| `common.*`                  | Shared strings such as plugin-loader console messages      |
| `language.*`                | The locale metadata block (`code`, `name`, `local-name`)   |

- Leaf keys are lower-case kebab-case: `show-button`, `smoothness-transition`.
- Interpolate with i18next syntax: `t('...', { pluginName: id })` against `"Failed to load plugin \"{{pluginName}}\""`. There are currently no plural forms in the resources. (TODO)
- Console messages that describe app state are sometimes translated too (`common.console.plugins.*`). They're not a requirement though.
- Do not rename or delete a key that code still references. When an option is removed, remove its key in the same change.
- Every language resource carries the metadata block, so the language menus can render without loading the file's translations:

```json
"language": { "code": "en", "local-name": "English", "name": "English" }
```

- When adding a new language, you should also verify it's existence in youtube's own i18n. Update `src/providers/language-sync.ts` accordingly.

## TypeScript and code style

Formatting is [oxfmt](https://oxc.rs/), linting is oxlint with type-aware rules, and both run over `src/` only:

```bash
pnpm format        # write
pnpm format:check  # verify
pnpm lint          # oxlint --type-aware src
pnpm typecheck     # tsc --noEmit
pnpm check         # lint + format:check + typecheck
```

Other naming and layout conventions:

- Plugin ids and plugin folders are lower-case kebab-case and match: `src/plugins/synced-lyrics/` has id `synced-lyrics` and config under `plugins.synced-lyrics`.
- Reactivity-free UI helpers stay `.ts`; Solid components are `.tsx` and PascalCase (`SettingsModal.tsx`).
- App-wide types live in `src/types/`; a plugin's own config/type aliases live either in its `types.ts` or in its `index.ts` when small.
- IPC channels are namespaced strings: `peard:<kebab-case>` for the app. Plugins should preferably use `peard-<plugin-slug>:<kebab-case>`.
- Comments explain *why*, not *what*. Non-obvious workarounds, timing constraints and rejected alternatives get a short comment; trivial code does not. JSDoc exported functions whose contract is not obvious.
- Keep the public surface of a module explicit; prefer named exports except for plugin entry points, which export a default `createPlugin({...})`.

When changing an app-level option rather than a plugin option, the change is only complete when all of these agree:

1. `src/config/defaults.ts` - the default and its type.
2. `src/plugins/settings-ui/schema/app-settings.ts` - the in-app control.
3. `src/menu.ts` - the native menu entry, if the option has one.
4. `src/providers/option-effects.ts` - side effects that must happen immediately.
5. `src/preload.ts` - `rendererConfigKeys`, if the renderer reads the value.
6. A migration in `src/config/store.ts` - if a stored key is renamed or removed.

## Tests

The test runner is Playwright's (`@playwright/test`). Most tests are plain Node tests that never open a window; three tests drive the real app with `_electron.launch`: `tests/index.test.js`, `tests/do-not-track.test.js` and `tests/ipc-subscription.test.js`. `tests/index.test.js` loads the live `music.youtube.com` page, so it needs network access and a build that runs. Run them with:

```bash
pnpm test          # playwright test
pnpm test:debug    # same, with Playwright protocol debugging
```

- Cross-cutting tests live in `tests/`. Plugin internals live next to the plugin: `src/plugins/<id>/tests/` or a `*.test.ts` beside the module under test. `tsconfig.test.json` covers `tests/**`, while `tsconfig.json` includes `src/**`, so both locations are type-checked.
- Test behavior, not implementation.
- Prefer pure functions and dependency-free modules so a test needs no Electron process. When a module imports Electron, the common move is to extract the pure part (see `src/config/migrations.ts` vs `src/config/store.ts`).
- Filesystem tests create their own temporary directories instead of touching the real config/themes folders (see `tests/themes-load.test.ts`).
- A bug fix should ship with a regression test when the bug is reachable from a pure unit. UI/Electron-only behavior is manually verified.
- Tests must be deterministic: no real network, no sleeps racing the app, no dependence on the developer's config.

## Documentation

- New documentation belongs in `docs/`.
- Root `README.md` is user-facing and maintained separately.
- Documents describe the current code. When a change invalidates a page, update the page in the same change; when in doubt, prefer linking to the code path over restating it.
- Code examples in docs must be valid for this fork's APIs, not upstream's. See [Porting from upstream](./plugins/porting-from-upstream.md) for the places the APIs differ.

## Releases, versioning and CI

- `package.json` holds the release version. It is bumped by hand at the start of a cycle, not in every feature PR.
- Every push to `master` builds a beta; CI stamps `<version>-beta.<run_number>` before building, so all platform artifacts agree on one version. Beta builds publish to the rolling `beta` pre-release.
- The stable release is a manual `Release Pear Desktop` workflow run: it builds with `PEAR_CHANNEL=stable`, publishes a draft, generates `changelog.md` with `pnpm changelog`, and commits the changelog.
- Builds are produced by `electron-vite` (`pnpm build`); packaging is `electron-builder` via the `dist:*`, `beta:*` and `release:*` scripts.
- The baked channel (`__PEAR_CHANNEL__`) and commit (`__PEAR_COMMIT__`) feed the About window and update logic (`src/app-info.ts`). Dev builds do not update.
- Commit subjects are user-visible through the generated changelog. Write them as release notes.

## Repository hygiene

- Dependencies are managed with pnpm (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Do not hand-edit the lockfile.
- `patches/` holds pnpm patches for packages that need local fixes. A patch is referenced from `pnpm-workspace.yaml`.
- Never commit secrets, build output or local state.
- Do not reformat unrelated files in a focused change. `pnpm format` formats all of `src/`; run it before committing so the diff stays intentional.
