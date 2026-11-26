// Development only: stands in for the browser windows the real host shows the
// user. When the automation opens a sign-in window, a small panel names the
// page and offers to finish the site's own login form, as a person would.
import type { MockHost } from './mockHost';

const STYLE = `
.mock-web-window {
  position: fixed;
  right: 1rem;
  bottom: 5rem;
  z-index: 10000;
  display: grid;
  gap: 0.5rem;
  max-width: 22rem;
  padding: 0.85rem;
  border: 2px dashed #8a5cf6;
  border-radius: 0.6rem;
  background: #f6f2ff;
  color: #2b1d4f;
  font: 13px system-ui;
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
}
.mock-web-window-title { font-weight: 700; }
.mock-web-window-url { overflow-wrap: anywhere; }
.mock-web-window-actions { display: flex; gap: 0.5rem; }
`;

export function showMockWindows(host: MockHost): void {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const panels = new Map<string, HTMLElement>();
  const close = (profileId: string) => {
    panels.get(profileId)?.remove();
    panels.delete(profileId);
  };

  const openUserWindow = host.openUserWindow.bind(host);
  host.openUserWindow = async (profileId, url) => {
    await openUserWindow(profileId, url);
    close(profileId);
    const panel = document.createElement('div');
    panel.className = 'mock-web-window';
    const title = document.createElement('div');
    title.className = 'mock-web-window-title';
    title.textContent = `Mock browser window (${profileId})`;
    const page = document.createElement('div');
    page.className = 'mock-web-window-url';
    page.textContent = url;
    const row = document.createElement('div');
    row.className = 'mock-web-window-actions';
    const signIn = document.createElement('button');
    signIn.type = 'button';
    signIn.textContent = 'Complete sign-in';
    signIn.addEventListener('click', () => host.completeLogin(profileId, new URL(url).origin));
    row.append(signIn);
    panel.append(title, page, row);
    document.body.append(panel);
    panels.set(profileId, panel);
  };

  const hideUserWindow = host.hideUserWindow.bind(host);
  host.hideUserWindow = async (profileId) => {
    await hideUserWindow(profileId);
    close(profileId);
  };
}
