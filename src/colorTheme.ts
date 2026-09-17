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
  overrideDocumentColors: boolean;
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

export const DEFAULT_HVY_COLORS: Readonly<Record<string, string>> = {
  '--hvy-bg': '#f5f9ff',
  '--hvy-bg-alt': '#eef3fa',
  '--hvy-surface': '#ffffff',
  '--hvy-surface-alt': '#f9fcff',
  '--hvy-surface-tint': '#d9eaf4',
  '--hvy-text': '#1a2530',
  '--hvy-text-alt': '#4b5c67',
  '--hvy-text-muted': '#6b8fa0',
  '--hvy-link-color': '#162f3d',
  '--hvy-link-hover-color': '#2c5e78',
  '--hvy-accent-1': '#2c5e78',
  '--hvy-accent-1-alt': '#1f4f63',
  '--hvy-accent-1-text': '#fcfcfc',
  '--hvy-accent-2': '#325f6e',
  '--hvy-accent-2-alt': '#244355',
  '--hvy-button-bg': '#4a8fab',
  '--hvy-button-hover-bg': 'rgba(74, 143, 171, 0.22)',
  '--hvy-button-text': '#ffffff',
  '--hvy-button-hover-text': '#2c5e78',
  '--hvy-highlight-1': 'rgba(31, 122, 140, 0.15)',
  '--hvy-highlight-2': 'rgba(255, 214, 102, 0.35)',
  '--hvy-ai-view-hint-bg': '#fff4c7',
  '--hvy-border': '#ced9e2',
  '--hvy-border-alt': '#b8c8d3',
  '--hvy-border-input': '#c8d4dd',
  '--hvy-border-translucent': 'rgba(206, 217, 226, 0.92)',
  '--hvy-ghost-border': 'rgba(107, 143, 160, 0.38)',
  '--hvy-xref-card-bg': '#f3f5f8',
  '--hvy-xref-card-hover-bg': '#eef8fb',
  '--hvy-table-header': '#e5e7eb',
  '--hvy-table-row-bg-1': '#ffffff',
  '--hvy-table-row-bg-2': '#f9fafb',
  '--hvy-icon-muted': 'rgba(26, 37, 48, 0.33)',
  '--hvy-focus': '#8cb0c4',
  '--hvy-focus-ring': 'rgba(157, 182, 199, 0.9)',
  '--hvy-focus-glow': 'rgba(135, 167, 188, 0.35)',
  '--hvy-shadow': 'rgba(39, 70, 91, 0.08)',
  '--hvy-shadow-md': 'rgba(39, 70, 91, 0.12)',
  '--hvy-shadow-lg': 'rgba(39, 70, 91, 0.14)',
  '--hvy-overlay': 'rgba(15, 23, 32, 0.4)',
  '--hvy-danger': '#c86464',
  '--hvy-warning': '#c79200',
  '--hvy-warning-bg': '#fff3de',
  '--hvy-warning-border': '#ebca8d',
  '--hvy-warning-text': '#e2b100',
  '--hvy-success': '#1c6231',
  '--hvy-success-bg': '#e7f9ee',
  '--hvy-success-border': '#95d8a9',
  '--hvy-code-bg': '#f6f8fa',
  '--hvy-code-text': '#1f2328',
  '--hvy-code-muted': '#5f6b76',
  '--hvy-code-string': '#1f4f63',
  '--hvy-code-builtin': '#b8621b',
  '--hvy-code-keyword': '#a23a48',
  '--hvy-code-function': '#6f42c1',
  '--hvy-code-number': '#325f6e',
};

