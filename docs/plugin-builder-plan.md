# Plugin Builder Plan

## Goal

Add a workspace-based plugin development experience to the HVY Galaxy desktop
application. Users can create, edit, validate, preview, build, and install HVY
plugins from a dedicated Plugin Builder window. The same project operations are
exposed through MCP so an AI agent can assist with plugin development.

The feature separates four parts of the plugin lifecycle:

1. A plugin project is editable source stored in a workspace.
2. A build produces a validated `.hvy.plugin` package.
3. Installation copies that package into HVY Galaxy's application plugin store.
4. Enablement and per-document authorization remain explicit application
   settings.

This preserves the existing `.hvy.plugin` format and runtime while adding a
source-oriented development workflow around it.

## Current behavior

HVY Galaxy currently supports built-in plugins and custom `.hvy.plugin`
packages.

- `Manage Plugins...` and `Power Scripting...` are in the File menu.
- Custom packages are copied into an application-data `plugins` directory.
- Installed packages are scanned when the application starts or after a package
  is added.
- New custom packages are disabled until the user enables them.
- Custom plugin policy is keyed by plugin ID, optional UUID, and exact version.
- A package can be disabled, enabled globally, or allowed per file.
- Packages with `authorization: "required"` cannot be globally enabled.
- The application does not currently have workspace plugin projects, package
  creation, package removal, or a plugin preview environment.

The current installed-package behavior remains the runtime foundation. The
builder adds a project and build layer; workspace source directories are not
loaded directly into documents.

## Product experience

### Plugins menu

Add a top-level **Plugins** menu in Electron and Tauri:

- **Plugin Builder...**
- **Manage Plugins...**
- separator
- **Power Scripting...**

`Manage Plugins...` and `Power Scripting...` move out of File. The menu change
must be implemented in both desktop shells using the same command identifiers.

### Plugin Builder window

`Plugin Builder...` opens or focuses one dedicated window titled **Plugin
Builder — HVY Galaxy**. It is a standalone application view, not a modal or a
mode of the document editor.

The window contains:

- A workspace selector populated from the workspaces open in HVY Galaxy.
- A plugin-project sidebar for the selected workspace.
- A `+` button for creating a project.
- A name-first project overview with build status.
- A project file tree and source editor.
- Validation diagnostics.
- A plugin preview.
- **Validate**, **Build**, and **Build & Install** actions.

The window should show project state using statuses such as:

- Modified
- Valid or Invalid
- Built
- Installed
- Enabled, Disabled, or Per-file approval

The Plugin Builder window is also listed in the Window menu. Closing it does
not close the main application window or prompt about open HVY documents.

### New plugin modal

The `+` button opens an explicit modal with:

- **Name**
- **Type**
  - Power Scripting
  - Sandboxed Scripting

Power Scripting is the default and generates the JavaScript implementation.
Sandboxed Scripting generates the Python implementation. These are
user-facing creation choices rather than technical language/runtime labels.

Project creation generates:

- A normalized directory name and internal plugin ID derived from the name.
- A stable UUID that does not change if the workspace or plugin display name is
  renamed.
- Internal semantic version `1.0.0`, which is not shown in the ordinary builder
  UI.
- Package format `0.2`.
- The current HVY plugin API version.
- A matching JavaScript or Python entry file.
- A plugin CSS file and documentation starter.

The modal validates the name. Project locations, internal IDs, UUIDs,
package-format versions, and API versions are kept out of the default product
surface.

## Workspace project format

Plugin projects live in a reserved `plugins` directory under a workspace:

```text
My Workspace/
├── .hvyworkspace.json
└── plugins/
    └── skill-rating/
        ├── hvy-plugin.json
        ├── plugin.js
        ├── plugin.css
        ├── documentation.txt
        ├── assets/
        └── dist/
            └── skill-rating.hvy.plugin
```

The project directory mirrors the root of a `.hvy.plugin` archive. There is no
second project manifest:

