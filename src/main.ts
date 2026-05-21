import './styles.css';
import {
  chooseGalaxyFolder,
  createDocumentFile,
  initializeGalaxyPath,
  loadGalaxy,
  loadRecentState,
  newGalaxyDialog,
  onMenuEvent,
  openFileDialog,
  readDocumentFile,
  saveDocumentAsDialog,
  saveDocumentFile,
  type DocumentFile,
} from './backend';
import { deserializeHvy, mountHvyDocument, serializeMountedDocument } from './hvy';
import { state } from './state';
import { render, type UiHandlers } from './ui';

let mountRoot: HTMLElement | null = null;

const handlers: UiHandlers = {
  newGalaxy: () => void runBusy('Creating galaxy...', async () => {
    const galaxy = await newGalaxyDialog();
    if (!galaxy) return;
    upsertGalaxy(galaxy);
    state.selectedGalaxyPath = galaxy.path;
    await refreshRecents();
    rerender();
  }),
  openGalaxy: () => void runBusy('Opening galaxy...', async () => {
    const candidate = await chooseGalaxyFolder();
    if (!candidate) return;
    const galaxy = candidate.hasManifest
      ? await loadGalaxy(candidate.path)
      : await confirmGalaxyInitialization(candidate.path, candidate.defaultName);
    if (!galaxy) {
      state.status = 'Ready';
      return;
    }
    upsertGalaxy(galaxy);
    state.selectedGalaxyPath = galaxy.path;
    await refreshRecents();
    rerender();
  }),
  openFile: () => void runBusy('Opening file...', async () => {
    const file = await openFileDialog();
    if (!file) return;
    await openDocument(file);
    await refreshRecents();
  }),
  openRecentGalaxy: (path) => void runBusy('Opening recent galaxy...', async () => {
    upsertGalaxy(await loadGalaxy(path));
    state.selectedGalaxyPath = path;
    await refreshRecents();
    rerender();
  }),
  openRecentFile: (path) => void runBusy('Opening recent file...', async () => {
    await openDocument(await readDocumentFile(path));
    await refreshRecents();
  }),
  selectFile: (path) => void runBusy('Opening file...', async () => {
    await openDocument(await readDocumentFile(path));
    await refreshRecents();
  }),
  toggleMode: () => {
    if (!state.document) return;
    const document = state.document.mounted?.document;
    state.document.mode = state.document.mode === 'viewer' ? 'editor' : 'viewer';
    rerender();
    mountCurrentDocument(document);
  },
  save: () => void saveCurrentDocument(),
  saveAs: () => void saveCurrentDocumentAs(),
  createFile: () => void createFileInSelectedGalaxy(),
};

void boot();

async function boot(): Promise<void> {
  await refreshRecents();
  await loadRecentGalaxies();
  mountRoot = render(state, handlers);
  await onMenuEvent((event) => {
    if (event === 'new-galaxy') handlers.newGalaxy();
    if (event === 'open-galaxy') handlers.openGalaxy();
    if (event === 'open-file') handlers.openFile();
    if (event === 'save') handlers.save();
    if (event === 'save-as') handlers.saveAs();
    if (event.startsWith('recent-galaxy:')) handlers.openRecentGalaxy(event.slice('recent-galaxy:'.length));
    if (event.startsWith('recent-file:')) handlers.openRecentFile(event.slice('recent-file:'.length));
  });
}

async function refreshRecents(): Promise<void> {
  state.recent = await loadRecentState();
}

async function loadRecentGalaxies(): Promise<void> {
  for (const path of state.recent.galaxies) {
    try {
      upsertGalaxy(await loadGalaxy(path));
    } catch {
      // Recents are pruned by the backend when they are opened or reloaded.
    }
  }
  state.selectedGalaxyPath = state.galaxies[0]?.path ?? null;
}

async function openDocument(file: DocumentFile): Promise<void> {
  state.document?.mounted?.mount.destroy();
  const bytes = new Uint8Array(file.bytes);
  const document = deserializeHvy(bytes, file.extension);
  state.document = {
    path: file.path,
    name: file.name,
    extension: file.extension,
    mode: 'viewer',
    dirty: false,
    mounted: null,
  };
  state.selectedFilePath = file.path;
  state.status = `Opened ${file.name}`;
  rerender();
  mountCurrentDocument(document);
}

