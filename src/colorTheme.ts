import blackWidowCss from '../../heavy-file-format/src/palettes/black-widow-palette.css?inline';
import mochaCss from '../../heavy-file-format/src/palettes/mocha-palette.css?inline';
import paperCss from '../../heavy-file-format/src/palettes/paper-palette.css?inline';
import petrichorCss from '../../heavy-file-format/src/palettes/petrichor-palette.css?inline';
import springCss from '../../heavy-file-format/src/palettes/spring-palette.css?inline';
import ufoCss from '../../heavy-file-format/src/palettes/ufo-palette.css?inline';

export interface ColorThemeSettings {
  colors: Record<string, string>;
  themeName: string;
  savedThemes: SavedColorTheme[];
  themeUses: Record<string, number>;
}

export interface SavedColorTheme {
  id: string;
  name: string;
  colors: Record<string, string>;
  lastUsedAt: number;
}

export interface ColorThemeFile {
  schemaVersion: 1;
  name: string;
  colors: Record<string, string>;
}

export interface HvyPalette {
  id: string;
  name: string;
  description: string;
  colors: Record<string, string>;
}

export const COLOR_THEME_STORAGE_KEY = 'hvy-galaxy-color-theme-v1';
export const COLOR_THEME_FILE_EXTENSION = '.hvytheme';

export const THEME_COLOR_NAMES: readonly string[] = [
  '--hvy-bg',
  '--hvy-bg-alt',
  '--hvy-surface',
  '--hvy-surface-alt',
  '--hvy-surface-tint',
  '--hvy-text',
  '--hvy-text-alt',
  '--hvy-text-muted',
  '--hvy-link-color',
  '--hvy-link-hover-color',
  '--hvy-accent-1',
  '--hvy-accent-1-alt',
  '--hvy-accent-1-text',
  '--hvy-accent-2',
  '--hvy-accent-2-alt',
  '--hvy-button-bg',
  '--hvy-button-hover-bg',
  '--hvy-button-text',
  '--hvy-button-hover-text',
  '--hvy-highlight-1',
  '--hvy-highlight-2',
  '--hvy-ai-view-hint-bg',
  '--hvy-border',
  '--hvy-border-alt',
  '--hvy-border-input',
  '--hvy-border-translucent',
  '--hvy-ghost-border',
  '--hvy-xref-card-bg',
  '--hvy-xref-card-hover-bg',
  '--hvy-table-header',
  '--hvy-table-row-bg-1',
  '--hvy-table-row-bg-2',
  '--hvy-graph-text',
  '--hvy-graph-grid',
  '--hvy-graph-axis',
  '--hvy-graph-outline',
  '--hvy-graph-series-1',
  '--hvy-graph-series-2',
  '--hvy-graph-series-3',
  '--hvy-graph-series-4',
  '--hvy-graph-series-5',
  '--hvy-graph-series-6',
  '--hvy-graph-series-7',
  '--hvy-graph-series-8',
  '--hvy-icon-muted',
  '--hvy-focus',
  '--hvy-focus-ring',
  '--hvy-focus-glow',
  '--hvy-shadow',
  '--hvy-shadow-md',
  '--hvy-shadow-lg',
  '--hvy-overlay',
  '--hvy-danger',
  '--hvy-warning',
  '--hvy-warning-bg',
  '--hvy-warning-border',
  '--hvy-warning-text',
  '--hvy-success',
  '--hvy-success-bg',
  '--hvy-success-border',
  '--hvy-code-bg',
  '--hvy-code-text',
  '--hvy-code-muted',
  '--hvy-code-string',
  '--hvy-code-builtin',
  '--hvy-code-keyword',
  '--hvy-code-function',
  '--hvy-code-number',
];