- `hvy-plugin.json` is the editable project manifest and package manifest.
- JavaScript entries are self-contained `.js` or `.mjs` modules.
- Python entries are `.py` files using the imports supported by package format
  `0.2`.
- Package-relative assets and helper files can be stored in subdirectories.
- `dist/` contains generated packages and is excluded from package inputs.

The ordinary workspace document tree can continue to show only supported HVY
documents. The Plugin Builder uses a dedicated project scanner for
`workspace/plugins`.

## Project service

Create a shared plugin-project domain service that owns the format-aware
operations used by the builder and MCP:

- List projects in a workspace.
- Create JavaScript and Python starter projects.
- Read project files.
- Apply exact updates to project files.
- Parse and update a project manifest.
- Validate project structure and package contents.
- Build a deterministic `.hvy.plugin` package.
- Return structured diagnostics and build metadata.

The format-specific core should live in `heavy-file-format` so the builder does
not create a second interpretation of the plugin package contract. Proposed
APIs are:

```ts
createHvyPluginProject(...)
validateHvyPluginProject(...)
buildHvyPluginPackage(...)
```

Validation and preview must load the built bytes through the existing
`readHvyPluginZipManifest` and `loadHvyPluginZip` implementation. A successful
build therefore proves that the result follows the same loading path as an
installed package.

Electron and Tauri provide matching filesystem commands around this service.
All paths accepted by those commands are relative to a selected plugin project
inside an HVY workspace.

## Window architecture

Add `plugin-builder.html` and a `src/pluginBuilder/` frontend entry. The builder
has its own small state model and does not boot the document editor's global
application state.

### Electron

- Maintain a `pluginBuilderWindow` reference.
- Create or focus the singleton window from the plugin-builder menu event.
- Load the dedicated builder HTML entry using the existing preload bridge.
- Add the window to the Window menu while it is open.
- Remove its reference when it closes.

### Tauri

- Create or focus a webview window labeled `plugin-builder`.
- Load the dedicated builder HTML entry.
- Add the builder label to the appropriate Tauri capability.
- Add the window to the Window menu while it is open.
- Register the same project commands available through Electron.

### Cross-window refresh

Use application events to keep the builder and main editor current:

- `plugin-projects-changed`
- `installed-plugins-changed`
- `plugin-policies-changed`

These events cover edits made by MCP, builds, installs, removals, and policy
changes. The main editor refreshes available plugins and remounts the current
document when installed plugin code changes.

## Editing and validation

The source editor initially needs:

- Plain-text editing for JSON, JavaScript, Python, CSS, Markdown, and text.
- Dirty-state tracking per file.
- Explicit save and standard `CmdOrCtrl+S` support.
- Diagnostics with file name, line, column when known, severity, and message.
- A manifest form for common fields without hiding the underlying
  `hvy-plugin.json` file.
- Refresh when an MCP agent changes project files on disk.

Discarding unsaved edits, deleting a source file, deleting a project, replacing
an installed package, and uninstalling a package all use explicit application
modals. Native alert and confirm dialogs are not used.

Builder CSS uses feature-specific classes. It must not add broad element or
type-selector overrides that can affect the HVY embed or a plugin preview.

Validation checks include:

- The project contains `hvy-plugin.json`.
- The manifest is valid package-format `0.2` JSON.
- Manifest paths are normalized and remain inside the project.
- The entry, styles, documentation, and referenced package files exist.
- The entry extension is supported.
- Python imports are supported and unique.
- Version and API-version fields are valid.
- Package inputs exclude `dist` and other build output.
- The built archive passes the existing ZIP limits and manifest reader.
- Loading the entry produces a plugin whose ID, UUID, version, display name,
  and API version exactly match its manifest.

## Preview

Preview always uses a freshly built in-memory package, not direct source
imports. It should:

- Load the package through the normal package loader.
- Apply package styles inside an isolated preview surface.
- Create a sample HVY document and plugin block.
- Support editor and reader preview modes.
- Allow editing `pluginConfig` and plugin text through the normal plugin host.
- Display load, mount, refresh, and unmount errors as builder diagnostics.
- Dispose package object URLs, styles, plugin mounts, and Python modules when a
  preview is replaced or closed.

