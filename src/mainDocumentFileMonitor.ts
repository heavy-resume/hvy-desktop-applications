import { isElectronRuntime, isTauriRuntime, readDocumentFile, readDocumentFileBytes, readDocumentFileStamp } from './backend';
import { documentFileChanges } from './documentFileChanges';
import { state } from './state';
import { clearRecoveryDraftsForDocument, openDocument, renderAllAroundDocument, runBusy } from './main';

export function startDocumentFileMonitor(): void {
  if (!isElectronRuntime() && !isTauriRuntime()) return;
  let checking = false;
  const check = async () => {
    const current = state.document;
    if (checking || state.busy || !current?.source.path || current.isNew || current.virtual) return;
    checking = true;
    const path = current.source.path;
    try {
      const changed = await documentFileChanges.check(path,
        () => readDocumentFileStamp(path), () => readDocumentFileBytes(path));
      if (changed && state.document === current && !state.busy && state.externalFileChangePath !== path) {
        state.externalFileChangePath = path;
        renderAllAroundDocument();
      }
    } catch {
      // Atomic replacements can briefly remove the path. Retry on the next check.
    } finally {
      checking = false;
    }
  };
  const timer = window.setInterval(() => void check(), 3000);
  window.addEventListener('focus', check);
  import.meta.hot?.dispose(() => {
    window.clearInterval(timer);
    window.removeEventListener('focus', check);
  });
}

export function dismissExternalFileChange(): void {
  if (state.externalFileChangePath) documentFileChanges.dismiss(state.externalFileChangePath);
  state.externalFileChangePath = null;
  renderAllAroundDocument();
}

export async function reloadExternalFileChange(): Promise<void> {
  const current = state.document;
  if (!current || current.source.path !== state.externalFileChangePath) return;
  await runBusy('Reloading document...', async () => {
    const file = await readDocumentFile(current.source.path);
    await openDocument(file, { source: current.source, reloadFromDisk: true, initialMode: current.mode });
    await clearRecoveryDraftsForDocument(file.path, file.name);
  });
}
