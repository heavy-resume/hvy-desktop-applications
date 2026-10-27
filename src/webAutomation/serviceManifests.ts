import { errorMessage } from './errors';

/**
 * What a service publishes about itself for documents to use: its page and sign-in, its endpoints, the other sites
 * Galaxy may read from for it, and named permissions, each granting some of its endpoints. It lives on the service's
 * own site, so the site owns what a document may do with it there; a galaxy.web-api block that uses it names the service and
 * the permissions it asks for (configs.ts builds the block's endpoints from them, checked as an inline block's are).
 * Paths in it are the site's own, so it can describe no other site.
 *
 * {
 *   "hvy": "galaxy-service/1",
 *   "name": "Heavy Resume",
 *   "page": "/",
 *   "session": { "loginPath": "/extension-login", "completePath": "/extension-login/complete", "probe": "session",
 *                "logout": "logout", "signedOutStatuses": [401] },
 *   "readOrigins": ["https://storage.googleapis.com"],
 *   "endpoints": [{ "id": "files", "name": "Files", "method": "GET", "path": "/api/extension/v1/files", ... }],
 *   "permissions": [{ "id": "resumes", "description": "Read your resumes", "endpoints": ["files", "open-file"] }]
 * }
 */
export const SERVICE_MANIFEST_PATH = '/.well-known/hvy-galaxy.json';
export const SERVICE_MANIFEST_FORMAT = 'galaxy-service/1';
export const MAX_SERVICE_MANIFEST_BYTES = 1_000_000;

/** A service's published file, as far as it has been fetched. */
export type PublishedService =
  | { status: 'loading' }
  | { status: 'loaded'; manifest: Record<string, unknown> }
  | { status: 'failed'; error: string };

// By service origin, for the app's run: fetched once, again after a failure or when asked.
const services = new Map<string, PublishedService>();

export function publishedService(origin: string): PublishedService | null {
  return services.get(origin) ?? null;
}

/**
 * Fetches a service's published file, as Galaxy fetches a served document: without credentials or redirects, size
 * limited. It is read as JSON here; what it says is checked where a block uses it.
 */
export function loadPublishedService(origin: string, fetchFile: (url: string, options: { maxBytes: number }) => Promise<Uint8Array>, reload = false): Promise<PublishedService> {
  const known = services.get(origin);
  if (known?.status === 'loaded' && !reload) return Promise.resolve(known);
  // Callers asking while it is fetched share the fetch; asked to fetch it again, it is fetched after that one.
  const pending = fetching.get(origin);
  if (pending) return reload ? pending.then(() => loadPublishedService(origin, fetchFile, true)) : pending;
  services.set(origin, { status: 'loading' });
  const fetched = (async (): Promise<PublishedService> => {
    try {
      const bytes = await fetchFile(`${origin}${SERVICE_MANIFEST_PATH}`, { maxBytes: MAX_SERVICE_MANIFEST_BYTES });
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { status: 'loaded', manifest: parsed as Record<string, unknown> }
        : { status: 'failed', error: 'Its published file is not a JSON object.' };
    } catch (error) {
      return { status: 'failed', error: errorMessage(error) };
    }
  })().then((loaded) => {
    services.set(origin, loaded);
    fetching.delete(origin);
    return loaded;
  });
  fetching.set(origin, fetched);
  return fetched;
}

const fetching = new Map<string, Promise<PublishedService>>();
