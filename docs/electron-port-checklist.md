# Electron Port Checklist

## Runtime Routing

- [x] Add a tiny Rust launcher path that handles process-level routing before any UI shell starts.
- [x] Route `--mcp-stdio` directly to the existing Tauri/Rust MCP implementation.
- [x] Route modern macOS to the Tauri app while it remains the best native shell there.
- [x] Route Windows, Linux, and legacy Intel macOS/macOS 11 to the Electron app.
- [ ] Package the Electron runtime beside the launcher so the launcher can spawn the correct executable without depending on a system Electron install.
- [ ] Preserve app identity, signing, file associations, icons, and update paths for both shells.

## Shared Frontend Boundary

- [x] Add an Electron preload bridge with `invoke` and menu event subscription.
- [x] Teach `src/backend.ts` to call Electron or Tauri behind the same frontend API.
- [ ] Move shell-neutral backend types into a clearly named shared bridge module if `backend.ts` grows too shell-specific.
- [ ] Add a smoke test mode that can run the same frontend checks against Tauri and Electron.

## Electron Shell

- [x] Add an Electron main process.
- [x] Add a cross-platform `npm run electron:dev` launcher.
- [x] Implement core menus and menu events.
- [x] Implement compatibility mode persistence and Help menu toggle.
- [x] Share Tauri app data for settings, recents, workspaces, templates, compatibility mode, and backups.
- [x] Keep Electron browser profile/cache separate from shared HVY app data.
- [x] Reuse the existing HVY Galaxy app icon in the Electron window and macOS Dock.
- [x] Implement app environment detection.
- [x] Implement open/save/read document flows.
- [x] Implement recent files/workspaces.
- [x] Implement workspace create/open/load/add-file flows.
- [x] Implement template import/save flows.
- [x] Implement theme import/export flows.
- [x] Implement document backup list/create/restore flows.
- [x] Implement external URL opening.
- [ ] Add packaged production Electron build config.
- [ ] Add camera permission/plist/entitlement packaging details for macOS Electron.
- [ ] Verify camera behavior on Big Sur, Windows 10, and Linux.
- [ ] Verify font rendering and document layout parity across Windows 10, Linux, Big Sur, and modern macOS.
- [ ] Verify theme switching performance in Electron on older hardware.

## Tauri-Only For Now

- [x] Keep MCP server behavior Tauri/Rust-owned for the first Electron pass.
- [x] Return stopped/uninstalled MCP states from Electron so the UI can load.
- [ ] Decide whether Electron should hide MCP controls, label them as Tauri-only, or eventually call into a shared native MCP helper.

## Platform Test Matrix

- [ ] macOS 14+ Apple Silicon: Tauri primary shell.
- [ ] macOS 11.7 Intel: Electron legacy shell.
- [ ] Windows 10 x64: Electron shell.
- [ ] Current Windows 11 x64: Electron shell.
- [ ] Ubuntu LTS / common Linux desktop: Electron shell.
- [ ] Compare Tauri vs Electron startup time, memory, camera, fonts, hover states, modal opacity, and HVY/Meta switching.
