const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DOCUMENT_KEY_VAULT_AAD = 'hvy-galaxy-document-key-vault-v1';

function writeFileAtomically(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function writeDocumentKeyVaultFile(target, key, vault) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(DOCUMENT_KEY_VAULT_AAD));
  const plaintext = Buffer.from(JSON.stringify(vault));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  writeFileAtomically(target, Buffer.from(JSON.stringify({
    version: 1,
    algorithm: 'AES-256-GCM',
    nonce: nonce.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  }, null, 2)));
}

function readDocumentKeyVaultFile(target, key) {
  const envelope = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') throw new Error('Unsupported document key vault format.');
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const encrypted = Buffer.from(envelope.ciphertext, 'base64');
  if (nonce.length !== 12 || encrypted.length < 16) throw new Error('The document key vault is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(DOCUMENT_KEY_VAULT_AAD));
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
  const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]);
  const vault = JSON.parse(plaintext.toString('utf8'));
  if (vault?.version !== 1 || !vault.keys || typeof vault.keys !== 'object' || Array.isArray(vault.keys)) {
    throw new Error('The document key vault is invalid.');
  }
  return vault;
}

function deleteDocumentKeyFromVaultFile(target, key, keyId) {
  const vault = readDocumentKeyVaultFile(target, key);
  if (!vault.keys[keyId]) throw new Error(`Encryption key ${keyId} is not stored on this device.`);
  delete vault.keys[keyId];
  writeDocumentKeyVaultFile(target, key, vault);
}

module.exports = { deleteDocumentKeyFromVaultFile, readDocumentKeyVaultFile, writeDocumentKeyVaultFile };
