export type WebMcpStructuredValueKind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

export interface WebMcpStructuredField {
  name: string;
  presentIn: number;
  valueKinds: WebMcpStructuredValueKind[];
}

export interface WebMcpRecordSetCandidate {
  /** JSON Pointer. The empty string identifies the result root. */
  path: string;
  records: Array<Record<string, unknown>>;
  fields: WebMcpStructuredField[];
}

export type WebMcpStructuredDataAnalysis =
  | { kind: 'unsupported'; reason: 'not-json' | 'not-record-shaped' }
  | { kind: 'single-record'; candidate: WebMcpRecordSetCandidate }
  | { kind: 'record-sets'; candidates: WebMcpRecordSetCandidate[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function valueKind(value: unknown): WebMcpStructuredValueKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value as 'boolean' | 'number' | 'string';
}

function summarizeFields(records: Array<Record<string, unknown>>): WebMcpStructuredField[] {
  const fields = new Map<string, { presentIn: number; valueKinds: Set<WebMcpStructuredValueKind> }>();
  for (const record of records) {
    for (const [name, value] of Object.entries(record)) {
      const field = fields.get(name) ?? { presentIn: 0, valueKinds: new Set<WebMcpStructuredValueKind>() };
      field.presentIn += 1;
      field.valueKinds.add(valueKind(value));
      fields.set(name, field);
    }
  }
  return [...fields].map(([name, field]) => ({
    name,
    presentIn: field.presentIn,
    valueKinds: [...field.valueKinds],
  }));
}

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function candidate(path: string, records: Array<Record<string, unknown>>): WebMcpRecordSetCandidate {
  return { path, records, fields: summarizeFields(records) };
}

function nestedRecordSets(value: Record<string, unknown>, path: string): WebMcpRecordSetCandidate[] {
  const candidates: WebMcpRecordSetCandidate[] = [];
  for (const [name, child] of Object.entries(value)) {
    const childPath = `${path}/${pointerSegment(name)}`;
    if (Array.isArray(child)) {
      if (child.length === 0 || child.every(isRecord)) candidates.push(candidate(childPath, child));
    } else if (isRecord(child)) {
      candidates.push(...nestedRecordSets(child, childPath));
    }
  }
  return candidates;
}

function jsonValue(value: unknown): { parsed: true; value: unknown } | { parsed: false } {
  if (typeof value !== 'string') return { parsed: true, value };
  try {
    return { parsed: true, value: JSON.parse(value) as unknown };
  } catch {
    return { parsed: false };
  }
}

export function analyzeWebMcpStructuredData(value: unknown): WebMcpStructuredDataAnalysis {
  const parsed = jsonValue(value);
  if (!parsed.parsed) return { kind: 'unsupported', reason: 'not-json' };

  if (Array.isArray(parsed.value)) {
    if (parsed.value.length === 0 || parsed.value.every(isRecord)) {
      return { kind: 'record-sets', candidates: [candidate('', parsed.value)] };
    }
    return { kind: 'unsupported', reason: 'not-record-shaped' };
  }

  if (!isRecord(parsed.value)) return { kind: 'unsupported', reason: 'not-record-shaped' };
  const candidates = nestedRecordSets(parsed.value, '');
  if (candidates.length) return { kind: 'record-sets', candidates };
  return { kind: 'single-record', candidate: candidate('', [parsed.value]) };
}

export function webMcpRecordSetAtPath(analysis: WebMcpStructuredDataAnalysis, path: string): WebMcpRecordSetCandidate | null {
  if (analysis.kind === 'unsupported') return null;
  if (analysis.kind === 'single-record') return analysis.candidate.path === path ? analysis.candidate : null;
  return analysis.candidates.find((item) => item.path === path) ?? null;
}

export function webMcpExtractionRecords(
  candidate: WebMcpRecordSetCandidate,
  fields: Array<{ name: string; label: string }>,
): Array<{ targets: Array<{ label: string; value: unknown }> }> {
  return candidate.records.map((record) => ({
    targets: fields.map((field) => ({ label: field.label, value: record[field.name] })),
  }));
}
