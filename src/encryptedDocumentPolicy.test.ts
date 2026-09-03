import { describe, expect, it } from 'vitest';
import { encryptedDocumentPlaintextPolicy, isWholeDocumentEncrypted, recoveryStateForPersistence } from './encryptedDocumentPolicy';
import type { VisualDocument } from './hvy';
import { setAttachment } from '../../heavy-file-format/src/attachments';
import { ensureDocumentAttachmentStore } from '../../heavy-file-format/src/attachment-store';
import { removeDocumentEmbeddingAttachments } from './embeddingIndex';

const encrypted = { encryption: { algorithm: 'fernet', keyId: 'key-id', encrypted: true } } as VisualDocument;
const plaintext = { encryption: undefined } as VisualDocument;

describe('encrypted document plaintext policy', () => {
  it('blocks persisted plaintext derivatives while keeping explicit local-only experiences defined', () => {
    expect(encryptedDocumentPlaintextPolicy).toMatchObject({
      rawMode: 'memoryOnly',
      pdfExport: 'explicitPlaintextExport',
      ai: 'blockedByDefaultWithExplicitEncryptedFolderConsent',
      embeddingIndexes: 'blockedAndRemoved',
      recoveryDrafts: 'encryptedDocumentBytesWithoutPlaintextUiState',
      savedVersions: 'disabledAndPurged',
    });
  });

  it('removes plaintext editor state from persisted recovery and hot-reload data', () => {
    expect(isWholeDocumentEncrypted(encrypted)).toBe(true);
    expect(recoveryStateForPersistence(encrypted, '{"plaintext":"secret"}')).toBeNull();
    expect(recoveryStateForPersistence(plaintext, '{"cursor":3}')).toBe('{"cursor":3}');
  });

  it('removes derived embedding attachments when document encryption is enabled', () => {
    const document = { extension: '.hvy', meta: {}, sections: [], attachments: [] } as VisualDocument;
    setAttachment(document, 'embedding-index:test', { mediaType: 'application/vnd.hvy.embedding-index' }, new Uint8Array([1]));
    setAttachment(document, 'image:test', { mediaType: 'image/png' }, new Uint8Array([2]));

    removeDocumentEmbeddingAttachments(document);

    expect(ensureDocumentAttachmentStore(document).list().map((attachment) => attachment.id)).toEqual(['image:test']);
  });
});
