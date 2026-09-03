import { beforeEach, describe, expect, it, vi } from 'vitest';
const backendMocks = vi.hoisted(() => ({ deleteDocumentKey: vi.fn(), loadDocumentKeys: vi.fn(), storeDocumentKeys: vi.fn() }));
vi.mock('./backend', async (importOriginal) => ({
  ...await importOriginal<typeof import('./backend')>(),
  loadDocumentKeys: backendMocks.loadDocumentKeys,
  deleteDocumentKey: backendMocks.deleteDocumentKey,
  storeDocumentKeys: backendMocks.storeDocumentKeys,
}));
import {
  documentKeyFingerprint,
  extractDocumentEnvelopeKeyId,
  extractEncryptionKeyIds,
  ensureDocumentKeysLoaded,
  generateStoredDocumentKey,
  parseDocumentKeyFile,
  parseDocumentKeyFiles,
  serializeDocumentKeyFile,
  permanentlyDeleteDocumentKey,
} from './documentKeys';

beforeEach(() => {
  backendMocks.loadDocumentKeys.mockReset().mockResolvedValue({});
  backendMocks.deleteDocumentKey.mockReset().mockResolvedValue(undefined);
  backendMocks.storeDocumentKeys.mockReset().mockResolvedValue(undefined);
});

const KEY_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_KEY_ID = '22222222-2222-4222-8222-222222222222';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SECOND_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';

describe('HVY document key files', () => {
  it('generates and persists a valid key before returning it', async () => {
    const generated = await generateStoredDocumentKey('Encrypted Plans');

    expect(generated.keyId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(parseDocumentKeyFile(new TextDecoder().decode(serializeDocumentKeyFile([generated]))).keys[0]).toEqual(generated);
    expect(backendMocks.storeDocumentKeys).toHaveBeenCalledWith([expect.objectContaining({
      keyId: generated.keyId,
      key: generated.key,
      label: 'Encrypted Plans',
      source: 'generated',
    })]);
  });

  it('does not publish a generated key when persistence fails', async () => {
    const before = { ...await import('./documentKeys').then((module) => module.documentEncryptionKeyring()) };
    backendMocks.storeDocumentKeys.mockRejectedValueOnce(new Error('vault unavailable'));
    await expect(generateStoredDocumentKey('Encrypted Plans')).rejects.toThrow('vault unavailable');
    expect(await import('./documentKeys').then((module) => ({ ...module.documentEncryptionKeyring() }))).toEqual(before);
  });

  it('round-trips the portable version 1 JSON format', () => {
    const bytes = serializeDocumentKeyFile([{
      keyId: KEY_ID,
      algorithm: 'fernet',
      key: KEY,
      label: 'Finance team',
      createdAt: '2026-09-02T12:00:00.000Z',
    }]);

    expect(parseDocumentKeyFile(new TextDecoder().decode(bytes))).toEqual({
      hvy_key_file: 1,
      keys: [{
        keyId: KEY_ID,
        algorithm: 'fernet',
        key: KEY,
        label: 'Finance team',
        createdAt: '2026-09-02T12:00:00.000Z',
      }],
    });
  });

  it('round-trips an optional bundle label and carries it into import metadata', () => {
    const bytes = serializeDocumentKeyFile([{ keyId: KEY_ID, algorithm: 'fernet', key: KEY }], { label: 'Quarterly planning' });
    expect(parseDocumentKeyFile(new TextDecoder().decode(bytes)).label).toBe('Quarterly planning');
    expect(parseDocumentKeyFiles([{ path: '/downloads/planning.hvykey', name: 'planning.hvykey', text: new TextDecoder().decode(bytes) }])[0])
      .toMatchObject({ bundleLabel: 'Quarterly planning', sourceName: 'planning.hvykey' });
  });

  it('removes a key from both the native vault and the session keyring', async () => {
    const generated = await generateStoredDocumentKey();
    expect((await import('./documentKeys')).documentEncryptionKeyring()[generated.keyId]).toBe(generated.key);

    await permanentlyDeleteDocumentKey(generated.keyId);

    expect(backendMocks.deleteDocumentKey).toHaveBeenCalledWith(generated.keyId);
    expect((await import('./documentKeys')).documentEncryptionKeyring()[generated.keyId]).toBeUndefined();
  });

  it('rejects invalid Fernet material and unsupported algorithms', () => {
    expect(() => parseDocumentKeyFile(JSON.stringify({
      hvy_key_file: 1,
      keys: [{ keyId: KEY_ID, algorithm: 'fernet', key: 'too-short' }],
    }))).toThrow('exactly 32 bytes');
    expect(() => parseDocumentKeyFile(JSON.stringify({
      hvy_key_file: 1,
      keys: [{ keyId: KEY_ID, algorithm: 'aes', key: KEY }],
    }))).toThrow(`Unsupported encryption algorithm for key ${KEY_ID}`);
  });

  it('deduplicates identical imports and rejects conflicting values for one key ID', () => {
    const source = (name: string, key: string) => ({
      name,
      path: `/downloads/${name}`,
      text: JSON.stringify({ hvy_key_file: 1, keys: [{ keyId: KEY_ID, algorithm: 'fernet', key }] }),
    });
    expect(parseDocumentKeyFiles([source('one.hvykey', KEY), source('two.hvykey', KEY)])).toHaveLength(1);
    expect(() => parseDocumentKeyFiles([source('one.hvykey', KEY), source('two.hvykey', SECOND_KEY)]))
      .toThrow(`Key ${KEY_ID} has conflicting values`);
  });

  it('produces a short stable fingerprint without exposing key bytes', () => {
    expect(documentKeyFingerprint(KEY)).toMatch(/^[0-9A-F]{4}(?:-[0-9A-F]{4}){5}$/);
    expect(documentKeyFingerprint(KEY)).not.toContain(KEY.slice(0, 8));
    expect(documentKeyFingerprint(KEY)).not.toBe(documentKeyFingerprint(SECOND_KEY));
  });
});

describe('encrypted HVY key discovery', () => {
  it('finds whole-document envelope and component key IDs without duplicates', () => {
    const source = `---HVY-ENCRYPTED---\n{"algorithm":"fernet","keyId":"${KEY_ID}"}\n---HVY-ENCRYPTED-PAYLOAD---\npayload\n<!--hvy:encrypted {"keyId":"${SECOND_KEY_ID}"}-->\n<!--hvy:encrypted {"keyId":"${SECOND_KEY_ID}"}-->`;
    expect(extractEncryptionKeyIds(new TextEncoder().encode(source))).toEqual([KEY_ID, SECOND_KEY_ID]);
    expect(extractDocumentEnvelopeKeyId(new TextEncoder().encode(source))).toBe(KEY_ID);
    expect(extractDocumentEnvelopeKeyId(new TextEncoder().encode(`<!--hvy:encrypted {"keyId":"${SECOND_KEY_ID}"}-->`))).toBeNull();
  });

  it('identifies the exact missing key and tells the user how to provide it', async () => {
    await expect(ensureDocumentKeysLoaded([SECOND_KEY_ID])).rejects.toThrow(
      `protected local vault does not contain the required encryption key: ${SECOND_KEY_ID}. Import the matching .hvykey file`,
    );
    expect(backendMocks.loadDocumentKeys).toHaveBeenCalledWith([SECOND_KEY_ID]);
  });
});
