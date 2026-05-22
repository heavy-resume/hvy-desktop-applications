# HVY Workspace Desktop

Cross-platform desktop workspace for HVY files. The app is a Tauri v2 shell with
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
- Rust toolchain
- Tauri platform prerequisites for macOS or Windows

Install dependencies:

```bash
npm install
```

Run the frontend build:

```bash
npm run build
```

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
