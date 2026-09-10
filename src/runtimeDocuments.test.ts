import { beforeEach, describe, expect, it } from 'vitest';
import { resetRuntimeDocuments, runtimeDocumentAtPath, runtimeDocumentForFile, updateRuntimeDocumentFile } from './runtimeDocuments';

describe('runtime documents', () => {
  beforeEach(() => resetRuntimeDocuments());

  it('keeps document and working-version identity stable when the file path changes', () => {
    const document = runtimeDocumentForFile({ path: '/workspace/Old.hvy', name: 'Old.hvy', extension: '.hvy' });
    const documentId = document.documentId;
    const versionId = document.workingVersionId;

    updateRuntimeDocumentFile(document, { path: '/workspace/New.hvy', name: 'New.hvy', extension: '.hvy' });

    expect(document).toMatchObject({
      documentId,
      workingVersionId: versionId,
      path: '/workspace/New.hvy',
      name: 'New.hvy',
    });
    expect(runtimeDocumentAtPath('/workspace/Old.hvy')).toBeNull();
    expect(runtimeDocumentAtPath('/workspace/New.hvy')).toBe(document);
  });

  it('shares one runtime document for versions opened from the same source path', () => {
    const working = runtimeDocumentForFile({ path: '/workspace/Example.hvy', name: 'Example.hvy', extension: '.hvy' });
    const recovery = runtimeDocumentForFile({ path: '/workspace/Example.hvy', name: 'Example.hvy', extension: '.hvy' });

    expect(recovery).toBe(working);
  });

  it('gives distinct unsaved documents independent identities', () => {
    const first = runtimeDocumentForFile({ path: '', name: 'Untitled.hvy', extension: '.hvy' }, { distinct: true });
    const second = runtimeDocumentForFile({ path: '', name: 'Untitled.hvy', extension: '.hvy' }, { distinct: true });

    expect(second.documentId).not.toBe(first.documentId);
    expect(second.workingVersionId).not.toBe(first.workingVersionId);
  });
});
