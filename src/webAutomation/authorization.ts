import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { stableJson } from '../webCapabilities';

export interface CapabilityAuthorization {
  capabilityId: string;
  profileId: string;
  /** One hash per reviewable category, so a review can name what changed. */
  partHashes: Record<string, string>;
  authorizedAt: number;
  /** The site account first used under this authorization; a different account requires review. */
  accountId?: string;
}

/** documentPath → capabilityId → authorization. Stored in local app settings, never in the document. */
export type CapabilityAuthorizations = Record<string, Record<string, CapabilityAuthorization>>;

export type AuthorizationReviewReason = 'authorized' | 'first-use' | 'profile-changed' | 'capability-changed' | 'account-changed';

export interface AuthorizationReview {
  capabilityId: string;
  reason: AuthorizationReviewReason;
  changedCategories: string[];
}

function hashPart(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(stableJson(value ?? null))));
}

export function hashAuthorizationParts(parts: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(parts).map(([category, value]) => [category, hashPart(value)]));
}

export function reviewAuthorization(
  authorizations: CapabilityAuthorizations,
  documentPath: string,
  capabilityId: string,
  parts: Record<string, unknown>,
  profileId: string,
  currentAccountId?: string,
): AuthorizationReview {
  const existing = authorizations[documentPath]?.[capabilityId];
  if (!existing) return { capabilityId, reason: 'first-use', changedCategories: [] };
  if (existing.profileId !== profileId) return { capabilityId, reason: 'profile-changed', changedCategories: [] };
  const current = hashAuthorizationParts(parts);
  const categories = new Set([...Object.keys(current), ...Object.keys(existing.partHashes)]);
  const changedCategories = [...categories].filter((category) => current[category] !== existing.partHashes[category]).sort();
  if (changedCategories.length) return { capabilityId, reason: 'capability-changed', changedCategories };
  if (existing.accountId && currentAccountId && existing.accountId !== currentAccountId) {
    return { capabilityId, reason: 'account-changed', changedCategories: [] };
  }
  return { capabilityId, reason: 'authorized', changedCategories: [] };
}

/** Records the account the first time an authorization is used with one. */
export function pinAuthorizationAccount(
  authorizations: CapabilityAuthorizations,
  documentPath: string,
  capabilityId: string,
  accountId: string,
): CapabilityAuthorizations {
  const existing = authorizations[documentPath]?.[capabilityId];
  if (!existing || existing.accountId) return authorizations;
  return { ...authorizations, [documentPath]: { ...authorizations[documentPath], [capabilityId]: { ...existing, accountId } } };
}

export function recordAuthorization(
  authorizations: CapabilityAuthorizations,
  documentPath: string,
  capabilityId: string,
  parts: Record<string, unknown>,
  profileId: string,
  now: number,
): CapabilityAuthorizations {
  return {
    ...authorizations,
    [documentPath]: {
      ...(authorizations[documentPath] ?? {}),
      [capabilityId]: { capabilityId, profileId, partHashes: hashAuthorizationParts(parts), authorizedAt: now },
    },
  };
}
