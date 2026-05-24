# Electron Port Checklist

## Runtime Routing

- [x] Add a tiny Rust launcher path that handles process-level routing before any UI shell starts.
- [x] Route `--mcp-stdio` directly to the existing Tauri/Rust MCP implementation.
- [x] Route modern macOS to the Tauri app while it remains the best native shell there.
- [x] Route Windows, Linux, and legacy Intel macOS/macOS 11 to the Electron app.
- [x] Package the Electron runtime as a standalone app without depending on a system Electron install.
- [ ] Package the Electron runtime beside the launcher so the launcher can spawn the correct executable in hybrid distributions.
- [ ] Preserve app identity, signing, file associations, and update paths for both shells.

## Shared Frontend Boundary

- [x] Add an Electron preload bridge with `invoke` and menu event subscription.
- [x] Teach `src/backend.ts` to call Electron or Tauri behind the same frontend API.
- [ ] Move shell-neutral backend types into a clearly named shared bridge module if `backend.ts` grows too shell-specific.

## Electron Shell

- [x] Add an Electron main process.
- [x] Add a cross-platform `npm run electron:dev` launcher.
- [x] Implement core menus and menu events.
- [x] Match Tauri menu placement for AI Settings, MCP Server, Colors, and Help.
- [x] Remove compatibility mode from Electron.
- [x] Share Tauri app data for settings, recents, workspaces, templates, and backups.
- [x] Keep Electron browser profile/cache separate from shared HVY app data.
- [x] Reuse the existing HVY Galaxy app icon in the Electron window, About panel, and macOS Dock API.
- [x] Package Electron with the HVY Galaxy bundle name/icon.
- [x] Implement app environment detection.
- [x] Implement open/save/read document flows.
- [x] Implement recent files/workspaces.
- [x] Implement workspace create/open/load/add-file flows.
- [x] Implement template import/save flows.
- [x] Implement theme import/export flows.
- [x] Implement document backup list/create/restore flows.
- [x] Implement external URL opening.
- [x] Add packaged production Electron build config.
- [ ] Add camera permission/plist/entitlement packaging details for macOS Electron.

## MCP

- [x] Keep the HTTP MCP server stopped in Electron until the server itself is ported.
- [x] Support MCP client install/remove/restore from Electron using the same `--mcp-stdio` launch shape.
- [ ] Point packaged Electron MCP installs at the Rust launcher when shipping hybrid distributions.
