export type RichTextAction = 'bold' | 'italic' | 'underline' | 'strikethrough';

export function findRichTextActionButton(editable: HTMLElement, action: RichTextAction): HTMLButtonElement | null {
  const surface = editable.closest<HTMLElement>(
    '.table-inline-edit-shell, .caption-text-modal, .text-editor-shell, .editor-block',
  );
  return surface?.querySelector<HTMLButtonElement>(`[data-rich-action="${action}"]`) ?? null;
}

export function hasOpenHvyModal(root: ParentNode): boolean {
  return Boolean(root.querySelector('.modal-root'));
}

export function richTextActionForShortcutKey(key: string, shiftKey: boolean): RichTextAction | null {
  if (!shiftKey && key === 'b') return 'bold';
  if (!shiftKey && key === 'i') return 'italic';
  if (!shiftKey && key === 'u') return 'underline';
  if (shiftKey && key === 'x') return 'strikethrough';
  return null;
}