function mountCurrentDocument(document = state.document?.mounted?.document): void {
  if (!state.document || !mountRoot || !document) return;
  state.document.mounted?.mount.destroy();
  state.document.mounted = mountHvyDocument(mountRoot, document, state.document.mode);
  if (state.document.mode === 'editor') {
    markDirtyOnEditorInput(mountRoot);
  }
}

function markDirtyOnEditorInput(root: HTMLElement): void {
  const markDirty = () => {
    if (!state.document || state.document.dirty) return;
    state.document.dirty = true;
    state.status = 'Unsaved changes';
    updateDirtyChrome();
  };
  root.addEventListener('input', markDirty, { once: true, capture: true });
  root.addEventListener('change', markDirty, { once: true, capture: true });
}

function updateDirtyChrome(): void {
  document.querySelector('.dirty-indicator')?.replaceChildren(document.createTextNode('Unsaved'));
  document.querySelector<HTMLButtonElement>('[data-action="save"]')?.removeAttribute('disabled');
  document.querySelector('.status-bar')?.replaceChildren(document.createTextNode(state.status));
}

async function saveCurrentDocument(): Promise<void> {
  await runBusy('Saving...', async () => {
    if (!state.document?.mounted) return;
    const bytes = Array.from(serializeMountedDocument(state.document.mounted));
    await saveDocumentFile({ path: state.document.path, bytes });
    state.document.dirty = false;
    state.status = `Saved ${state.document.name}`;
    const document = state.document.mounted.document;
    await refreshOpenGalaxyForFile(state.document.path);
    await refreshRecents();
    rerender();
    mountCurrentDocument(document);
  });
}

async function saveCurrentDocumentAs(): Promise<void> {
  await runBusy('Saving as...', async () => {
    if (!state.document?.mounted) return;
    const bytes = Array.from(serializeMountedDocument(state.document.mounted));
    const file = await saveDocumentAsDialog({ suggestedName: state.document.name, bytes });
    if (!file) return;
    const document = deserializeHvy(new Uint8Array(file.bytes), file.extension);
    state.document = {
      path: file.path,
      name: file.name,
      extension: file.extension,
      mode: state.document.mode,
      dirty: false,
      mounted: null,
    };
    state.selectedFilePath = file.path;
    state.status = `Saved ${file.name}`;
    await refreshOpenGalaxyForFile(file.path);
    await refreshRecents();
    rerender();
    mountCurrentDocument(document);
  });
}

async function createFileInSelectedGalaxy(): Promise<void> {
  await runBusy('Creating file...', async () => {
    if (!state.selectedGalaxyPath) return;
    const name = `untitled-${new Date().toISOString().replace(/[:.]/g, '-')}.hvy`;
    const file = await createDocumentFile({
      galaxyPath: state.selectedGalaxyPath,
      relativePath: name,
      template: defaultHvyDocument(),
    });
    await refreshOpenGalaxyForFile(file.path);
    await openDocument(file);
  });
}

async function refreshOpenGalaxyForFile(filePath: string): Promise<void> {
  const galaxy = state.galaxies.find((candidate) => filePath.startsWith(candidate.path));
  if (!galaxy) return;
  upsertGalaxy(await loadGalaxy(galaxy.path));
}

function upsertGalaxy(galaxy: Awaited<ReturnType<typeof loadGalaxy>>): void {
  const index = state.galaxies.findIndex((candidate) => candidate.path === galaxy.path);
  if (index >= 0) {
    state.galaxies[index] = galaxy;
  } else {
    state.galaxies.push(galaxy);
  }
}

function rerender(): void {
  state.document?.mounted?.mount.destroy();
  if (state.document) {
    state.document.mounted = null;
  }
  mountRoot = render(state, handlers);
}

async function runBusy(label: string, task: () => Promise<void>): Promise<void> {
  state.busy = true;
  state.error = null;
  state.status = label;
  try {
    await task();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    const document = state.document?.mounted?.document;
    rerender();
    mountCurrentDocument(document);
  }
}

function defaultHvyDocument(): string {
  return `---
hvy_version: 0.1
title: Untitled
---

<!--hvy: {"id":"start"}-->
#! Start

Start writing here.
`;
}

async function confirmGalaxyInitialization(path: string, defaultName: string) {
  const shouldInitialize = window.confirm(
    `"${defaultName}" is not an HVY galaxy yet. Create .hvygalaxy.json in this folder?`
  );
  return shouldInitialize ? initializeGalaxyPath(path) : null;
}