const THEME_COLOR_LABELS: Record<string, string> = {
  '--hvy-bg': 'Page Background',
  '--hvy-bg-alt': 'Page Background Gradient End',
  '--hvy-surface': 'Panel and Card Background',
  '--hvy-surface-alt': 'Inset and Secondary Panel Background',
  '--hvy-surface-tint': 'Subtle Panel Tint',
  '--hvy-text': 'Primary Text',
  '--hvy-text-alt': 'Secondary Text',
  '--hvy-text-muted': 'Muted Helper Text',
  '--hvy-link-color': 'Inline Link Text',
  '--hvy-link-hover-color': 'Inline Link Hover Text',
  '--hvy-accent-1': 'Primary Accent Fill',
  '--hvy-accent-1-alt': 'Primary Accent Border',
  '--hvy-accent-1-text': 'Text on Primary Accent',
  '--hvy-accent-2': 'Secondary Accent Fill',
  '--hvy-accent-2-alt': 'Secondary Accent Border',
  '--hvy-button-bg': 'Primary Button Background',
  '--hvy-button-hover-bg': 'Primary Button Hover Background',
  '--hvy-button-text': 'Primary Button Text',
  '--hvy-button-hover-text': 'Primary Button Hover Text',
  '--hvy-highlight-1': 'Soft Content Highlight',
  '--hvy-highlight-2': 'Strong Content Highlight',
  '--hvy-ai-view-hint-bg': 'AI Editing Hint Background',
  '--hvy-border': 'Default Panel Border',
  '--hvy-border-alt': 'Emphasized Border',
  '--hvy-border-input': 'Form Field and Table Border',
  '--hvy-border-translucent': 'Floating Toolbar Border',
  '--hvy-ghost-border': 'Ghost Input Border',
  '--hvy-xref-card-bg': 'Reference Card Background',
  '--hvy-xref-card-hover-bg': 'Reference Card Hover Background',
  '--hvy-table-header': 'Table Header Background',
  '--hvy-table-row-bg-1': 'Odd Table Row Background',
  '--hvy-table-row-bg-2': 'Even Table Row Background',
  '--hvy-graph-text': 'Graph Text',
  '--hvy-graph-grid': 'Graph Grid Lines',
  '--hvy-graph-axis': 'Graph Axis Lines',
  '--hvy-graph-outline': 'Graph Mark Outline',
  '--hvy-icon-muted': 'Muted Icon Color',
  '--hvy-focus': 'Focus Border',
  '--hvy-focus-ring': 'Focus Ring',
  '--hvy-focus-glow': 'Focus Glow',
  '--hvy-overlay': 'Modal and Sidebar Backdrop',
  '--hvy-danger': 'Danger Action and Error Text',
  '--hvy-warning': 'Warning Accent',
  '--hvy-warning-bg': 'Warning Background',
  '--hvy-warning-border': 'Warning Border',
  '--hvy-warning-text': 'Warning Text',
  '--hvy-success': 'Success Text',
  '--hvy-success-bg': 'Success Background',
  '--hvy-success-border': 'Success Border',
  '--hvy-code-bg': 'Code Block Background',
  '--hvy-code-text': 'Code Block Base Text',
  '--hvy-code-muted': 'Code Comment and Muted Text',
  '--hvy-code-string': 'Code String Text',
  '--hvy-code-builtin': 'Code Built-In Function Text',
  '--hvy-code-keyword': 'Code Keyword Text',
  '--hvy-code-function': 'Code Function and Title Text',
  '--hvy-code-number': 'Code Number and Literal Text',
};

export const HVY_PALETTES: readonly HvyPalette[] = [
  {
    id: 'black-widow',
    name: 'Black Widow',
    description: 'High contrast black, crimson, and signal green.',
    colors: parsePaletteCss(blackWidowCss),
  },
  {
    id: 'mocha',
    name: 'Mocha',
    description: 'Warm taupe, ceramic gray, and roasted brown.',
    colors: parsePaletteCss(mochaCss),
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Quiet paper whites with garden-green accents.',
    colors: parsePaletteCss(paperCss),
  },
  {
    id: 'petrichor',
    name: 'Petrichor',
    description: 'Rainy blue, lavender, cyan, and damp violet.',
    colors: parsePaletteCss(petrichorCss),
  },
  {
    id: 'spring',
    name: 'Spring',
    description: 'Fresh greens with teal and violet contrast.',
    colors: parsePaletteCss(springCss),
  },
  {
    id: 'ufo',
    name: 'UFO',
    description: 'Dark graphite with saturated green console light.',
    colors: parsePaletteCss(ufoCss),
  },
];