Later iterations can add saved preview fixtures and capability-specific
preview panels for hooks, scripting methods, visual descriptions, and PDF
static rendering.

## Build and install lifecycle

### Validate

Validates the current project without writing a package. Unsaved editor content
is included in validation so the result matches what the user sees.

### Build

Creates a deterministic package under the project's `dist/` directory. The
result includes:

- Artifact path
- Plugin ID, UUID, and version
- Requested permissions
- Authorization requirement
- Archive digest
- Build timestamp

### Build & Install

Builds the package and opens an explicit installation modal. The modal shows:

- Display name
- ID, UUID, and version
- Workspace and project origin
- Artifact path and digest
- Requested permissions
- Authorization requirement
- Validation result
- Whether the operation is a new install or replacement

After confirmation, the application copies the artifact into its installed
plugin store. A newly installed package remains disabled until it is enabled in
Manage Plugins.

Workspace source is never executed merely because a workspace is opened, a
project is selected, or an MCP agent edits files.

## Installed plugin management changes

The current manager remains the place for built-in and installed-package
policy. Move its menu entry but keep its existing behavior while extending its
installed-package records.

Required changes:

- Record an installed package's origin and archive digest.
- Display the origin, digest, permissions, and verification status.
- Identify when an installed package corresponds to a selected workspace
  project and build.
- Add package removal using an explicit modal.
- Detect collisions between packages with the same ID, UUID, and version.
- Dispose loaded packages, object URLs, Python modules, and injected styles
  when packages are replaced or removed.
- Invalidate the package cache when the same version is rebuilt and reinstalled.
- Refresh mounted documents after installation, removal, replacement, or
  policy changes.
- Preserve policy and per-file acceptance identity using plugin ID, optional
  UUID, and exact version.
- Preserve the existing behavior that an authorization-required package can
  only use per-file approval.

The installed package remains the runtime source. Documents do not load a
plugin directly from its workspace project or `dist` artifact.

## MCP exposure

Add a **Plugin development access** setting to MCP:

- **Off**
- **Read plugin projects**
- **Edit and build plugin projects**

The initial MCP surface is:

### `plugin_project_list`

Lists plugin projects in one active workspace or all active workspaces. Returns
project paths, manifest identity, runtime, validation summary, and build status.

### `plugin_project_create`

Creates a JavaScript or Python component starter in `workspace/plugins`.

### `plugin_project_read`

Reads one project file or returns a low-context project tree when no file is
specified.

### `plugin_project_apply_patch`

Applies exact contextual changes to one or more text files in a plugin project.
The patch format should follow the existing exact-context patch behavior used
for HVY document edits.

### `plugin_project_validate`

Validates the project and returns structured diagnostics.

### `plugin_project_build`

Validates and builds the package, returning artifact metadata and diagnostics.

All tools take an explicit `workspacePath`. File operations also identify the
plugin project and use project-relative paths.

MCP project discovery follows the existing active-workspace and
`hiddenFromAI` behavior. The same tools and access decisions are used by STDIO
and Streamable HTTP.

The initial MCP release does not install, remove, enable, disable, or authorize
executable plugins. Those actions remain explicit desktop operations. A future
MCP management level can add them if the product requires fully agent-driven
plugin installation.

## Testing strategy

### Reference-format tests

- Scaffold snapshots for JavaScript and Python starters.
- Manifest generation and normalization.
- Project path and package input selection.
- Deterministic package generation.
- Round-trip through `readHvyPluginZipManifest` and `loadHvyPluginZip`.
- Missing files, invalid entry types, path traversal, unsupported imports, and
  manifest/entry identity mismatch.

### Desktop backend tests

- Electron and Tauri command parity.
- Project listing and creation.
- Project-relative read and patch operations.
- Build output placement.
- Installation origin and digest persistence.
- Replacement, removal, and installed-package cache invalidation.
- Cross-window change events.

