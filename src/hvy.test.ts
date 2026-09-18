import { describe, expect, it } from 'vitest';
import { isMountedDocumentDirty, markMountedDocumentSaved, restoreRawHvyAttachmentBytes, type MountedDocument, type VisualDocument } from './hvy';
import { documentDirtyAfterMountedChange } from './recoveryDocuments';

it('retains an unsaved remount baseline until an explicit save, even when the editor is clean', () => {
  let editorDirty = false;
  const mounted = {
    unsavedBaseline: true,
    mount: {
      isDirty: () => editorDirty,
      markSaved: () => { editorDirty = false; },
    },
  } as MountedDocument;
  const changeDirty = () => documentDirtyAfterMountedChange(editorDirty, undefined, false, mounted.unsavedBaseline);
  expect(isMountedDocumentDirty(mounted)).toBe(true);
  expect(changeDirty()).toBe(true);
  markMountedDocumentSaved(mounted);
  expect(isMountedDocumentDirty(mounted)).toBe(false);
  expect(changeDirty()).toBe(false);
  editorDirty = true;
  expect(changeDirty()).toBe(true);
  editorDirty = false;
  expect(changeDirty()).toBe(false);
});

describe('restoreRawHvyAttachmentBytes', () => {
  it('restores previous attachment bytes for raw HVY drafts that keep the same tail ids', () => {
    const previousBytes = new Uint8Array([1, 2, 3, 4]);
    const document = documentWithAttachments([
      {
        id: 'image:photo.png',
        meta: { mediaType: 'image/png' },
        bytes: new Uint8Array(),
      },
    ]);

    restoreRawHvyAttachmentBytes(document, [
      {
        id: 'image:photo.png',
        meta: { mediaType: 'image/png' },
        bytes: previousBytes,
      },
    ]);

    expect(Array.from(document.attachments[0]?.bytes ?? [])).toEqual([1, 2, 3, 4]);
    expect(document.attachments[0]?.bytes).not.toBe(previousBytes);
  });

  it('does not restore bytes for attachments removed from the raw source', () => {
    const document = documentWithAttachments([]);

    restoreRawHvyAttachmentBytes(document, [
      {
        id: 'image:removed.png',
        meta: { mediaType: 'image/png' },
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ]);

    expect(document.attachments).toEqual([]);
  });
});

function documentWithAttachments(attachments: VisualDocument['attachments']): VisualDocument {
  return {
    extension: '.hvy',
    meta: { hvy_version: 0.1 },
    sections: [],
    attachments,
  };
}
