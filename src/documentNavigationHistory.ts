export type DocumentNavigationDirection = 'back' | 'forward';

const entries: string[] = [];
let index = -1;
let traversing = false;

export function recordDocumentNavigation(path: string): void {
  if (!path) return;
  if (traversing) {
    traversing = false;
    return;
  }
  if (entries[index] === path) return;
  entries.splice(index + 1);
  entries.push(path);
  index = entries.length - 1;
}

export function beginDocumentNavigation(direction: DocumentNavigationDirection): string | null {
  const nextIndex = index + (direction === 'back' ? -1 : 1);
  if (nextIndex < 0 || nextIndex >= entries.length) return null;
  index = nextIndex;
  traversing = true;
  return entries[index] ?? null;
}

export function cancelDocumentNavigation(direction: DocumentNavigationDirection): void {
  index += direction === 'back' ? 1 : -1;
  traversing = false;
}

export function resetDocumentNavigationHistory(): void {
  entries.splice(0);
  index = -1;
  traversing = false;
}

export function documentNavigationSnapshot(): { entries: string[]; index: number } {
  return { entries: [...entries], index };
}
