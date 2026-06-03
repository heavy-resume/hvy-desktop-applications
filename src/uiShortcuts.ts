export type RichTextAction = 'bold' | 'italic' | 'underline' | 'strikethrough';

export function richTextActionForShortcutKey(key: string, shiftKey: boolean): RichTextAction | null {
  if (!shiftKey && key === 'b') return 'bold';
  if (!shiftKey && key === 'i') return 'italic';
  if (!shiftKey && key === 'u') return 'underline';
  if (shiftKey && key === 'x') return 'strikethrough';
  return null;
}
