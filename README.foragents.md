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

## Waiting on the integration browser

Anything that sends work to a browser profile's window and waits for the page's
answer goes through `src/browserRequests.ts` (`requestFromBrowser`): put the
request's id in the context sent (`browserRequestId`) and await the answer,
clearing any pending state in `finally`. The request ends when the page answers,
on its time limit, when stopped, or when the window closes: both runtimes report
every close (`integration-browser-closed`), which fails every request still
waiting on that profile. Don't add a pending flag that a case in the result
switch (`mainStartup.ts`) clears; it is left set when the window closes first.

## The integration browser's address and site information

The toolbar, its layout and Site information are shared (`src-tauri/src/browser_chrome.rs`,
`src-electron/browser-chrome.cjs`) by the integration browser, web automation's sign-in window, and the pop-ups a
sign-in page opens. The integration browser adds its page menu, picking's buttons and its allowed sites; the others
load the toolbar as a plain browser's (`pages/integration-toolbar.html?mode=browse`: no page menu, no Site row). In
Tauri a toolbar's webview label must match `src-tauri/capabilities/integration-toolbar.json`, or its clicks are refused.

The toolbar's address and lock are a security signal, so only the host sets
them. A page that moves without loading (a single-page site such as Gmail)
is followed by Electron's `did-navigate-in-page`, and in Tauri by Galaxy's page
script reporting `location`; the Tauri host takes a reported address only on
the origin the page loaded (`show_integration_location`), since no move
without a load changes it. Site information (the lock, clicked) makes the
toolbar taller over the page and shows the host's view of the site: its
certificate comes from WebKit's server trust on macOS
(`src-tauri/src/site_security.rs`) and from the session's certificate check in
Electron; WebView2 doesn't give a good connection's certificate, so Windows
says so.

A page refused for its certificate or secure connection opens Site information
on it, saying why (`blocked`): Electron's `did-fail-load`, WebView2's
`NavigationCompleted`, and on macOS WebKit's
`webView:didFailProvisionalNavigation:withError:`, which wry's navigation
delegate lacks, so `watch_refused_pages` adds it to the delegate's own class at
runtime (wry names its classes with its version, e.g.
`…WryNavigationDelegate0.55.1`, so don't look them up by name) and sets the delegate again (WebKit reads a delegate's methods when it
is set). After a wry upgrade, check that class still lacks the method. The
WebView2 hook (`watch_refused_pages` for Windows, in `site_security.rs`) can't
be type-checked from macOS: `cargo check --target x86_64-pc-windows-msvc` fails
building `aws-lc-sys`, a C dependency. Check it with a build on Windows after
changing it. WebKit's
phishing and malware warnings are set on explicitly
(`keep_fraudulent_website_warnings`); WebView2's SmartScreen is on by default.

## New tabs from web automation's windows

A worker is one window. What a page in it opens in a new tab or window (a row
that opens its item with `window.open`, a link with `target="_blank"`) opens
nothing by itself: the host keeps the address (`on_new_window` in
`src-tauri/src/web_automation.rs`, `setWindowOpenHandler` in
`src-electron/web-automation-host.cjs`), and `takeOpenedWindow` opens it in a
worker of its own, of the same profile. Clicking through a list reads the item
there and closes it, so the list stays as it was (its search, its scroll) with
no Back.

The sign-in window opens them as real pop-ups instead (a "Sign in with Google" button's account picker answers its
opener, so it can't be loaded in place): Electron's `createWindow` puts the opened page in a window with the toolbar,
and Tauri answers `NewWindowResponse::Create` with a window built from WebKit's configuration for it
(`web_automation_popup`), adding the toolbar after, off the main thread. With the toolbar beside it, a Tauri sign-in or
pop-up window holds two webviews, so `get_webview_window` no longer finds it: look it up with `get_webview` or
`get_window`. wry's UI delegate has no `webViewDidClose:`, so a page's `window.close()` did nothing:
`close_window_when_page_closes` (`browser_chrome.rs`) adds it to the UI delegate's own class at runtime and sets the
delegate again, as `watch_refused_pages` does for the navigation delegate; after a wry upgrade, check that class still
lacks it. Windows isn't hooked yet (WebView2's `WindowCloseRequested`), so a pop-up stays open there.

## Scheduled jobs