export const DEFAULT_DARK_HVY_COLORS: Readonly<Record<string, string>> = {
  '--hvy-bg': '#0f1720',
  '--hvy-bg-alt': '#161b22',
  '--hvy-surface': '#17222d',
  '--hvy-surface-alt': '#1c2733',
  '--hvy-surface-tint': '#1f3448',
  '--hvy-text': '#e7eef5',
  '--hvy-text-alt': '#a3adbf',
  '--hvy-text-muted': '#6b8fa0',
  '--hvy-link-color': '#7bc0e8',
  '--hvy-link-hover-color': '#a8dcf4',
  '--hvy-accent-1': '#7db3d0',
  '--hvy-accent-1-alt': '#5a8da8',
  '--hvy-accent-1-text': '#fcfcfc',
  '--hvy-accent-2': '#6fb3c1',
  '--hvy-accent-2-alt': '#2d5d68',
  '--hvy-button-bg': '#2d6a8a',
  '--hvy-button-hover-bg': 'rgba(123, 192, 232, 0.14)',
  '--hvy-button-text': '#ffffff',
  '--hvy-button-hover-text': '#a8dcf4',
  '--hvy-highlight-1': 'rgba(125, 179, 208, 0.20)',
  '--hvy-highlight-2': 'rgba(255, 214, 102, 0.25)',
  '--hvy-ai-view-hint-bg': '#332a12',
  '--hvy-border': '#4f6075',
  '--hvy-border-alt': '#5f7287',
  '--hvy-border-input': '#556a82',
  '--hvy-border-translucent': 'rgba(74, 90, 110, 0.92)',
  '--hvy-ghost-border': 'rgba(231, 238, 245, 0.28)',
  '--hvy-xref-card-bg': 'rgba(255, 255, 255, 0.04)',
  '--hvy-xref-card-hover-bg': 'rgba(255, 255, 255, 0.08)',
  '--hvy-table-header': '#1f2a37',
  '--hvy-table-row-bg-1': '#17222d',
  '--hvy-table-row-bg-2': '#1b2632',
  '--hvy-icon-muted': 'rgba(231, 238, 245, 0.33)',
  '--hvy-focus': '#5a8da8',
  '--hvy-focus-ring': 'rgba(90, 141, 168, 0.9)',
  '--hvy-focus-glow': 'rgba(90, 141, 168, 0.35)',
  '--hvy-shadow': 'rgba(0, 0, 0, 0.20)',
  '--hvy-shadow-md': 'rgba(0, 0, 0, 0.30)',
  '--hvy-shadow-lg': 'rgba(0, 0, 0, 0.40)',
  '--hvy-overlay': 'rgba(0, 0, 0, 0.60)',
  '--hvy-danger': '#c05050',
  '--hvy-warning': '#d4a017',
  '--hvy-warning-bg': '#2a2310',
  '--hvy-warning-border': '#6b5200',
  '--hvy-warning-text': '#c79200',
  '--hvy-success': '#4cae68',
  '--hvy-success-bg': '#152b1e',
  '--hvy-success-border': '#2e7a46',
  '--hvy-code-bg': '#161b22',
  '--hvy-code-text': '#c9d1d9',
  '--hvy-code-muted': '#8b949e',
  '--hvy-code-string': '#8ecae6',
  '--hvy-code-builtin': '#ffb86b',
  '--hvy-code-keyword': '#ff7b72',
  '--hvy-code-function': '#d2a8ff',
  '--hvy-code-number': '#79c0ff',
};

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
    id: 'default-dark',
    name: 'Default (Dark)',
    description: 'The built-in HVY dark colors.',
    colors: { ...DEFAULT_DARK_HVY_COLORS },
  },
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
  return { colors: {}, themeName: '', savedThemes: [], themeUses: {}, overrideDocumentColors: true };
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
      overrideDocumentColors: typeof parsed.overrideDocumentColors === 'boolean' ? parsed.overrideDocumentColors : true,
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
    overrideDocumentColors: settings.overrideDocumentColors,
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
    for (const [name, value] of Object.entries(effectiveColorThemeColors(settings.colors))) {
      if (isCssVariableName(name) && value.trim()) {
        target.style.setProperty(name, value);
      }
    }
  }
}

export function effectiveColorThemeColors(colors: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_HVY_COLORS, ...sanitizeThemeColors(colors) };
}

export function nativeWindowTheme(colors: Record<string, string>): 'light' | 'dark' {
  const background = effectiveColorThemeColors(colors)['--hvy-bg'];
  const hex = background.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  const rgb = hex
    ? (hex.length === 3
      ? hex.split('').map((part) => Number.parseInt(`${part}${part}`, 16))
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((part) => Number.parseInt(part, 16)))
    : background.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i)?.slice(1).map(Number);
  if (!rgb) return 'light';
  const [red, green, blue] = rgb.map((channel) => channel / 255);
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) < 0.5 ? 'dark' : 'light';
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