export function defaultColorThemeSettings(): ColorThemeSettings {
  return { colors: {}, themeName: '', savedThemes: [], themeUses: {} };
}

export function loadColorThemeSettings(): ColorThemeSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLOR_THEME_STORAGE_KEY) ?? '{}') as Partial<ColorThemeSettings>;
    const savedThemes = Array.isArray(parsed.savedThemes)
      ? parsed.savedThemes
        .map((theme): SavedColorTheme | null => {
          if (!theme || typeof theme !== 'object') return null;
          const id = typeof theme.id === 'string' && theme.id.trim() ? theme.id.trim() : createSavedThemeId();
          const name = typeof theme.name === 'string' && theme.name.trim() ? theme.name.trim() : 'Untitled Theme';
          const lastUsedAt = typeof theme.lastUsedAt === 'number' && Number.isFinite(theme.lastUsedAt) ? theme.lastUsedAt : 0;
          return { id, name, colors: sanitizeThemeColors(theme.colors), lastUsedAt };
        })
        .filter((theme): theme is SavedColorTheme => theme !== null)
      : [];
    const themeUses = parsed.themeUses && typeof parsed.themeUses === 'object' && !Array.isArray(parsed.themeUses)
      ? Object.fromEntries(Object.entries(parsed.themeUses).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
      : {};
    return {
      colors: sanitizeThemeColors(parsed.colors),
      themeName: typeof parsed.themeName === 'string' ? parsed.themeName : '',
      savedThemes,
      themeUses,
    };
  } catch {
    return defaultColorThemeSettings();
  }
}

export function saveColorThemeSettings(settings: ColorThemeSettings): void {
  localStorage.setItem(COLOR_THEME_STORAGE_KEY, JSON.stringify({
    colors: sanitizeThemeColors(settings.colors),
    themeName: settings.themeName.trim(),
    savedThemes: settings.savedThemes.map((theme) => ({
      id: theme.id,
      name: theme.name.trim() || 'Untitled Theme',
      colors: sanitizeThemeColors(theme.colors),
      lastUsedAt: theme.lastUsedAt,
    })),
    themeUses: settings.themeUses,
  }));
}

export function getPaletteById(id: string): HvyPalette | null {
  return HVY_PALETTES.find((palette) => palette.id === id) ?? null;
}

export function getMatchedPaletteId(colors: Record<string, string>): string | null {
  for (const palette of HVY_PALETTES) {
    if (themeColorsEqual(colors, palette.colors)) {
      return palette.id;
    }
  }
  return null;
}

export function getMatchedSavedThemeId(colors: Record<string, string>, savedThemes: readonly SavedColorTheme[]): string | null {
  for (const theme of savedThemes) {
    if (themeColorsEqual(colors, theme.colors)) {
      return theme.id;
    }
  }
  return null;
}

export function createSavedThemeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `theme-${crypto.randomUUID()}`;
  }
  return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function applyColorTheme(settings: ColorThemeSettings, root: HTMLElement | null = null): void {
  const targets = [document.documentElement, root].filter((target): target is HTMLElement => target !== null);
  for (const target of targets) {
    clearColorTheme(target);
    for (const [name, value] of Object.entries(sanitizeThemeColors(settings.colors))) {
      if (isCssVariableName(name) && value.trim()) {
        target.style.setProperty(name, value);
      }
    }
  }
}

export function clearColorTheme(target: HTMLElement): void {
  const stale: string[] = [];
  for (let i = 0; i < target.style.length; i += 1) {
    const prop = target.style.item(i);
    if (prop.startsWith('--hvy-')) stale.push(prop);
  }
  stale.forEach((prop) => target.style.removeProperty(prop));
}

