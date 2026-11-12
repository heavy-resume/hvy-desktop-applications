import { appRoot } from './core';

const TOAST_MS = 3000;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A short message at the top of the document stage, where the error line would be, that fades away. It lives in the
 * stage itself, which renders never replace, so a render while it shows keeps it.
 */
export function showToast(message: string): void {
  const stage = appRoot.querySelector<HTMLElement>('.document-stage');
  if (!stage) return;
  let toast = stage.querySelector<HTMLElement>('.app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    stage.append(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-shown');
  if (hideTimer) clearTimeout(hideTimer);
  const shown = toast;
  hideTimer = setTimeout(() => {
    shown.classList.remove('is-shown');
    hideTimer = null;
  }, TOAST_MS);
}
