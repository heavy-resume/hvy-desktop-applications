export type LinkOpeningMode = 'viewer' | 'ai' | 'editor' | 'hvy' | 'advanced';

export function shouldOpenExternalLinkForClick(
  mode: LinkOpeningMode,
  event: Pick<MouseEvent, 'altKey' | 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): boolean {
  if (event.button !== 0 || event.altKey || event.shiftKey) {
    return false;
  }
  if (mode === 'viewer' || mode === 'ai') {
    return true;
  }
  if (mode === 'editor' || mode === 'advanced') {
    return event.metaKey || event.ctrlKey;
  }
  return false;
}

export function externalHttpUrlFromHref(href: string | null | undefined): string | null {
  const value = href?.trim() ?? '';
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
