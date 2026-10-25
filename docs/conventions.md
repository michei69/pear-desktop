# Conventions

## Commit messages

The history follows [Conventional Commits](https://www.conventionalcommits.org/). Keep doing so, because the changelog is generated from commit subjects.

```
<type>(<optional scope>): <subject>

<body: why this change>

<trailers>
```

- `type` is one of `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert`.
- `scope` is the plugin id or the subsystem, for example `fix(synced-lyrics)` or `feat(settings-ui)`.
- The subject is imperative and has no trailing period: `add plugin that skips explicit songs`, not `Added plugin`.
- The body explains the problem and the chosen fix.
- Trailers go inline as `fix: something (#123)` for references, or after a blank line: `Closes #123`. When an AI agent contributed, say so with `Co-authored-by:` or `Assisted-by:`.
- One logical change per commit. Do not mix a refactor, a dependency bump and a feature.
- Upstream work is merged with merge commits so provenance and credits are preserved.
- Work-in-progress commits (`wip(scope): ...`) are fine on topic branches, not on `master`.

## Repository layout

- The app is `apps/desktop`; shared code is `packages/*`; plugins are `plugins/*`; scripts are `scripts/`.
- A plugin is one workspace package. Its folder, its `id`, its package name suffix and its translation key prefix all use the same lower-case kebab-case id: `plugins/synced-lyrics/index.ts` has id `synced-lyrics`, package `@pear/plugin-synced-lyrics` and keys under `plugins.synced-lyrics.*`.
- Shared code belongs in an existing `packages` module. Do not import app code from a plugin: plugins may import `@pear/sdk` subpaths and their own files.
- App-wide types live in the package that owns them. The bridge protocol is `packages/sdk/src/protocol.ts`.
- New plugin entries are scaffolded with `nub scripts/new-plugin.ts <id>`; see [Creating a plugin](./plugins/creating.md#step-1-scaffold-the-plugin).
- Do not add a second convention beside an existing one. Reuse the field builders, the selector registry, the DOM helpers and the settings components.

## TypeScript and code style

Formatting is oxfmt and linting is oxlint with type-aware rules. Both cover `apps`, `packages`, `plugins`, `src` and `scripts`:

```bash
nub run format        # write
nub run format:check  # verify
nub run lint          # oxlint --type-aware apps packages plugins src
nub run typecheck     # tsc in every workspace package that has a typecheck script
```

There is no combined `check` script; run the three commands. CI runs oxlint through reviewdog and the release workflows run no tests, so run them locally.

Other conventions:

- `tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `allowImportingTsExtensions`. Imports carry `.ts`/`.tsx` extensions inside source.
- JSX defaults to Preact in `packages/ui` and the UI components. Files with `/** @jsxImportSource @pear/sdk */` use the SDK's DOM runtime for page elements.
- Config fields are declared with the builders in `packages/sdk/src/config.ts`; never hand-write a settings schema.
- YTM selectors are names from `packages/sdk/src/selectors.ts`, used through `ctx.$`, `ctx.sel` or the `sel()` CSS macro. Do not put YTM class names in plugin code.
- Comments explain why, not what. Non-obvious timing constraints, workarounds and rejected alternatives get a short comment.
- Prefer named exports. Plugin entry points default-export `definePlugin({...})`.
- No hard-wrapped prose in docs: one paragraph per line. Markdown tables and code blocks may use lines.

## User-facing text and translations

Any string a user can see must come from the translation files. A feature that shows text without an English entry is incomplete even if it works.

- In plugins, use `ctx.t(key, english, vars)`. The English text is the fallback and the source for `src/i18n/resources/en.json`. Never hardcode visible text.
- Plugin names, descriptions, config labels, descriptions, placeholders, options and action labels are translated by the settings catalog automatically. They are written as plain strings in the schema; do not call `t` there.
- The settings dialog's own strings live in `packages/ui/src/strings.ts` and use the `settings-ui.*` namespace.
- Core settings field keys are `settings-ui.core.<field>.label` and `.description`; plugin field keys are `plugins.<id>.settings.<field>.label`, `.description`, `.placeholder` and `.options.<value>`. Group headings are `settings-ui.groups.<slug>`. The generator is `fieldKey()` and `groupKey()` in `packages/sdk/src/i18n.ts`.
- Run `nub run i18n` after adding text. It reads plugin schemas, core sections, `packages/ui/src/strings.ts` and literal `t("key", "English")` calls, and appends missing keys to `src/i18n/resources/en.json`. Existing keys are never changed.
- `nub run i18n --check` reports missing keys without writing and exits non-zero.
- Leaf keys are lower-case kebab-case: `show-button`, `smoothness-transition`. Interpolate with `{{name}}` placeholders.
- Do not rename or delete a key that code still references. When removing an option, remove its key in the same change.
- Every resource starts with its metadata block, so the language picker can render without loading translations:

```json
"language": { "code": "en", "local-name": "English", "name": "English" }
```

- Keep the trademarked service name out of source strings: write "YTM" in prose and use `YTM_NAME` or `ytmUrl` from `@pear/sdk/util`. `scripts/escape-names.ts` enforces this in CI and in the pre-commit hook.

## Changing an app option

A core option is complete when all of these agree:

1. `packages/sdk/src/core-config.ts`: the field, its default, group, platforms and `restart` flag.
2. The code that applies it: `apps/desktop/src/main/core-options.ts` for live window behavior, or the page runtime for page behavior.
3. `apps/desktop/src/main/migrations/index.ts` or `migrations/plugins.ts`: a migration when a stored key is renamed, moved or reshaped.
4. `src/i18n/resources/en.json` through `nub run i18n`.
5. A test in `apps/desktop/test/` for parsing, defaults or migration behavior.

The settings UI, the API server options and the translation keys of fields are generated from the schema, so no separate UI file is needed. The native menu only carries options it explicitly lists (`apps/desktop/src/main/menu.ts`).

## Changing a plugin

- Add fields to the plugin's `config` schema; do not add a parallel settings schema.
- Add host commands for work the page asks for, and `actions` for buttons in settings.
- Expose other-app functionality through `host.rpc` with a valibot input schema.
- Register every listener, timer, observer, style and DOM mount through `ctx`, so stopping the plugin undoes it. Use `ctx.onCleanup` for anything else.
- If a change cannot be undone (replacing page globals, adding window options), set `restartRequired` and make the page part tolerate the old state until the next load.
- Update `plugins/<id>/test/` and, for user-visible changes, the keys in `en.json`.
- If the stored shape changes, add a migration entry in `apps/desktop/src/main/migrations/plugins.ts` and a case in `apps/desktop/test/plugin-migrations.test.ts`.

## Tests

The unit runner is Vitest; the app-level runner is Playwright.

```bash
nub run test          # vitest in every workspace package with a test script
nub run test:e2e      # electron-vite build, then playwright test
```

- Vitest tests live in `test/` beside the code: `packages/sdk/test`, `packages/vite-plugin-pear/test`, `apps/desktop/test`, `plugins/<id>/test`. The desktop include pattern is `test/**/*.test.ts`.
- Playwright tests live in `apps/desktop/e2e/` and use the fixtures in `e2e/fixtures.ts`. They launch the real built app with a temporary profile, and most use `playTestTrack()` and the real YTM. They need network access and a build.
- The e2e suite opens its windows on Xvfb when it is installed on Linux; `PEAR_E2E_SHOW=1` shows them on the desktop instead. CI runs one worker.
- Never sign in to Google in a test; Google then blocks the network for a while.
- Test behavior, not implementation. Prefer pure modules so a test needs no Electron process.
- Filesystem tests create their own temporary directories and never touch the real config or theme folders.
- A bug fix ships with a regression test when the bug is reachable from a unit. UI and Electron-only behavior is verified in e2e or manually.
- Tests must be deterministic: no real network outside e2e, no sleeps racing the app, no dependence on the developer's profile.

## Documentation

- New documentation belongs in `docs/`. Keep the map in `docs/index.md` current.
- The root `README.md` is user-facing and separate from this set.
- Documents describe the current code. When a change invalidates a page, update it in the same change.
- Code examples must be valid for this tree: `@pear/sdk`, `definePlugin`, `ctx`, Nub. See [Porting from upstream](./plugins/porting-from-upstream.md) for the differences from pear-desktop 3.x.

## Releases and CI

- `apps/desktop/package.json` holds the release version; the root `package.json` mirrors it for `auto-changelog`. Bump both by hand at the start of a cycle, not in every feature pull request.
- Every push to `master` runs `.github/workflows/build.yml`. It stamps `<version>-beta.<run_number>` into `apps/desktop/package.json` on each runner, builds with `PEAR_CHANNEL=beta` and `PEAR_COMMIT`, and the `publish-beta` job replaces the rolling prerelease with the new installers and `beta*.yml` metadata.
- The stable release is a manual `Release Pear Desktop` run (`.github/workflows/release.yml`) on `master`. It builds with `PEAR_CHANNEL=stable` and the unchanged package version, publishes the installers and `latest*.yml` to a `v<version>` release, generates `changelog.md` with `nub run changelog`, and commits it. An existing tag skips publishing.
- `pr-build-artifacts.yml` builds Linux, macOS and Windows installers for same-repository pull requests by users with write access, keeps them for seven days, and comments the run link.
- Packaging is electron-builder through the `dist:*`, `beta:*` and `release:*` scripts. Every script passes `-p never`, so electron-builder writes to `pack/` and never uploads; the workflows own the GitHub release.
- Linux packaging uses Flatpak runtime and base `26.08`, and the CI setup installs those runtimes for x86_64 and aarch64 before `nub run beta:linux` or `nub run release:linux`.
- The baked `__PEAR_CHANNEL__` and `__PEAR_COMMIT__` feed the About window and the update check (`apps/desktop/src/main/app-info.ts`, `updates.ts`). `general.updateChannel` selects stable or beta; a beta build starts on beta until the user chooses. `UpdateManager` asks GitHub shortly after startup and every six hours while **Check for updates** is on, rechecks when the channel changes, and its dialog opens the release page or turns checks off. A beta build switching to stable asks before downgrading.
- Commit subjects are user-visible through the changelog. Write them as release notes.

## Repository hygiene

- Dependencies are managed with Nub (`nub.lock` and the `workspaces`, `overrides` and `allowScripts` fields in the root `package.json`). Do not hand-edit the lockfile.
- Never commit secrets, build output (`out/`, `pack/`) or local state.
- Do not reformat unrelated files in a focused change. Run `nub run format` before committing so the diff stays intentional.
