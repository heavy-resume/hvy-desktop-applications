/** Maximum length of any normalized text field. */
export const MAX_JSON_LD_TEXT = 40_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasType(record: Record<string, unknown>, type: string): boolean {
  const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
  return types.includes(type);
}

/** Finds schema.org entities of one type, including inside arrays and @graph. */
export function findJsonLdEntities(value: unknown, type: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap((item) => findJsonLdEntities(item, type));
  if (!isRecord(value)) return [];
  const own = hasType(value, type) ? [value] : [];
  return [...own, ...findJsonLdEntities(value['@graph'], type)];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code: string) => String.fromCodePoint(
      code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10),
    ))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .trim();
}

function text(value: unknown): string {
  if (typeof value === 'string') return htmlToText(value).slice(0, MAX_JSON_LD_TEXT);
  if (typeof value === 'number') return String(value);
  return '';
}

function nameOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return isRecord(value) ? text(value.name) : '';
}

function placeText(value: unknown): string {
  const places = Array.isArray(value) ? value : [value];
  return places.map((place) => {
    if (typeof place === 'string') return place.trim();
    if (!isRecord(place)) return '';
    const address = isRecord(place.address) ? place.address : null;
    if (!address) return text(place.name);
    return [address.addressLocality, address.addressRegion, address.addressCountry]
      .map((part) => (isRecord(part) ? text(part.name) : text(part)))
      .filter(Boolean)
      .join(', ');
  }).filter(Boolean).join('; ');
}

function identifierText(value: unknown): string {
  return isRecord(value) ? text(value.value) || text(value.name) : text(value);
}

/** Generic fallback: top-level text and number properties, plus the names of nested things. */
function flattenEntity(entity: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(entity).flatMap(([name, value]) => {
    if (name.startsWith('@')) return [];
    const flattened = typeof value === 'string' || typeof value === 'number' ? text(value) : nameOf(value);
    return flattened ? [[name, flattened]] : [];
  }));
}

export type JsonLdNormalizer = (entity: Record<string, unknown>) => Record<string, string>;

/**
 * Normalizers for schema.org types with a useful shape. Types without an
 * entry use the generic flattening.
 */
export const JSON_LD_NORMALIZERS: Record<string, JsonLdNormalizer> = {
  JobPosting: (posting) => ({
    title: text(posting.title),
    company: nameOf(posting.hiringOrganization),
    location: placeText(posting.jobLocation),
    datePosted: text(posting.datePosted),
    identifier: identifierText(posting.identifier),
    url: text(posting.url),
    description: text(posting.description),
  }),
};

/** Normalizes a schema.org entity into item fields, dropping empty values. */
export function normalizeJsonLdEntity(type: string, entity: Record<string, unknown>): Record<string, string> {
  const normalized = (JSON_LD_NORMALIZERS[type] ?? flattenEntity)(entity);
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value));
}