### Builder UI tests

- Workspace selection and empty states.
- New-plugin modal validation.
- JavaScript and Python project creation.
- File selection, editing, saving, and dirty-state behavior.
- Validation diagnostics.
- Preview lifecycle and error reporting.
- Build and installation modal.
- Explicit discard, delete, replace, and uninstall modals.

### MCP tests

- Tool discovery for both transports.
- Plugin development access levels.
- Hidden workspaces are not exposed.
- Create, read, patch, validate, and build flows.
- Structured diagnostics and build metadata.
- MCP-created changes refresh an open builder window.
- MCP cannot install or enable a package in the initial release.

### End-to-end tests

- Open the builder from the Plugins menu in Electron and Tauri.
- Create both starter types.
- Edit a project in the UI and through MCP.
- Validate, preview, build, and install the package.
- Enable the installed package and use it in an HVY document.
- Rebuild and replace the same plugin version.
- Remove an installed package.
- Restart the application and verify project, install, and policy persistence.

## Implementation sequence

Implementation started with a desktop-first vertical slice. Source scaffolds
and deterministic packaging live in `src/pluginProjects.ts` while package
parsing and format validation reuse `heavy-file-format`. No upstream move is
required unless another product later needs the same authoring API.

### 1. Reference-format project core

- [ ] Define plugin-project request, result, diagnostic, and build metadata types.
- [ ] Add JavaScript component starter generation.
- [ ] Add Python component starter generation.
- [ ] Add project file selection and `dist/` exclusion.
- [ ] Add project validation using the existing package manifest rules.
- [ ] Add deterministic `.hvy.plugin` package creation.
- [ ] Round-trip built packages through the existing ZIP manifest reader and loader.
- [ ] Export the project APIs from `heavy-file-format`.
- [ ] Add reference-format unit tests.
- [ ] Document the workspace-project convention in the reference README without
      changing the `.hvy.plugin` specification.

### 2. Shared desktop project commands

- [x] Add frontend request and result types to the desktop backend bridge.
- [x] Add commands to list workspace plugin projects.
- [x] Add commands to create a project.
- [x] Add commands to read project trees and files.
- [ ] Add exact contextual project patch commands.
- [ ] Add project validation commands.
- [x] Add project build commands.
- [x] Implement project listing and creation in Electron.
- [x] Implement project listing and creation in Tauri.
- [ ] Add exact contextual patch and native validation commands in Electron.
- [ ] Add exact contextual patch and native validation commands in Tauri.
- [ ] Add Electron/Tauri contract parity tests.

### 3. Plugins menu and builder window

- [x] Add the Plugins menu to Electron.
- [x] Add the Plugins menu to Tauri.
- [x] Move Manage Plugins out of File in both shells.
- [x] Move Power Scripting out of File in both shells.
- [x] Add `plugin-builder.html` as a Vite build entry.
- [x] Add the `src/pluginBuilder/` application entry and state model.
- [x] Implement the singleton Electron builder window.
- [x] Implement the singleton Tauri builder window.
- [x] Add the Tauri window capability.
- [x] Add the open builder to the Window menu in both shells.
- [x] Pass the active and selected workspace context into the builder.
- [ ] Add window lifecycle tests.

### 4. Project creation and navigation UI

- [x] Add the workspace selector.
- [x] Add the project list and empty state.
- [x] Add the `+` action.
- [x] Add the explicit new-plugin modal.
- [x] Keep generated project paths and identity details out of the creation modal.
- [x] Create and select JavaScript starter projects.
- [x] Create and select Python starter projects.
- [x] Add a name-first project overview without exposing internal identity fields.
- [x] Add project-state badges.
- [ ] Add creation and navigation UI tests.

### 5. File editing and validation UI

