import { describe, expect, it } from 'vitest';
import { decryptDocumentEnvelopeBytes, encryptDocumentBytes } from '../../heavy-file-format/src/encryption';
import { documentEncryptionKeyring, extractDocumentEnvelopeKeyId } from './documentKeys';
import { migrateDocumentBytesKeyId, migrateVisualDocumentKeyId } from './documentKeyMigration';
import type { VisualDocument } from './hvy';

const PREVIOUS_KEY_ID = '11111111-1111-4111-8111-111111111111';
const NEXT_KEY_ID = '22222222-2222-4222-8222-222222222222';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const REPLACEMENT_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';

describe('document key ID migration', () => {
  it('updates whole-document and component key references while preserving encrypted attachment bytes', () => {
    const token = new Uint8Array([1, 2, 3]);
    const encryptedBlock = {
      schema: {
        kind: 'encrypted',
        keyId: PREVIOUS_KEY_ID,
        encryptedAttachmentId: `encrypted:${PREVIOUS_KEY_ID}`,
      },
    };
    const document = {
      meta: {},
      extension: '.hvy',
      sections: [{ blocks: [encryptedBlock], children: [] }],
      attachments: [{
        id: `encrypted:${PREVIOUS_KEY_ID}`,
        meta: { mediaType: 'application/vnd.hvy.encrypted-component+fernet' },
        bytes: token,
      }],
      encryption: { algorithm: 'fernet', keyId: PREVIOUS_KEY_ID, encrypted: true },
    } as unknown as VisualDocument;

    expect(migrateVisualDocumentKeyId(document, PREVIOUS_KEY_ID, NEXT_KEY_ID)).toBe(true);
    expect(document.encryption?.keyId).toBe(NEXT_KEY_ID);
    expect(encryptedBlock.schema).toMatchObject({
      keyId: NEXT_KEY_ID,
      encryptedAttachmentId: `encrypted:${NEXT_KEY_ID}`,
    });
    expect(document.attachments).toEqual([expect.objectContaining({
      id: `encrypted:${NEXT_KEY_ID}`,
      bytes: token,
    })]);
  });

  it('rewrites a saved encrypted document so the preserved key ID opens it', async () => {
    const plaintext = new TextEncoder().encode('---\nhvy_version: 0.1\ntitle: "Plans"\n---\n');
    const encrypted = await encryptDocumentBytes(plaintext, { keyId: PREVIOUS_KEY_ID, key: KEY });
    const keyring = documentEncryptionKeyring();
    keyring[PREVIOUS_KEY_ID] = KEY;
    keyring[NEXT_KEY_ID] = KEY;

    const migrated = await migrateDocumentBytesKeyId(encrypted.bytes, '.hvy', PREVIOUS_KEY_ID, NEXT_KEY_ID);

    expect(migrated).not.toBeNull();
    expect(extractDocumentEnvelopeKeyId(migrated!)).toBe(NEXT_KEY_ID);
    const decrypted = await decryptDocumentEnvelopeBytes(migrated!, { keyring });
    expect(new TextDecoder().decode(decrypted.bytes)).toContain('title: Plans');
    delete keyring[PREVIOUS_KEY_ID];
    delete keyring[NEXT_KEY_ID];
  });

  it('re-encrypts an existing document with replacement material under the same key ID', async () => {
    const plaintext = new TextEncoder().encode('---\nhvy_version: 0.1\ntitle: "Plans"\n---\n');
    const encrypted = await encryptDocumentBytes(plaintext, { keyId: PREVIOUS_KEY_ID, key: KEY });
    const keyring = documentEncryptionKeyring();
    keyring[PREVIOUS_KEY_ID] = REPLACEMENT_KEY;

    const migrated = await migrateDocumentBytesKeyId(
      encrypted.bytes,
      '.hvy',
      PREVIOUS_KEY_ID,
      PREVIOUS_KEY_ID,
      REPLACEMENT_KEY,
      undefined,
      KEY,
    );

    expect(migrated).not.toBeNull();
    const decrypted = await decryptDocumentEnvelopeBytes(migrated!, { keyring: { [PREVIOUS_KEY_ID]: REPLACEMENT_KEY } });
    expect(new TextDecoder().decode(decrypted.bytes)).toContain('title: Plans');
    await expect(decryptDocumentEnvelopeBytes(migrated!, { keyring: { [PREVIOUS_KEY_ID]: KEY } })).rejects.toThrow();
    delete keyring[PREVIOUS_KEY_ID];
  });
});
