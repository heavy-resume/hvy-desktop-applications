import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';

/**
 * Which browser profile a document's web plugins use. The document says it by name, as Galaxy's web plugins read
 * it: the file's profile in its front matter, and an instance's own `profile` in its config when it uses another (a
 * home page reading personal and work mail at once). Names, not ids: ids are made on each machine, while a name
 * means the same to a reader and to every copy of the file.
 */
export interface BrowserProfile {
  id: string;
  name: string;
}

/**
 * The file's profile is application metadata (HVY-SPEC 5.1): the front matter's `metadata` object, under Galaxy's
 * namespace, which HVY core keeps without interpreting: `metadata: { galaxy: { web_profile: Personal } }`.
 */
const METADATA_NAMESPACE = 'galaxy';
const PROFILE_KEY = 'web_profile';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The local profile a name means: the profile with that name. With no name, the only profile, when there is just
 * one. Null when the user has to choose: a name no local profile has, or no name among several profiles.
 */
export function resolveProfile(name: string | null, profiles: BrowserProfile[]): BrowserProfile | null {
  if (name) return profiles.find((profile) => profile.name === name) ?? null;
  return profiles.length === 1 ? profiles[0] : null;
}

/** The file's browser profile, as its front matter names it. */
export function documentProfileName(meta: Record<string, unknown>): string | null {
  const galaxy = isRecord(meta.metadata) ? meta.metadata[METADATA_NAMESPACE] : undefined;
  const name = isRecord(galaxy) ? galaxy[PROFILE_KEY] : undefined;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** The front matter's `metadata` with the file's browser profile set, keeping everything else in it. */
export function withDocumentProfile(metadata: unknown, name: string): JsonObject {
  const current = isRecord(metadata) ? metadata : {};
  const galaxy = isRecord(current[METADATA_NAMESPACE]) ? current[METADATA_NAMESPACE] : {};
  return { ...current, [METADATA_NAMESPACE]: { ...galaxy, [PROFILE_KEY]: name } } as JsonObject;
}