- [x] Add the project file tree.
- [x] Add text editing for supported source formats.
- [x] Add per-file dirty state.
- [x] Add Save and `CmdOrCtrl+S` behavior.
- [x] Add explicit discard-change modals for project and workspace navigation.
- [ ] Add the common manifest field editor.
- [ ] Keep manifest form changes synchronized with `hvy-plugin.json`.
- [x] Add the validation action.
- [x] Add structured validation diagnostics.
- [x] Navigate from a diagnostic to its source file.
- [ ] Add editing and validation UI tests.

### 6. Build and preview

- [x] Build from saved and in-memory edited project files consistently.
- [x] Write artifacts to the project `dist/` directory.
- [ ] Display the friendly package name and export/install destination.
- [ ] Add the isolated preview surface.
- [ ] Load previews through `loadHvyPluginZip`.
- [ ] Add editor and reader preview modes.
- [ ] Add editable sample plugin configuration and text.
- [ ] Convert preview errors into builder diagnostics.
- [ ] Dispose previous preview resources on rebuild, selection change, and close.
- [x] Add deterministic package build and binary-asset preservation tests.
- [ ] Add preview tests.

### 7. Installed plugin lifecycle

- [ ] Define installed-package metadata for origin and archive digest.
- [ ] Persist metadata in Electron.
- [ ] Persist metadata in Tauri.
- [ ] Show origin, digest, permissions, authorization, and verification status in
      Manage Plugins.
- [ ] Add the Build & Install action.
- [ ] Add the explicit installation and replacement modal.
- [ ] Keep newly installed packages disabled.
- [ ] Add explicit package removal and its modal.
- [ ] Detect installed identity collisions.
- [ ] Dispose package runtime resources during replacement and removal.
- [ ] Invalidate cached packages when package bytes change.
- [ ] Refresh mounted documents and plugin selectors after lifecycle changes.
- [ ] Add installed-package lifecycle tests.

### 8. Cross-window synchronization

- [ ] Define project, installed-package, and policy change events.
- [ ] Refresh builder projects after MCP or filesystem changes.
- [ ] Refresh builder install state after main-window policy changes.
- [ ] Refresh main-window installed plugins after builder installation or removal.
- [ ] Preserve unaffected unsaved builder files during refresh.
- [ ] Add multi-window synchronization tests.

### 9. MCP plugin development tools

- [ ] Add plugin development access to MCP settings types and persistence.
- [ ] Add the setting to the MCP settings UI.
- [ ] Include the setting in the STDIO workspace configuration.
- [ ] Add `plugin_project_list`.
- [ ] Add `plugin_project_create`.
- [ ] Add `plugin_project_read`.
- [ ] Add `plugin_project_apply_patch`.
- [ ] Add `plugin_project_validate`.
- [ ] Add `plugin_project_build`.
- [ ] Route all MCP operations through the shared project service.
- [ ] Apply active-workspace and `hiddenFromAI` behavior.
- [ ] Add STDIO and HTTP parity tests.
- [ ] Add access-level and tool-contract tests.

### 10. Documentation and release verification

- [ ] Add a Plugin Builder section to the HVY Galaxy guide.
- [ ] Document the project directory convention.
- [ ] Document the build, install, and enablement lifecycle.
- [ ] Document JavaScript and Python starter capabilities.
- [ ] Document MCP setup and available plugin tools.
- [ ] Add Electron end-to-end coverage.
- [ ] Add Tauri end-to-end coverage.
- [ ] Verify same-version rebuild and replacement behavior.
- [ ] Verify application restart persistence.
- [ ] Verify existing built-in and downloaded plugin behavior remains compatible.
- [ ] Complete manual release verification on supported macOS and Windows shells.

## Follow-up opportunities

These are intentionally outside the first implementation:

- Embedded AI chat using the same plugin-project tools.
- Additional starters for hooks, scripting APIs, and composite plugins.
- Saved preview documents and fixtures.
- Plugin unit-test execution inside the builder.
- Version bump and changelog assistance.
- Package signing and publisher verification.
- MCP-controlled installation and enablement.
- Publishing plugins to a registry or marketplace.
