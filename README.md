# HVY Galaxy Desktop

Cross-platform desktop workspace for HVY files. The app is a Tauri v2 shell with
a Vanilla TypeScript/Vite frontend and the HVY reference implementation mounted
inside the document pane.

## Current Features

- Folder-backed galaxies using `.hvygalaxy.json`.
- Recursive `.hvy`, `.thvy`, and `.md` file tree.
- HVY viewer/editor mounting through `../heavy-file-format`.
- Atomic saves through the Tauri backend.
- Recent galaxies and files persisted in app data.
- Native File menu commands for New Galaxy, Open Galaxy, Open File, and Save.
- Built-in HVY plugins only.

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

Run the desktop app:

```bash
npm run tauri dev
```

Run Rust unit tests:

```bash
cd src-tauri
cargo test
```
