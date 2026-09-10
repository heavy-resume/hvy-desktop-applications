import { getAttachment, removeAttachment, setAttachment } from '../../heavy-file-format/src/attachments';
import { decryptDocumentEnvelopeBytes, encryptDocumentBytes } from '../../heavy-file-format/src/encryption';
import { deserializeDocumentBytesAsync, serializeDocumentBytesAsync } from '../../heavy-file-format/src/serialization';
import type { VisualDocument } from '../../heavy-file-format/src/types';
import type { DocumentExtension, Workspace, WorkspaceTreeNode } from './backend';
import { readDocumentFileBytes, stageDocumentKeyMigrationFile } from './backend';
import { documentEncryptionKeyring, ensureDocumentKeysLoaded, extractDocumentEnvelopeKeyId, extractEncryptionKeyIds } from './documentKeys';
import { decryptFolderManifest, encryptFolderManifest } from './encryptedFolders';

type VisualBlock = VisualDocument['sections'][number]['blocks'][number];

export interface DocumentKeyMigrationResult {
  documents: number;
  folders: number;
}

export interface DocumentKeyMigrationProgress {
  kind: 'document' | 'folder';
  label: string;
}

export interface DocumentKeyMigrationChange {
  previousKeyId: string;
  nextKeyId: string;
  nextKeyOverride?: string;
}

export function migrateVisualDocumentKeyId(document: VisualDocument, previousKeyId: string, nextKeyId: string): boolean {
  let changed = false;
  const attachmentMoves = new Map<string, string>();
  const visitBlocks = (blocks: VisualBlock[]): void => {
    for (const block of blocks) {
      if (block.schema.kind === 'encrypted' && block.schema.keyId === previousKeyId) {
        const previousAttachmentId = block.schema.encryptedAttachmentId || `encrypted:${previousKeyId}`;
        const nextAttachmentId = `encrypted:${nextKeyId}`;
        attachmentMoves.set(previousAttachmentId, nextAttachmentId);
        block.schema.keyId = nextKeyId;
        block.schema.encryptedAttachmentId = nextAttachmentId;
        changed = true;
      }
      visitBlocks(block.schema.containerBlocks ?? []);
      visitBlocks(block.schema.componentListBlocks ?? []);
      visitBlocks(block.schema.expandableStubBlocks?.children ?? []);
      visitBlocks(block.schema.expandableContentBlocks?.children ?? []);
      for (const item of block.schema.gridItems ?? []) visitBlocks([item.block]);
      if (block.schema.kind === 'encrypted' && block.schema.encryptedBlock) visitBlocks([block.schema.encryptedBlock]);
    }
  };
  const visitSections = (sections: VisualDocument['sections']): void => {
    for (const section of sections) {
      visitBlocks(section.blocks);
      visitSections(section.children);
    }
  };
  visitSections(document.sections);
  for (const [previousAttachmentId, nextAttachmentId] of attachmentMoves) {
    const attachment = getAttachment(document, previousAttachmentId);
    if (attachment) setAttachment(document, nextAttachmentId, attachment.meta, attachment.bytes);
    if (previousAttachmentId !== nextAttachmentId) removeAttachment(document, previousAttachmentId);
  }
  if (document.encryption?.encrypted === true && document.encryption.keyId === previousKeyId) {
    document.encryption.keyId = nextKeyId;
    changed = true;
  }
  return changed;
}

export async function migrateDocumentBytesKeyId(
  bytes: Uint8Array,
  extension: DocumentExtension,
  previousKeyId: string,
  nextKeyId: string,
  nextKeyOverride?: string,
  onMigrating?: () => void,
  previousKeyOverride?: string,
): Promise<Uint8Array | null> {
  return migrateDocumentBytesKeyChanges(bytes, extension, [{ previousKeyId, nextKeyId, nextKeyOverride }], onMigrating, previousKeyOverride
    ? { [previousKeyId]: previousKeyOverride }
    : {});
}

