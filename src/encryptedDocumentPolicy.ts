import type { VisualDocument } from './hvy';

export const encryptedDocumentPlaintextPolicy = Object.freeze({
  rawMode: 'memoryOnly',
  pdfExport: 'explicitPlaintextExport',
  ai: 'blocked',
  embeddingIndexes: 'blockedAndRemoved',
  workspaceTextSearch: 'memoryOnly',
  recoveryDrafts: 'encryptedDocumentBytesWithoutPlaintextUiState',
  savedVersions: 'disabledAndPurged',
  previews: 'memoryOnly',
} as const);

export function isWholeDocumentEncrypted(document: VisualDocument | null | undefined): boolean {
  return document?.encryption?.encrypted === true;
}

export function recoveryStateForPersistence(document: VisualDocument | null | undefined, recoveryState: string | null): string | null {
  return isWholeDocumentEncrypted(document) ? null : recoveryState;
}