export function getThemeColorLabel(name: string): string {
  return THEME_COLOR_LABELS[name] ?? name.replace(/^--hvy-/, '').split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function colorValueToPickerHex(value: string): string {
  const trimmed = value.trim();
  const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return `#${hex.split('').map((part) => `${part}${part}`).join('').toLowerCase()}`;
    }
    return `#${hex.toLowerCase()}`;
  }
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+\s*)?\)$/i);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number.parseInt(part, 10))));
    return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }
  return '#000000';
}

export function colorValueToAlpha(value: string): number {
  const alpha = extractCssAlpha(value);
  return alpha === null ? 1 : alpha;
}

export function mergeAlphaIntoCssColor(value: string, alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const rgb = parseCssRgb(value) ?? parseHexRgb(colorValueToPickerHex(value));
  if (!rgb) {
    return value;
  }
  if (clampedAlpha >= 1) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${formatAlpha(clampedAlpha)})`;
}

export function mergePickerHexIntoCssColor(hex: string, currentValue: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) {
    return hex;
  }
  const alpha = extractCssAlpha(currentValue);
  if (alpha === null) {
    return hex;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${formatAlpha(alpha)})`;
}

export function isCssVariableName(value: string): boolean {
  return /^--[a-zA-Z0-9_-]+$/.test(value);
}

export function parsePaletteCss(css: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const match of css.matchAll(/(--hvy-[\w-]+)\s*:\s*([^;]+);/g)) {
    colors[match[1]] = match[2].trim();
  }
  return colors;
}

export function createColorThemeFile(name: string, colors: Record<string, string>): ColorThemeFile {
  return {
    schemaVersion: 1,
    name: name.trim() || 'Untitled Theme',
    colors: sanitizeThemeColors(colors),
  };
}

export function serializeColorThemeFile(theme: ColorThemeFile): string {
  return `${JSON.stringify(createColorThemeFile(theme.name, theme.colors), null, 2)}\n`;
}

export function parseColorThemeFile(text: string): ColorThemeFile {
  const parsed = JSON.parse(text) as Partial<ColorThemeFile>;
  if (parsed.schemaVersion !== 1) {
    throw new Error('Theme file version is not supported.');
  }
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    throw new Error('Theme file is missing a name.');
  }
  const colors = sanitizeThemeColors(parsed.colors);
  return createColorThemeFile(parsed.name, colors);
}

export function sanitizeThemeColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && (THEME_COLOR_NAMES as readonly string[]).includes(entry[0]) && entry[1].trim().length > 0)
      .map(([name, color]) => [name, color.trim()])
  );
}

export function themeColorsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftColors = sanitizeThemeColors(left);
  const rightColors = sanitizeThemeColors(right);
  const names = new Set([...Object.keys(leftColors), ...Object.keys(rightColors)]);
  for (const name of names) {
    if ((leftColors[name] ?? '').trim() !== (rightColors[name] ?? '').trim()) {
      return false;
    }
  }
  return true;
}

function extractCssAlpha(value: string): number | null {
  const match = value.trim().match(/^rgba?\(\s*(?:\d{1,3})\s*[,\s]\s*(?:\d{1,3})\s*[,\s]\s*(?:\d{1,3})(?:\s*[,/]\s*([\d.]+)\s*)\)$/i);
  if (!match?.[1]) {
    return null;
  }
  const alpha = Number.parseFloat(match[1]);
  return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : null;
}

function parseCssRgb(value: string): { r: number; g: number; b: number } | null {
  const match = value.trim().match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+\s*)?\)$/i);
  if (!match) {
    return null;
  }
  const [r, g, b] = match.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number.parseInt(part, 10))));
  return { r, g, b };
}

function parseHexRgb(value: string): { r: number; g: number; b: number } | null {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function formatAlpha(alpha: number): string {
  return alpha.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
