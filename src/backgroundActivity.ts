import { rerender } from './main';
import { state } from './state';
import { backgroundActivityLabel } from './ui/render-background-activity';
import { backgroundActivity, documentsNeedingYou, hasWebAutomationHost, subscribeWebAutomation } from './webAutomation/app';

// How long the indicator stays after the work ends, so a quick call does not flash it on and off.
const INDICATOR_LINGER_MS = 1500;

let lingering: ReturnType<typeof setTimeout> | null = null;

/**
 * Keeps the app's view of background work current: the tabs of open documents whose work waits for the user (the
 * notice itself, and what to do, is in the document beside the block that needs them), and the toolbar's Background
 * activity indicator and panel. The app rerenders only when the marked documents or the indicator change, or on any
 * event while the panel is open, not on every automation event otherwise.
 */
export function installBackgroundActivity(): void {
  if (!hasWebAutomationHost()) return;
  let scheduled = false;
  subscribeWebAutomation(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update(true);
    });
  });
}

function update(linger: boolean): void {
  const paths = documentsNeedingYou();
  const activity = backgroundActivity();
  let label = backgroundActivityLabel(activity);
  if (label && lingering) {
    clearTimeout(lingering);
    lingering = null;
  }
  // The work ended: the indicator keeps what it said for a moment, then reads again.
  if (!label && state.backgroundActivityLabel && (linger || lingering)) {
    lingering ??= setTimeout(() => {
      lingering = null;
      update(false);
    }, INDICATOR_LINGER_MS);
    label = state.backgroundActivityLabel;
  }
  const changed = state.backgroundActivityOpen
    || label?.full !== state.backgroundActivityLabel?.full
    || paths.join('\n') !== state.documentsNeedingYou.join('\n');
  state.documentsNeedingYou = paths;
  state.backgroundActivity = activity;
  state.backgroundActivityLabel = label;
  if (changed) rerender({ preserveMountedDocument: true });
}

/** Reads background work now: when the panel opens, rather than waiting for the next event. */
export function refreshBackgroundActivity(): void {
  if (hasWebAutomationHost()) state.backgroundActivity = backgroundActivity();
}
