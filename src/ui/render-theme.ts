import { colorValueToAlpha, colorValueToPickerHex, getMatchedPaletteId, getMatchedSavedThemeId, getThemeColorLabel, HVY_PALETTES, isCssVariableName, THEME_COLOR_NAMES } from '../colorTheme';
import { type AppState } from '../state';
import { escapeAttr, escapeHtml } from './shared';

export function renderColorThemeDialog(state: AppState): string {
  if (!state.colorThemeDialogOpen) {
    return '';
  }
  const documentMode = state.colorThemeDialogMode === 'document';
  const documentTheme = getDocumentTheme(state);
  const colors = documentMode ? documentTheme.colors : state.colorTheme.colors;
  const selectedPaletteId = getMatchedPaletteId(colors);
  const selectedCustomThemeId = getMatchedSavedThemeId(colors, state.colorTheme.savedThemes);
  const themeName = documentMode
    ? documentTheme.name || selectedThemeName(selectedPaletteId, selectedCustomThemeId, state, colors) || 'Untitled Theme'
    : state.colorTheme.themeName || selectedThemeName(selectedPaletteId, selectedCustomThemeId, state, colors) || 'Untitled Theme';
  const activeThemeName = selectedThemeName(selectedPaletteId, selectedCustomThemeId, state, colors) || themeName;
  const title = documentMode ? 'Document Colors' : 'Colors';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog color-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="colorThemeTitle" style="${escapeAttr(renderThemeVariableStyle(colors))}">
        <h2 id="colorThemeTitle">${escapeHtml(title)}</h2>
        ${renderThemeSwitcher(state, selectedPaletteId, selectedCustomThemeId, activeThemeName, colors, true)}
        ${renderThemePreviewPanel(true)}
        <div class="theme-filter-shell">
          <span>Filter Colors</span>
          <input class="hvy-galaxy-input" type="search" placeholder="Type a role, component, or click a preview" data-field="theme-color-filter">
        </div>
        <div class="theme-color-list">
          ${THEME_COLOR_NAMES.map((name) => renderThemeColorRow(name, colors[name] ?? '', getResolvedThemeColor(name, colors[name]), true)).join('')}
        </div>
      </section>
    </div>`;
}

export function renderThemeVariableStyle(colors: Record<string, string>): string {
  return Object.entries(colors)
    .filter(([name, value]) => isCssVariableName(name) && value.trim())
    .map(([name, value]) => `${name}: ${value.trim()};`)
    .join(' ');
}

export function getDocumentColorsEnabled(state: AppState): boolean {
  return Boolean(state.document?.path && state.recent.documentColorUses?.[state.document.path] === true);
}

export function getDocumentTheme(state: AppState): { name: string; colors: Record<string, string> } {
  const theme = state.document?.mounted?.document.meta.theme;
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return { name: '', colors: {} };
  const record = theme as { name?: unknown; colors?: unknown };
  const colors = record.colors && typeof record.colors === 'object' && !Array.isArray(record.colors)
    ? Object.fromEntries(Object.entries(record.colors).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};
  return {
    name: typeof record.name === 'string' ? record.name : '',
    colors,
  };
}

export interface ThemeCard {
  id: string;
  name: string;
  description: string;
  colors: Record<string, string>;
  builtIn: boolean;
  selected: boolean;
  lastUsedAt: number;
}

export function renderThemeSwitcher(state: AppState, selectedPaletteId: string | null, selectedCustomThemeId: string | null, activeThemeName: string, colors: Record<string, string>, enabled: boolean): string {
  return `
    <details class="theme-switcher"${enabled ? '' : ' aria-disabled="true"'}>
      <summary>
        <span class="theme-switcher-copy">
          <span>Switch to theme ...</span>
          <strong>${escapeHtml(activeThemeName)}</strong>
        </span>
        <span class="theme-switcher-chevron" aria-hidden="true">v</span>
      </summary>
      <div class="theme-palette-grid" aria-label="Theme palettes">
        ${renderThemeCards(state, selectedPaletteId, selectedCustomThemeId, colors, enabled)}
      </div>
    </details>`;
}

export function renderThemeCards(state: AppState, selectedPaletteId: string | null, selectedCustomThemeId: string | null, colors: Record<string, string>, enabled = true): string {
  const cards: ThemeCard[] = [
    {
      id: 'default',
      name: 'Default',
      description: 'Use the built-in HVY colors.',
      colors: {},
      builtIn: true,
      selected: selectedCustomThemeId === null && selectedPaletteId === null && Object.keys(colors).length === 0,
      lastUsedAt: state.colorTheme.themeUses.default ?? 0,
    },
    ...HVY_PALETTES.map((palette) => ({
      id: `palette:${palette.id}`,
      name: palette.name,
      description: palette.description,
      colors: palette.colors,
      builtIn: true,
      selected: selectedCustomThemeId === null && selectedPaletteId === palette.id,
      lastUsedAt: state.colorTheme.themeUses[`palette:${palette.id}`] ?? 0,
    })),
    ...state.colorTheme.savedThemes.map((theme) => ({
      id: `custom:${theme.id}`,
      name: theme.name,
      description: 'Custom theme',
      colors: theme.colors,
      builtIn: false,
      selected: selectedCustomThemeId === theme.id,
      lastUsedAt: theme.lastUsedAt,
    })),
  ];
  return cards
    .sort((left, right) => (right.lastUsedAt - left.lastUsedAt) || left.name.localeCompare(right.name))
    .map((theme) => renderThemeCard(theme, enabled))
    .join('');
}

export function renderThemeCard(theme: ThemeCard, enabled = true): string {
  const preview = [
    theme.colors['--hvy-bg'] ?? '#f5f9ff',
    theme.colors['--hvy-accent-1'] ?? '#4a8fab',
    theme.colors['--hvy-surface'] ?? '#ffffff',
  ];
  return `
    <article class="theme-palette-card${theme.selected ? ' is-selected' : ''}${theme.builtIn ? '' : ' theme-palette-card--custom'}">
      <div class="theme-palette-preview${theme.id === 'default' ? ' theme-palette-preview-document' : ''}" aria-hidden="true">
        ${preview.map((color) => `<span style="background: ${escapeAttr(color)}"></span>`).join('')}
      </div>
      <div class="theme-palette-copy">
        <strong>${escapeHtml(theme.name)}</strong>
        <span>${escapeHtml(theme.description)}</span>
      </div>
      <div class="theme-palette-actions">
        <button class="hvy-galaxy-button" type="button" data-action="theme-select" data-theme-id="${escapeAttr(theme.id)}" ${enabled ? '' : 'disabled'}>${theme.selected ? 'Using' : 'Use'}</button>
        ${theme.builtIn ? '' : `<button type="button" class="hvy-galaxy-button ghost" data-action="theme-delete" data-theme-id="${escapeAttr(theme.id)}" ${enabled ? '' : 'disabled'}>Delete</button>`}
      </div>
    </article>`;
}

export function selectedThemeName(paletteId: string | null, customThemeId: string | null, state: AppState, colors = state.colorTheme.colors): string | null {
  if (customThemeId) return state.colorTheme.savedThemes.find((theme) => theme.id === customThemeId)?.name ?? null;
  if (paletteId) return HVY_PALETTES.find((palette) => palette.id === paletteId)?.name ?? null;
  return Object.keys(colors).length === 0 ? 'Default' : null;
}

export interface ThemePreviewItem {
  id: string;
  label: string;
  detail: string;
  className: string;
  variables: string[];
  states: Array<{ id: string; label: string; variables: string[] }>;
  html: string;
}

export function renderThemePreviewPanel(enabled: boolean): string {
  const items: ThemePreviewItem[] = [
    {
      id: 'surface',
      label: 'Surface',
      detail: 'Page, panel, container, and focused target colors',
      className: 'theme-preview-surface-card',
      variables: ['--hvy-bg', '--hvy-bg-alt', '--hvy-surface', '--hvy-surface-alt', '--hvy-surface-tint', '--hvy-border', '--hvy-text', '--hvy-text-alt', '--hvy-focus-ring', '--hvy-focus-glow'],
      states: [
        { id: 'rest', label: 'Rest', variables: ['--hvy-bg', '--hvy-bg-alt', '--hvy-surface', '--hvy-border', '--hvy-text'] },
        { id: 'target', label: 'Target', variables: ['--hvy-surface-tint', '--hvy-focus-ring', '--hvy-focus-glow'] },
      ],
      html: `<div class="theme-demo-surface">
        <div class="theme-demo-page">
          <div class="theme-demo-container">
            <strong>Container</strong>
            <span>Collapsed preview text</span>
          </div>
          <button type="button" class="hvy-galaxy-button theme-demo-target theme-demo-ai-target" data-theme-demo-state="target" data-action="theme-filter-to-colors" data-theme-filter="--hvy-surface-tint --hvy-focus-ring --hvy-focus-glow" ${enabled ? '' : 'disabled'}>AI target</button>
        </div>
      </div>`,
    },
    {
      id: 'text',
      label: 'Text',
      detail: 'Primary text, muted text, links, fill-ins, and highlights',
      className: 'theme-preview-text-card',
      variables: ['--hvy-text', '--hvy-text-alt', '--hvy-text-muted', '--hvy-link-color', '--hvy-link-hover-color', '--hvy-highlight-1', '--hvy-highlight-2', '--hvy-focus-ring'],
      states: [
        { id: 'rest', label: 'Rest', variables: ['--hvy-text', '--hvy-text-alt', '--hvy-text-muted', '--hvy-link-color'] },
        { id: 'search', label: 'Search', variables: ['--hvy-highlight-1', '--hvy-highlight-2'] },
        { id: 'fill-in', label: 'Fill-in', variables: ['--hvy-text-muted', '--hvy-focus-ring'] },
      ],
      html: `<div class="theme-demo-text">
        <p data-theme-demo-state="rest">Paragraph with <span>alternate text</span> and an <a href="#" tabindex="-1">inline link</a>.</p>
        <div class="theme-demo-highlight" data-theme-demo-state="search"><span>Filtered match</span><b>active result</b></div>
        <div class="theme-demo-fill-in" data-theme-demo-state="fill-in">The answer is <span>[____]</span>.</div>
      </div>`,
    },
    {
      id: 'controls',
      label: 'Controls',
      detail: 'Button, input, and ghost component controls',
      className: 'theme-preview-button-card',
      variables: ['--hvy-button-bg', '--hvy-button-text', '--hvy-button-hover-bg', '--hvy-button-hover-text', '--hvy-border-input', '--hvy-ghost-border', '--hvy-focus', '--hvy-shadow-md'],
      states: [
        { id: 'rest', label: 'Rest', variables: ['--hvy-button-bg', '--hvy-button-text', '--hvy-border-input'] },
        { id: 'hover', label: 'Hover', variables: ['--hvy-button-hover-bg', '--hvy-button-hover-text', '--hvy-focus', '--hvy-shadow-md'] },
        { id: 'ghost', label: 'Ghost', variables: ['--hvy-surface-alt', '--hvy-ghost-border', '--hvy-text-muted'] },
      ],
      html: `<div class="theme-demo-controls">
        <button type="button" class="hvy-galaxy-button theme-demo-button" data-theme-demo-state="rest" ${enabled ? '' : 'disabled'}>Generate</button>
        <button type="button" class="hvy-galaxy-button theme-demo-button theme-demo-button-hover" data-theme-demo-state="hover" ${enabled ? '' : 'disabled'}>Generate</button>
        <div class="theme-demo-ghost-input" data-theme-demo-state="ghost">Add component</div>
      </div>`,
    },
    {
      id: 'xref',
      label: 'Xref Card',
      detail: 'Reference cards in rest, hover, and invalid states',
      className: 'theme-preview-xref-card',
      variables: ['--hvy-xref-card-bg', '--hvy-xref-card-hover-bg', '--hvy-border', '--hvy-border-alt', '--hvy-focus', '--hvy-text', '--hvy-text-alt', '--hvy-text-muted', '--hvy-shadow', '--hvy-shadow-md'],
      states: [
        { id: 'rest', label: 'Rest', variables: ['--hvy-xref-card-bg', '--hvy-border', '--hvy-text', '--hvy-text-alt', '--hvy-shadow'] },
        { id: 'hover', label: 'Hover', variables: ['--hvy-xref-card-hover-bg', '--hvy-focus', '--hvy-shadow-md'] },
        { id: 'invalid', label: 'Invalid', variables: ['--hvy-border-alt', '--hvy-text-muted'] },
      ],
      html: `<div class="theme-demo-xref-stack">
        <div class="theme-demo-xref" data-theme-demo-state="rest"><strong>TypeScript</strong><span>Primary language</span></div>
        <div class="theme-demo-xref theme-demo-xref-hover" data-theme-demo-state="hover"><strong>TypeScript</strong><span>Primary language</span></div>
        <div class="theme-demo-xref theme-demo-xref-invalid" data-theme-demo-state="invalid"><strong>Missing target</strong><span>Invalid reference</span></div>
      </div>`,
    },
    {
      id: 'table',
      label: 'Table',
      detail: 'Header and alternating row colors',
      className: 'theme-preview-table-card',
      variables: ['--hvy-table-header', '--hvy-table-row-bg-1', '--hvy-table-row-bg-2', '--hvy-border-input', '--hvy-text'],
      states: [
        { id: 'header', label: 'Header', variables: ['--hvy-table-header', '--hvy-text', '--hvy-border-input'] },
        { id: 'row-1', label: 'Row 1', variables: ['--hvy-table-row-bg-1', '--hvy-text', '--hvy-border-input'] },
        { id: 'row-2', label: 'Row 2', variables: ['--hvy-table-row-bg-2', '--hvy-text', '--hvy-border-input'] },
      ],
      html: `<table class="theme-demo-table">
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody>
          <tr><td>Ada</td><td>Engineer</td></tr>
          <tr><td>Grace</td><td>Compiler</td></tr>
        </tbody>
      </table>`,
    },
    {
      id: 'status',
      label: 'Status',
      detail: 'Warnings, errors, and success feedback',
      className: 'theme-preview-status-card',
      variables: ['--hvy-warning-bg', '--hvy-warning-border', '--hvy-warning-text', '--hvy-danger', '--hvy-success', '--hvy-success-bg', '--hvy-success-border'],
      states: [
        { id: 'warning', label: 'Warning', variables: ['--hvy-warning-bg', '--hvy-warning-border', '--hvy-warning-text'] },
        { id: 'error', label: 'Error', variables: ['--hvy-danger', '--hvy-surface', '--hvy-border'] },
        { id: 'success', label: 'Success', variables: ['--hvy-success', '--hvy-success-bg', '--hvy-success-border'] },
      ],
      html: `<div class="theme-demo-diagnostics">
        <span class="theme-demo-warning" data-theme-demo-state="warning">Warning</span>
        <span class="theme-demo-error" data-theme-demo-state="error">Error</span>
        <span class="theme-demo-success" data-theme-demo-state="success">Saved</span>
      </div>`,
    },
    {
      id: 'code',
      label: 'Code',
      detail: 'Code block and syntax colors',
      className: 'theme-preview-code-card',
      variables: ['--hvy-code-bg', '--hvy-code-text', '--hvy-code-muted', '--hvy-code-string', '--hvy-code-builtin', '--hvy-code-keyword', '--hvy-code-function', '--hvy-code-number', '--hvy-border-input'],
      states: [
        { id: 'block', label: 'Block', variables: ['--hvy-code-bg', '--hvy-code-text', '--hvy-code-muted', '--hvy-border-input'] },
        { id: 'syntax', label: 'Syntax', variables: ['--hvy-code-string', '--hvy-code-builtin', '--hvy-code-keyword', '--hvy-code-function', '--hvy-code-number'] },
      ],
      html: `<pre class="theme-demo-code" data-theme-demo-state="block"><code><i>// theme</i>
<span>const</span> value = <b>"HVY"</b>;</code></pre>
      <pre class="theme-demo-code" data-theme-demo-state="syntax"><code><span>const</span> value = <b>"HVY"</b>;</code></pre>`,
    },
  ];
  return `
    <div class="theme-component-preview-picker" aria-label="Theme component preview picker">
      ${items.map((item, index) => `<button type="button" class="hvy-galaxy-button theme-component-picker-button${index === 0 ? ' is-active' : ''}" data-action="theme-preview-select-component" data-theme-component="${escapeAttr(item.id)}" ${enabled ? '' : 'disabled'}>${escapeHtml(item.label)}</button>`).join('')}
    </div>
    <div class="theme-preview-grid" aria-label="Theme component preview">
      ${items.map((item, index) => renderThemePreviewCard(item, index, enabled)).join('')}
    </div>`;
}

export function renderThemePreviewCard(item: ThemePreviewItem, index: number, enabled: boolean): string {
  const stateButtons = item.states.map((previewState, stateIndex) => `<button
    type="button"
    class="hvy-galaxy-button theme-preview-state-button${stateIndex === 0 ? ' is-active' : ''}"
    data-action="theme-preview-set-state"
    data-theme-state="${escapeAttr(previewState.id)}"
    data-theme-filter="${escapeAttr(previewState.variables.join(' '))}"
    ${enabled ? '' : 'disabled'}
  >${escapeHtml(previewState.label)}</button>`).join('');
  return `<article
    class="theme-preview-card ${escapeAttr(item.className)}${index === 0 ? ' is-active' : ''}"
    data-theme-preview-component="${escapeAttr(item.id)}"
    data-theme-preview-state="${escapeAttr(item.states[0]?.id ?? 'rest')}"
  >
    <span class="theme-preview-card-copy">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </span>
    <span class="theme-preview-state-row">${stateButtons}</span>
    ${item.html}
    <button
      type="button"
      class="hvy-galaxy-button theme-preview-all"
      data-action="theme-filter-to-colors"
      data-theme-filter="${escapeAttr(item.variables.join(' '))}"
      ${enabled ? '' : 'disabled'}
    >All ${escapeHtml(item.label)} colors</button>
  </article>`;
}

export function renderThemeColorRow(name: string, value: string, displayValue: string, enabled = true): string {
  const label = getThemeColorLabel(name);
  const search = `${name} ${label} ${value} ${displayValue}`;
  const overridden = value.trim().length > 0;
  const pickerValue = colorValueToPickerHex(displayValue);
  const alphaValue = colorValueToAlpha(displayValue);
  const valueLabel = `${label} color value`;
  return `
    <div class="theme-color-row${overridden ? ' theme-color-row--override' : ''}" data-theme-color-name="${escapeAttr(name)}" data-theme-search="${escapeAttr(search.toLowerCase())}">
      <div class="theme-color-meta">
        <strong>${escapeHtml(label)}</strong><span class="theme-color-var">${escapeHtml(name)}</span>
      </div>
      <input
        class="hvy-galaxy-input theme-color-picker"
        type="color"
        data-field="theme-color-picker"
        data-color-name="${escapeAttr(name)}"
        value="${escapeAttr(pickerValue)}"
        aria-label="${escapeAttr(`${label} color picker`)}"
        ${enabled ? '' : 'disabled'}
      >
      <input
        class="hvy-galaxy-input theme-color-value"
        data-field="theme-color-value"
        data-color-name="${escapeAttr(name)}"
        value="${escapeAttr(displayValue)}"
        placeholder="CSS color"
        aria-label="${escapeAttr(valueLabel)}"
        spellcheck="false"
        ${enabled ? '' : 'disabled'}
      >
      <label class="theme-alpha-control" title="Alpha">
        <span>A</span>
        <input class="hvy-galaxy-input"
          type="range"
          min="0"
          max="1"
          step="0.01"
          data-field="theme-color-alpha"
          data-color-name="${escapeAttr(name)}"
          value="${escapeAttr(String(alphaValue))}"
          aria-label="${escapeAttr(`${label} alpha`)}"
          ${enabled ? '' : 'disabled'}
        >
        <output>${escapeHtml(String(Math.round(alphaValue * 100)))}</output>
      </label>
      <span class="theme-color-swatch" style="${displayValue ? `background: ${escapeAttr(displayValue)};` : ''}" aria-hidden="true"></span>
      ${overridden
      ? `<span class="theme-color-reset-group"><button type="button" class="hvy-galaxy-button ghost theme-color-action" data-action="theme-reset-color" data-color-name="${escapeAttr(name)}" title="Reset to default" ${enabled ? '' : 'disabled'}>Reset</button></span>`
      : '<span class="theme-color-action theme-color-default muted">Default</span>'}
    </div>`;
}

export function syncThemeAlphaControl(row: HTMLElement | null | undefined, value: string): void {
  if (!row) return;
  const alpha = colorValueToAlpha(value);
  const alphaInput = row.querySelector<HTMLInputElement>('[data-field="theme-color-alpha"]');
  const alphaOutput = row.querySelector<HTMLOutputElement>('.theme-alpha-control output');
  if (alphaInput) {
    alphaInput.value = String(alpha);
  }
  if (alphaOutput) {
    alphaOutput.value = String(Math.round(alpha * 100));
    alphaOutput.textContent = alphaOutput.value;
  }
}

export function syncThemeOverrideAction(row: HTMLElement | null | undefined, name: string, overridden: boolean): void {
  if (!row) return;
  const defaultLabel = row.querySelector<HTMLElement>('.theme-color-default');
  if (overridden && defaultLabel) {
    defaultLabel.outerHTML = `<span class="theme-color-reset-group"><button type="button" class="hvy-galaxy-button ghost theme-color-action" data-action="theme-reset-color" data-color-name="${escapeAttr(name)}" title="Reset to default">Reset</button></span>`;
    return;
  }
  const resetGroup = row.querySelector<HTMLElement>('.theme-color-reset-group');
  if (!overridden && resetGroup) {
    resetGroup.outerHTML = '<span class="theme-color-action theme-color-default muted">Default</span>';
  }
}

export function applyThemeColorFilter(target: HTMLElement): void {
  const dialog = target.closest<HTMLElement>('.color-theme-dialog');
  const input = dialog?.querySelector<HTMLInputElement>('[data-field="theme-color-filter"]');
  if (!dialog || !input) return;
  input.value = target.dataset.themeFilter ?? '';
  applyThemeFilter(dialog, input.value);
  input.focus();
}

export function applyThemeFilter(dialog: HTMLElement, value: string): void {
  const tokens = themeFilterTokens(value);
  dialog.querySelectorAll<HTMLElement>('.theme-color-row').forEach((row) => {
    row.hidden = tokens.length > 0 && !tokens.some((token) => (row.dataset.themeSearch ?? '').includes(token));
  });
}

export function themeFilterTokens(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function getResolvedThemeColor(name: string, overrideValue: string | undefined): string {
  if (overrideValue) return overrideValue;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
