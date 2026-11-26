/**
 * A still copy of the window, laid over it while Galaxy switches tabs on its own (a scheduled job opening its document,
 * running it, and going back), so the switch isn't seen. What the copy shows is the window as it was; clicks on it go
 * nowhere until it is taken away, once Galaxy is back on the user's tab and that has drawn.
 */
let cover: HTMLElement | null = null;
let depth = 0;

export async function behindScreenCover<T>(task: () => Promise<T>): Promise<T> {
  if (depth === 0) cover = showScreenCover();
  depth += 1;
  try {
    return await task();
  } finally {
    depth -= 1;
    if (depth === 0) {
      const shown = cover;
      cover = null;
      // After the next frame, so the tab underneath has drawn first.
      requestAnimationFrame(() => shown?.remove());
    }
  }
}

function showScreenCover(): HTMLElement | null {
  const app = document.getElementById('app');
  if (!app) return null;
  // The wrapper takes the pointer (inert parts aren't hit at all, so clicks would reach the window under it); the copy
  // inside is inert, so nothing in it takes focus.
  const wrapper = document.createElement('div');
  wrapper.className = 'screen-cover';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.backgroundColor = getComputedStyle(document.body).backgroundColor;
  const copy = app.cloneNode(true) as HTMLElement;
  copy.inert = true;
  wrapper.append(copy);
  const originals = [app, ...app.querySelectorAll<HTMLElement>('*')];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  // A copied frame or player would load or play again: it is left blank.
  for (const element of copies) {
    if (element instanceof HTMLIFrameElement) element.src = 'about:blank';
    if (element instanceof HTMLMediaElement) element.autoplay = false;
  }
  document.body.append(wrapper);
  // What cloning leaves out: where each part was scrolled to, what was typed or chosen, and what canvases drew.
  originals.forEach((original, index) => {
    const element = copies[index];
    if (original.scrollTop || original.scrollLeft) {
      element.scrollTop = original.scrollTop;
      element.scrollLeft = original.scrollLeft;
    }
    if (original instanceof HTMLInputElement && element instanceof HTMLInputElement) {
      element.value = original.value;
      element.checked = original.checked;
    } else if ((original instanceof HTMLTextAreaElement || original instanceof HTMLSelectElement) && (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      element.value = original.value;
    } else if (original instanceof HTMLCanvasElement && element instanceof HTMLCanvasElement) {
      element.getContext('2d')?.drawImage(original, 0, 0);
    }
  });
  return wrapper;
}
