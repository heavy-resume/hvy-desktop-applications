import { rerender } from './main';
import { state } from './state';
import { documentsNeedingYou, hasWebAutomationHost, subscribeWebAutomation } from './webAutomation/app';

/**
 * Marks the tabs of open documents whose background work waits for the user (a page to deal with, a sign-in). The
 * notice itself, and what to do, is in the document beside the block that needs them; the mark is how to find which
 * document. The app rerenders only when the set of marked documents changes, not on every automation event.
 */
export function installBackgroundActivity(): void {
  if (!hasWebAutomationHost()) return;
  let scheduled = false;
  subscribeWebAutomation(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const paths = documentsNeedingYou();
      if (paths.join('\n') === state.documentsNeedingYou.join('\n')) return;
      state.documentsNeedingYou = paths;
      rerender({ preserveMountedDocument: true });
    });
  });
}
