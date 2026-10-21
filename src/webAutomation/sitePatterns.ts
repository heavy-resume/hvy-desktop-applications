export type PlatformSignal =
  | { kind: 'path'; glob: string }
  | { kind: 'resource'; host?: string; path: string }
  | { kind: 'meta'; name: string; content: string }
  | { kind: 'form-field'; name: string }
  | { kind: 'attribute'; name: string; value?: string }
  | { kind: 'element'; checkId: string; expectedValue?: string };

export type SitePatternScopeRule =
  | { target: 'page' | 'frame'; host: string; path?: string }
  | { target: 'fingerprint'; signals: PlatformSignal[] };

/** A field a pattern reads: one of its collection's configured fields (by id), or, on a listing, the link to each item. */
export interface SitePatternField {
  id: string;
  kind: 'text' | 'link';
}

export interface SitePatternDefinition {
  id: string;
  name: string;
  role: 'listing' | 'detail';
  appliesTo: SitePatternScopeRule[];
  fields: SitePatternField[];
  minimumConfidence: number;
  /** Listing only: field holding the detail link. */
  linkFieldId?: string;
  /** Listing only: page command that moves to the next page. */
  paginationCommandId?: string;
  /**
   * Listing only: item command that shows the item in a side pane instead
   * of navigating. The link field still provides the item key.
   */
  itemCommandId?: string;
  /** Opaque structural matcher evaluated by the host's inspector. */
  matcher?: unknown;
  /** The site setup it belongs to: copying, updating, or removing that setup takes it along. */
  siteId?: string;
  /** Opaque: what the pattern was set up from, so it can be set up again (edited). Runs never read it. */
  source?: unknown;
  version: number;
}

export interface PatternResolutionContext {
  url: string;
  frames?: Array<{ src: string }>;
  /** Matched signal counts per pattern ID, from the host's fingerprint evaluation. */
  fingerprintMatches?: Record<string, number>;
}

export type PatternResolution =
  | { kind: 'match'; pattern: SitePatternDefinition; via: 'page' | 'fingerprint' }
  | { kind: 'match'; pattern: SitePatternDefinition; via: 'frame'; frameSrc: string }
  | { kind: 'ambiguous'; candidates: SitePatternDefinition[] }
  | { kind: 'none' };

const GENERIC_SIGNAL_KINDS = new Set<PlatformSignal['kind']>(['form-field', 'attribute']);

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** `*` matches within one path segment, `**` matches across segments. */
export function globMatches(glob: string, value: string): boolean {
  const source = glob.split('**').map((part) => part.split('*').map(escapeRegExp).join('[^/]*')).join('.*');
  return new RegExp(`^${source}$`).test(value);
}

export function hostMatches(ruleHost: string, host: string): boolean {
  const rule = ruleHost.toLowerCase();
  const candidate = host.toLowerCase();
  if (!rule.startsWith('*.')) return rule === candidate;
  const suffix = rule.slice(2);
  return candidate.endsWith(`.${suffix}`);
}

export function validateScopeRule(rule: SitePatternScopeRule): string | null {
  if (rule.target === 'fingerprint') return validateFingerprint(rule.signals);
  if (!rule.host.trim()) return 'A scope rule needs a host.';
  if (rule.host.includes('*') && !rule.host.startsWith('*.')) return 'Only a leading "*." wildcard is supported.';
  if (rule.host.startsWith('*.')) {
    const labels = rule.host.slice(2).split('.').filter(Boolean);
    if (labels.length < 2 || labels.some((label) => label.includes('*'))) {
      return 'A wildcard host must name a registrable domain, such as "*.example.com".';
    }
  }
  if (rule.path !== undefined && !rule.path.startsWith('/')) return 'A path rule must start with "/".';
  return null;
}

export function validateFingerprint(signals: PlatformSignal[]): string | null {
  if (!signals.length) return 'A fingerprint needs at least one signal.';
  if (signals.every((signal) => GENERIC_SIGNAL_KINDS.has(signal.kind))) {
    return 'Add at least one signal specific to this platform.';
  }
  return null;
}

export function urlMatchesRule(rule: SitePatternScopeRule, url: string): boolean {
  if (rule.target === 'fingerprint') return false;
  const parsed = new URL(url);
  return hostMatches(rule.host, parsed.hostname) && (rule.path === undefined || globMatches(rule.path, parsed.pathname));
}

function urlRuleSpecificity(rule: Extract<SitePatternScopeRule, { host: string }>): number {
  const pathScore = rule.path ? rule.path.replace(/\*/g, '').length : 0;
  return rule.host.startsWith('*.')
    ? 1_000_000 + rule.host.length * 1_000 + pathScore
    : 2_000_000 + pathScore;
}

function bestCandidates<T extends { pattern: SitePatternDefinition; score: number }>(scored: T[]): T[] {
  const top = Math.max(...scored.map((item) => item.score));
  const best = scored.filter((item) => item.score === top);
  return best.filter((item, index) => best.findIndex((other) => other.pattern.id === item.pattern.id) === index);
}

export function resolveSitePattern(
  patterns: SitePatternDefinition[],
  role: SitePatternDefinition['role'],
  context: PatternResolutionContext,
): PatternResolution {
  const candidates = patterns.filter((pattern) => pattern.role === role);

  const pageMatches = candidates.flatMap((pattern) => pattern.appliesTo
    .filter((rule): rule is Extract<SitePatternScopeRule, { host: string }> => rule.target === 'page' && urlMatchesRule(rule, context.url))
    .map((rule) => ({ pattern, score: urlRuleSpecificity(rule) })));
  if (pageMatches.length) {
    const best = bestCandidates(pageMatches);
    return best.length === 1 ? { kind: 'match', pattern: best[0].pattern, via: 'page' } : { kind: 'ambiguous', candidates: best.map((item) => item.pattern) };
  }

  const frameMatches = candidates.flatMap((pattern) => pattern.appliesTo
    .filter((rule): rule is Extract<SitePatternScopeRule, { host: string }> => rule.target === 'frame')
    .flatMap((rule) => (context.frames ?? [])
      .filter((frame) => urlMatchesRule(rule, frame.src))
      .map((frame) => ({ pattern, score: urlRuleSpecificity(rule), frameSrc: frame.src }))));
  if (frameMatches.length) {
    const best = bestCandidates(frameMatches);
    return best.length === 1
      ? { kind: 'match', pattern: best[0].pattern, via: 'frame', frameSrc: best[0].frameSrc }
      : { kind: 'ambiguous', candidates: best.map((item) => item.pattern) };
  }

  const fingerprintMatches = candidates
    .filter((pattern) => pattern.appliesTo.some((rule) => rule.target === 'fingerprint'))
    .flatMap((pattern) => {
      const count = context.fingerprintMatches?.[pattern.id];
      return count ? [{ pattern, score: count }] : [];
    });
  if (fingerprintMatches.length) {
    const best = bestCandidates(fingerprintMatches);
    return best.length === 1 ? { kind: 'match', pattern: best[0].pattern, via: 'fingerprint' } : { kind: 'ambiguous', candidates: best.map((item) => item.pattern) };
  }

  return { kind: 'none' };
}

export function patternFingerprints(patterns: SitePatternDefinition[]): Record<string, PlatformSignal[]> {
  return Object.fromEntries(patterns.flatMap((pattern) => pattern.appliesTo
    .filter((rule): rule is Extract<SitePatternScopeRule, { target: 'fingerprint' }> => rule.target === 'fingerprint')
    .map((rule) => [pattern.id, rule.signals] as const)));
}
