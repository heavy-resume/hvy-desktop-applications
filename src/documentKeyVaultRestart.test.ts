import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fernetDecryptBytes, fernetEncryptBytes, generateFernetKey } from '../../heavy-file-format/src/encryption';

const require = createRequire(import.meta.url);
const { deleteDocumentKeyFromVaultFile, readDocumentKeyVaultFile, writeDocumentKeyVaultFile } = require('../src-electron/document-key-vault.cjs') as {
  deleteDocumentKeyFromVaultFile(path: string, key: Uint8Array, keyId: string): void;
  readDocumentKeyVaultFile(path: string, key: Uint8Array): { version: number; keys: Record<string, { key: string; bundleLabels?: string[] }> };
  writeDocumentKeyVaultFile(path: string, key: Uint8Array, vault: unknown): void;
};

describe('Electron document key vault restart persistence', () => {
  it('recovers a persisted key and uses it to decrypt document data after reopening the vault', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hvy-electron-key-vault-'));
    const vaultPath = join(directory, 'document-key-vault-v1.json');
    const wrappingKey = crypto.getRandomValues(new Uint8Array(32));
    const documentKey = generateFernetKey();
    const keyId = '11111111-1111-4111-8111-111111111111';
    const plaintext = new TextEncoder().encode('encrypted document survives restart');
    const encrypted = await fernetEncryptBytes(plaintext, documentKey);

    writeDocumentKeyVaultFile(vaultPath, wrappingKey, {
      version: 1,
      keys: { [keyId]: { key: documentKey, createdAt: new Date().toISOString(), source: 'generated', bundleLabels: ['Quarterly planning'] } },
    });

    expect(readFileSync(vaultPath, 'utf8')).not.toContain(documentKey);
    const reopenedVault = readDocumentKeyVaultFile(vaultPath, wrappingKey);
    expect(await fernetDecryptBytes(encrypted, reopenedVault.keys[keyId].key)).toEqual(plaintext);
    expect(reopenedVault.keys[keyId]).toMatchObject({ bundleLabels: ['Quarterly planning'] });

    deleteDocumentKeyFromVaultFile(vaultPath, wrappingKey, keyId);
    expect(readDocumentKeyVaultFile(vaultPath, wrappingKey).keys[keyId]).toBeUndefined();
  });
});
