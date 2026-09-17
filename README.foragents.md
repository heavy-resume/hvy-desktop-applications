# HVY Galaxy Desktop

Cross-platform desktop app for HVY files. The app is a Tauri v2 shell with
a Vanilla TypeScript/Vite frontend and the HVY reference implementation mounted
inside the document pane.

## Current Features

- Folder-backed workspaces using `.hvyworkspace.json`.
- Workspaces can be created in app-managed storage or in any folder, including
  folders synced by Google Drive, Microsoft OneDrive, iCloud Drive, or Dropbox.
- Recursive `.hvy`, `.thvy`, and `.md` file tree.
- HVY viewer/editor mounting through `../heavy-file-format`.
- Atomic saves through the Tauri backend.
- Recent workspaces and files persisted in app data.
- Native File menu commands for New Workspace, Open Workspace, Open File, and Save.
- Built-in HVY plugins only.

## Sync Model

The first sync path is folder based: put a workspace in any desktop sync folder and
open the same folder on another device. A future provider-backed path can add
Google Drive or Microsoft OneDrive sign-in for devices that do not already have
a desktop sync client installed.

## Development

Prerequisites:

- Node.js and npm
- Sibling `../heavy-file-format` checkout
- Rust toolchain
- Tauri platform prerequisites for macOS or Windows

On Windows PowerShell, if `npm` is blocked by script execution policy, use
`npm.cmd` for the same commands.

Install dependencies:

```bash
npm install
```

Run the frontend build:

```bash
npm run build
```

Build the host OS release artifacts for both the smaller Tauri app and the
compatibility Electron app:

```bash
npm run build:host
```

On macOS this creates the universal Tauri DMG and the Electron DMG. On Windows
this creates the Tauri installers and the Electron Windows app folder.

Build only the host OS Tauri artifact:

```bash
npm run build:tauri:host
```

Build only the host OS Electron artifact:

```bash
npm run build:electron:host
```

Build Tauri Windows installers on Windows:

```bash
npm run build:windows
```

The Windows installers are written under `src-tauri/target/release/bundle/`.

Build the Electron Windows app folder on Windows:

```bash
npm run build:electron:windows
```

The Electron output is written under `dist-electron/HVY Galaxy-win32-x64/`.

Build the Electron macOS DMG:

```bash
npm run build:electron:dmg
```

The Electron DMG is written under `dist-electron/`.

Build a universal macOS app for Apple Silicon and Intel Macs:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run build:universal
```

Build a universal macOS DMG:

```bash
npm run build:universal:dmg
```

Run the desktop app:

```bash
npm run tauri dev
```

Run Rust unit tests:

```bash
cd src-tauri
cargo test
```