A `galaxy.schedule` block's jobs run on a timer while Galaxy is open
(`src/scheduledJobs.ts`, docs/job-search/12-scheduled-jobs.md) as if the user
pressed their button, once: a job's turn is over when its script has run (it
has no running state), and a turn skipped or failed waits for the next rather
than retrying: once the user is idle, the job's document is opened as a
tab (`selectDocumentTab`), its script runs there (`runUserScript`), and Galaxy
goes back to the user's tab. Don't add a second way to run or save a document
for it: a tab a job opened is saved and closed by switching to it, the usual
Save, and closing it, while the user is idle. What the user chose (each job on,
how often) is app settings by path (`scheduledDocuments`), not the document.
While a job runs a document, its automation is unattended (`setUnattended`):
the runs it starts let a page that needs someone go. A document is idle when
`automation.activity()` has nothing outstanding (every plugin call through
`operation()` is `tracked`, and callbacks waiting in `ScriptCalls`) and nothing
happened for 5 minutes.

## File picker

A `galaxy.file-picker` block (`src/plugins/filePicker.ts`) is a button that
lets the user choose a file from their computer. The file is read as UTF-8 text
and handed to the handler the document's load script registered:
`doc.plugins.call("galaxy.file-picker", "on_file", {"pickerId", "handler"})`.
The handler gets `{name, size, mediaType, text}`.

- The handler is a script callback, so its database writes are kept, unlike
  those of a load run set off by another script's edit.
- A document only ever sees a file the user picked, so the plugin needs no
  per-file approval.
- The button uses the webview's own file input, so Electron and Tauri share
  it.
- Scripts count steps, so parse a large file in SQL (its lines handed to
  SQLite as a JSON array), not with a Python loop.

## Dialogs

New dialogs use the shared shell, `renderDialog` in `src/ui/dialog.ts`: the
backdrop, the box, a title with an optional line under it, the body, and the
buttons in a row at the bottom (closing is one of them; there is no corner
×). Its header is laid out once (`.dialog-shell-*` in `dialogs.css`), so a
dialog styles only its own parts under its class. Older dialogs build the same
markup by hand, each with its own header rule; move one to the shell when you
change it.

## Calling into a document's scripts

Every callback a script registers with a Galaxy plugin (queue results and
starts, finished calls, sign-in changes, records written) is called through
the document's automation (`callScript`, `src/webAutomation/scriptCalls.ts`),
never directly. heavy-file-format stops a script that renders 10 times within
2 s, and a run's callbacks share one step budget until 3 s pass with none
running; background work answering every moment would run into either, and a
callback stopped that way fails silently. `ScriptCalls` starts calls in order
and no faster than those limits allow, and resolves false for a call the
document closed before it ran (the queue then keeps that result for the next
copy). Keep callbacks small too: write what arrived, and leave drawing to the
document's own hook run.

## No undo during background work

While a mounted document has background work, Galaxy turns its undo off
(heavy-file-format's `disableUndo`, which also clears the history) and back on
once it ends (`enableUndo`, starting from there). Undo kept a copy of the whole
database each 5 s step of script work, and a few hundred steps of a large
database's scoring ran the page past WebKit's 4 GB limit, which kills it.

"Background work" is worked out from state, not a quiet spell
(`isBusy`/`onBusyChange` in `src/webAutomation/entryPoints.ts`): a queue with
entries to run or retry, or a result its script hasn't finished with
(`DurableQueue.hasWork`); a collection run going; a call in flight, counted with
callbacks until one is handed its outcome; a call into the document's scripts
not yet over. A paused queue, or one waiting for Resume, isn't busy. The
mount's wrapper (`withWebAutomation`, `src/hvy.ts`) listens through
`watchBackgroundWork` (`src/webAutomation/app.ts`). Only the mounted document
records undo at all: heavy-file-format records none for scripts run in a
document that isn't its live one, such as a background tab's.

When adding a new kind of background work, count it there, with no gap
between it ending and its script hearing of it, or undo comes back on mid-run.

## Tracing a hang or out-of-memory page

When the app freezes or runs out of memory, devtools is often unusable. The
Tauri app can write each step to a file as it happens instead (`src/traceLog.ts`):
the debug log's events and timed work, renders, and all console output, each
line before the step runs, so the file's last lines say what the page was doing.
It is off by default, as it costs an IPC call per line. To turn it on, run
`localStorage.setItem('hvyTrace', '1')` in the page's console and reload; to turn
it off, `localStorage.removeItem('hvyTrace')` and reload. The file is
`~/Library/Logs/com.heavyresume.hvy-galaxy/trace.log` on macOS, started over past
50 MB. Electron has no trace.

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

Web automation waits a random 0.5–1.5 s between page loads on a site, as a
person browsing would. In development, `VITE_WEB_AUTOMATION_DELAY_SCALE`
scales those waits (production always uses the full delays):

```bash
VITE_WEB_AUTOMATION_DELAY_SCALE=0.25 npm run tauri dev
```

Run Rust unit tests:

```bash
cd src-tauri
cargo test
```