async function migrateDocumentBytesKeyChanges(
  bytes: Uint8Array,
  extension: DocumentExtension,
  changes: DocumentKeyMigrationChange[],
  onMigrating?: () => void,
  readKeyOverrides: Record<string, string> = {},
): Promise<Uint8Array | null> {
  const outerKeyId = extractDocumentEnvelopeKeyId(bytes);
  if (outerKeyId) await ensureDocumentKeysLoaded([outerKeyId]);
  const currentKeyring = documentEncryptionKeyring();
  const readKeyring = { ...currentKeyring, ...readKeyOverrides };
  const plaintext = outerKeyId
    ? (await decryptDocumentEnvelopeBytes(bytes, { keyring: readKeyring })).bytes
    : bytes;
  const usedKeyIds = new Set([...(outerKeyId ? [outerKeyId] : []), ...extractEncryptionKeyIds(plaintext)]);
  const applicable = changes.filter((change) => usedKeyIds.has(change.previousKeyId));
  if (applicable.length === 0) return null;
  onMigrating?.();
  const readEncryption = { keyring: readKeyring };
  const writeKeyring = { ...currentKeyring };
  for (const change of applicable) {
    if (change.nextKeyOverride) writeKeyring[change.nextKeyId] = change.nextKeyOverride;
  }
  const writeEncryption = { keyring: writeKeyring };
  const document = await deserializeDocumentBytesAsync(bytes, extension, { encryption: readEncryption });
  for (const change of applicable) migrateVisualDocumentKeyId(document, change.previousKeyId, change.nextKeyId);
  const serialized = await serializeDocumentBytesAsync(document, null, { encryption: writeEncryption });
  if (document.encryption?.encrypted !== true) return serialized;
  const key = writeEncryption.keyring[document.encryption.keyId];
  if (!key) throw new Error(`Encryption key ${document.encryption.keyId} is not loaded.`);
  return (await encryptDocumentBytes(serialized, { keyId: document.encryption.keyId, key })).bytes;
}

export async function migrateWorkspaceDocumentKeyId(
  workspaces: Workspace[],
  migrationId: string,
  changes: DocumentKeyMigrationChange[],
  onProgress?: (progress: DocumentKeyMigrationProgress) => void,
): Promise<DocumentKeyMigrationResult> {
  const files = new Map<string, { file: Extract<WorkspaceTreeNode, { kind: 'file' }>; label: string }>();
  const folders = new Map<string, { node: Extract<WorkspaceTreeNode, { kind: 'folder' }>; label: string }>();
  const collect = (workspaceName: string, nodes: WorkspaceTreeNode[], logicalParent: string[] = []): void => {
    for (const node of nodes) {
      const logicalPath = [...logicalParent, node.name];
      const label = [workspaceName, ...logicalPath].join(' / ');
      if (node.kind === 'file') {
        files.set(node.path, { file: node, label });
      } else {
        if (node.encryptedFolderManifest) folders.set(node.path, { node, label });
        collect(workspaceName, node.children, logicalPath);
      }
    }
  };
  for (const workspace of workspaces) collect(workspace.manifest.name, workspace.files);

  let documentCount = 0;
  for (const { file, label } of files.values()) {
    const bytes = await readDocumentFileBytes(file.path);
    const migrated = await migrateDocumentBytesKeyChanges(
      bytes,
      file.extension,
      changes,
      () => onProgress?.({ kind: 'document', label }),
    );
    if (!migrated) continue;
    await stageDocumentKeyMigrationFile({ migrationId, path: file.path, previousBytes: bytes, bytes: migrated });
    documentCount += 1;
  }

  let folderCount = 0;
  for (const { node, label } of folders.values()) {
    const previousManifestBytes = Uint8Array.from(node.encryptedFolderManifest!);
    const change = changes.find((candidate) => candidate.previousKeyId === node.encryptedFolderKeyId);
    if (!change) continue;
    const previousKey = documentEncryptionKeyring()[change.previousKeyId];
    if (!previousKey) throw new Error(`Encryption key ${change.previousKeyId} is not loaded.`);
    const nextKey = change.nextKeyOverride ?? documentEncryptionKeyring()[change.nextKeyId];
    if (!nextKey) throw new Error(`Encryption key ${change.nextKeyId} is not loaded.`);
    onProgress?.({ kind: 'folder', label });
    const manifest = await decryptFolderManifest(previousManifestBytes, previousKey);
    const manifestBytes = await encryptFolderManifest(manifest, change.nextKeyId, nextKey);
    const separator = node.path.includes('\\') ? '\\' : '/';
    await stageDocumentKeyMigrationFile({
      migrationId,
      path: `${node.path}${separator}.hvy-folder`,
      previousBytes: previousManifestBytes,
      bytes: manifestBytes,
    });
    folderCount += 1;
  }
  return { documents: documentCount, folders: folderCount };
}
