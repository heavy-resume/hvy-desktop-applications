import { selectedInspectionContent } from '../integrationRegistry';
import { type AppState } from '../state';
import { isRecord } from './render-ai-mcp';
import { escapeAttr, escapeHtml } from './shared';

export function integrationCommandGestureLabel(gesture: import('../integrationRegistry').IntegrationInteractionStepDefinition['gesture'] | undefined): string {
  if (gesture === 'double-click') return 'Double click';
  if (gesture === 'right-click') return 'Right click';
  if (gesture === 'type') return 'Enter text';
  return 'Click';
}

export function renderItemCommandPills(integrationId: string, action: import('../integrationRegistry').IntegrationActionDefinition): string {
  const commands = action.commands?.filter((command) => command.scope === 'record') ?? [];
  return `<div class="integration-item-command-group"><strong class="integration-item-command-label">Item commands</strong>${commands.length ? `<div class="integration-command-list integration-command-pills">${commands.map((command) => `<span class="integration-command-pill"><span><strong>${escapeHtml(command.name)}</strong><small>${command.steps.length === 1 ? integrationCommandGestureLabel(command.steps[0]?.gesture) : `${command.steps.length} steps`}</small></span><button type="button" data-action="request-delete-integration-command" data-integration-id="${escapeAttr(integrationId)}" data-action-id="${escapeAttr(action.id)}" data-command-id="${escapeAttr(command.id)}" aria-label="Delete ${escapeAttr(command.name)}">×</button></span>`).join('')}</div>` : '<small>No item commands yet</small>'}</div>`;
}

export function renderIntegrationsDialog(state: AppState): string {
  if (!state.integrationsDialogOpen) return '';
  const selectedIntegration = state.integrationRegistry.integrations.find((integration) => integration.id === state.selectedIntegrationId)
    ?? state.integrationRegistry.integrations[0];
  const profiles = state.integrationRegistry.profiles;
  if (!selectedIntegration) return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog integrations-dialog integrations-manager" role="dialog" aria-modal="true" aria-label="Integrations" data-prevent-dismiss="true">
        <div class="modal-header">
          <div><h2>Web Pages</h2><p class="dialog-note">Open pages with reusable profiles, then define their record types and commands.</p></div>
          <button type="button" class="hvy-galaxy-button icon-button" data-action="close-integrations" aria-label="Close">×</button>
        </div>
        <div class="integrations-manager-body">
          <nav class="integration-list" aria-label="Configured web pages">
            <button type="button" class="hvy-galaxy-button integration-list-add" data-action="request-add-integration-page">+ Add web page</button>
          </nav>
          <main class="integration-detail">
            <div class="integration-empty-state"><strong>No web pages configured</strong><span>Add a web page to open it with a reusable browser profile.</span></div>
          </main>
        </div>
      </section>
    </div>`;
  const selectedPage = selectedIntegration.pages[0];
  const discoveredSources = state.integrationStructuredSourcePageId === selectedPage.id ? state.integrationStructuredSources : [];
  const savedSourceKeys = new Set((selectedPage.retrievalSources ?? []).map((source) => `${source.kind}|${source.url}`));
  const structuredSources = `<section><div class="integration-section-heading"><div><h4>Structured Data</h4><p>Use feeds or same-origin data endpoints when the page already provides structured records.</p></div><button type="button" class="hvy-galaxy-button" data-action="discover-integration-sources" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-page-id="${escapeAttr(selectedPage.id)}" ${state.integrationStructuredSourcePending ? 'disabled' : ''}>${state.integrationStructuredSourcePending ? 'Scanning…' : 'Find data sources'}</button></div>${state.integrationStructuredSourceError ? `<div class="integration-fetch-error" role="alert"><strong>Source lookup failed</strong><span>${escapeHtml(state.integrationStructuredSourceError)}</span></div>` : ''}${selectedPage.retrievalSources?.length ? `<div class="integration-source-list">${selectedPage.retrievalSources.map((source) => `<article><div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(source.kind.toUpperCase())} · ${escapeHtml(source.url)}</span></div><button type="button" class="hvy-galaxy-button" data-action="fetch-integration-source" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-page-id="${escapeAttr(selectedPage.id)}" data-source-id="${escapeAttr(source.id)}" ${state.integrationStructuredSourcePending ? 'disabled' : ''}>Fetch</button></article>`).join('')}</div>` : ''}${discoveredSources.length ? `<div class="integration-discovered-sources"><strong>Available on the current page</strong>${discoveredSources.map((source, index) => `<article><div><strong>${escapeHtml(source.title)}</strong><span>${escapeHtml(source.kind.toUpperCase())} · ${source.authenticated ? 'Uses this profile’s signed-in session' : 'Public feed'}<br>${escapeHtml(source.url)}</span></div><button type="button" class="hvy-galaxy-button" data-action="save-integration-source" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-page-id="${escapeAttr(selectedPage.id)}" data-source-index="${index}" ${savedSourceKeys.has(`${source.kind}|${source.url}`) ? 'disabled' : ''}>${savedSourceKeys.has(`${source.kind}|${source.url}`) ? 'Saved' : 'Save'}</button></article>`).join('')}</div>` : state.integrationStructuredSourcePageId === selectedPage.id && !state.integrationStructuredSourcePending ? '<small>No advertised feeds or observed same-origin data endpoints.</small>' : ''}</section>`;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog integrations-dialog integrations-manager" role="dialog" aria-modal="true" aria-label="Integrations" data-prevent-dismiss="true">
        <div class="modal-header">
          <div><h2>Web Pages</h2><p class="dialog-note">Open pages with reusable profiles, then define their record types and commands.</p></div>
          <div class="integrations-header-actions">
            <div class="integration-profile-controls"><label class="integration-profile-select"><span>Use profile</span><select class="hvy-galaxy-select" data-action="select-integration-profile" aria-label="Use profile">${profiles.map((profile) => `<option value="${escapeAttr(profile.id)}" ${profile.id === state.selectedIntegrationProfileId ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')}</select></label><button type="button" class="hvy-galaxy-button icon-button" data-action="request-add-integration-profile" title="Add profile" aria-label="Add profile">+</button></div>
            <button type="button" class="hvy-galaxy-button icon-button" data-action="close-integrations" aria-label="Close">×</button>
          </div>
        </div>
        <div class="integrations-manager-body">
          <nav class="integration-list" aria-label="Configured web pages">
            ${state.integrationRegistry.integrations.map((integration) => `<button type="button" class="hvy-galaxy-button integration-list-item ${integration.id === selectedIntegration.id ? 'selected' : ''}" data-action="select-integration" data-integration-id="${escapeAttr(integration.id)}"><strong>${escapeHtml(integration.name)}</strong><span>${escapeHtml(new URL(integration.pages[0].url).hostname)} · ${integration.actions.length} record ${integration.actions.length === 1 ? 'type' : 'types'}</span></button>`).join('')}
            <button type="button" class="hvy-galaxy-button integration-list-add" data-action="request-add-integration-page">+ Add web page</button>
          </nav>
          <main class="integration-detail">
            <div class="integration-detail-header"><div class="integration-page-identity"><button class="hvy-galaxy-button" type="button" data-action="open-integration-page" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-page-id="${escapeAttr(selectedPage.id)}">Open</button><div><h3>${escapeHtml(selectedPage.name)}</h3><p>${escapeHtml(new URL(selectedPage.url).hostname)}</p></div></div><button class="hvy-galaxy-button" type="button" data-action="open-integration-ready-checks" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-page-id="${escapeAttr(selectedPage.id)}">Ready checks</button></div>
            <section><div class="integration-section-heading"><div><h4>Page Commands</h4><p>Commands that do not require a matched record.</p></div><div class="integration-section-actions"><button type="button" class="hvy-galaxy-button icon-button" data-action="add-command-for-integration-page" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-page-id="${escapeAttr(selectedPage.id)}" title="Add page command" aria-label="Add page command">+</button></div></div>${selectedPage.commands?.length ? `<div class="integration-command-list integration-page-command-list">${selectedPage.commands.map((command) => `<button type="button" class="hvy-galaxy-button" data-action="run-integration-page-command" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-page-id="${escapeAttr(selectedPage.id)}" data-command-id="${escapeAttr(command.id)}">${escapeHtml(command.name)}</button>`).join('')}</div>` : '<div class="integration-empty-state integration-section-empty"><strong>No page commands yet</strong></div>'}</section>
            ${structuredSources}
            <section><div class="integration-section-heading"><div><h4>Record Types</h4><p>Reusable structures and commands that belong to ${escapeHtml(selectedPage.name)}.</p></div><div class="integration-section-actions">${state.integrationActionFetchPendingId ? `<span class="integration-fetch-status" role="status"><span class="integration-selection-pulse" aria-hidden="true"></span>Fetching items in the background…</span>` : ''}<button type="button" class="hvy-galaxy-button icon-button" data-action="add-action-for-integration-page" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-page-id="${escapeAttr(selectedPage.id)}" title="Define record type" aria-label="Define record type">+</button></div></div>${state.integrationActionFetchError ? `<div class="integration-fetch-error" role="alert"><strong>Fetch failed</strong><span>${escapeHtml(state.integrationActionFetchError)}</span></div>` : ''}${selectedIntegration.actions.length ? `<div class="integration-action-list">${selectedIntegration.actions.map((action) => `<article class="integration-record-definition"><div class="integration-record-summary"><strong>${escapeHtml(action.name)}${action.status === 'draft' ? ' <small>Draft</small>' : ''}</strong><span>${escapeHtml(action.description || action.pattern?.fields.map((field) => field.label).join(', ') || '')}</span>${renderItemCommandPills(selectedIntegration.id, action)}</div><div class="integration-record-actions"><button type="button" class="hvy-galaxy-button" data-action="edit-integration-action" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-action-id="${escapeAttr(action.id)}">Edit</button><button type="button" class="hvy-galaxy-button danger-button" data-action="request-delete-integration-action" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-action-id="${escapeAttr(action.id)}">Delete</button><button type="button" class="hvy-galaxy-button" data-action="add-command-for-integration-action" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-action-id="${escapeAttr(action.id)}">Add item command</button><button type="button" class="hvy-galaxy-button primary-button" data-action="run-integration-action" data-integration-id="${escapeAttr(selectedIntegration.id)}" data-action-id="${escapeAttr(action.id)}" ${action.pattern && !state.integrationActionFetchPendingId ? '' : 'disabled'}>${state.integrationActionFetchPendingId === action.id ? 'Fetching…' : 'Fetch items'}</button></div></article>`).join('')}</div>` : '<div class="integration-empty-state integration-section-empty"><strong>No record types yet</strong></div>'}</section>
          </main>
        </div>
      </section>
    </div>`;
}

export function renderExtractedValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? `<ul>${value.map((item) => `<li>${renderExtractedValue(item)}</li>`).join('')}</ul>` : '<span class="integration-empty-value">No values</span>';
  if (value && typeof value === 'object' && typeof (value as { imageUrl?: unknown }).imageUrl === 'string') {
    const image = value as { imageUrl: string; alt?: unknown };
    return `<figure class="integration-result-image"><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(typeof image.alt === 'string' ? image.alt : '')}"><figcaption>${escapeHtml(typeof image.alt === 'string' && image.alt ? image.alt : 'Image')}</figcaption></figure>`;
  }
  return `<span>${escapeHtml(String(value ?? ''))}</span>`;
}

export function renderExtractionRecords(records: unknown[], commandContext?: { integrationId: string; actionId: string; commands: NonNullable<import('../integrationRegistry').IntegrationActionDefinition['commands']> }): string {
  if (!records.length) return '<div class="integration-empty-state"><strong>No matching records</strong><span>Go back and add another example or adjust the selected parent and targets.</span></div>';
  return `<div class="integration-result-records">${records.map((record, index) => {
    const targets = record && typeof record === 'object' && Array.isArray((record as { targets?: unknown }).targets)
      ? (record as { targets: Array<{ label?: unknown; value?: unknown }> }).targets
      : [];
    const parent = record && typeof record === 'object' && typeof (record as { parent?: unknown }).parent === 'string' ? (record as { parent: string }).parent : '';
    const recordCommands = commandContext?.commands.filter((command) => command.scope === 'record') ?? [];
    return `<article class="integration-result-record"><strong>Item ${index + 1}</strong><dl>${targets.map((target) => `<div><dt>${escapeHtml(String(target.label ?? 'Value'))}</dt><dd>${renderExtractedValue(target.value)}</dd></div>`).join('')}</dl>${recordCommands.length ? `<div class="integration-result-commands">${recordCommands.map((command) => `<button type="button" class="hvy-galaxy-button" data-action="run-integration-command" data-integration-id="${escapeAttr(commandContext!.integrationId)}" data-action-id="${escapeAttr(commandContext!.actionId)}" data-command-id="${escapeAttr(command.id)}" data-record-parent="${escapeAttr(parent)}">${escapeHtml(command.name)}</button>`).join('')}</div>` : ''}</article>`;
  }).join('')}</div>`;
}

export function extractedValueIsImage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(extractedValueIsImage);
  return Boolean(value && typeof value === 'object' && typeof (value as { imageUrl?: unknown }).imageUrl === 'string');
}

export function extractionTableSummary(value: unknown): string {
  if (extractedValueIsImage(value)) return 'Yes';
  if (Array.isArray(value)) return value.map(extractionTableSummary).filter(Boolean).join(', ') || '—';
  const text = String(value ?? '').trim();
  return text || '—';
}

export function renderExtractionPreviewTable(records: unknown[]): string {
  if (!records.length) return '<div class="integration-empty-state"><strong>No matching records</strong><span>Return to the builder, add another example, or adjust match confidence.</span></div>';
  const rows = records.map((record) => record && typeof record === 'object' && Array.isArray((record as { targets?: unknown }).targets)
    ? (record as { targets: Array<{ label?: unknown; value?: unknown }> }).targets
    : []);
  const labels = [...new Set(rows.flatMap((targets) => targets.map((target) => String(target.label ?? 'Value'))))];
  const imageLabels = new Set(labels.filter((label) => rows.some((targets) => extractedValueIsImage(targets.find((target) => String(target.label ?? 'Value') === label)?.value))));
  const columns = Math.max(1, labels.length);
  const header = labels.map((label) => `<strong>${escapeHtml(label)}</strong>`).join('');
  const body = rows.map((targets) => {
    const values = new Map(targets.map((target) => [String(target.label ?? 'Value'), target.value]));
    const summary = labels.map((label) => {
      const value = imageLabels.has(label) ? extractedValueIsImage(values.get(label)) ? 'Yes' : 'No' : extractionTableSummary(values.get(label));
      return `<span title="${escapeAttr(value)}">${escapeHtml(value)}</span>`;
    }).join('');
    const details = labels.map((label) => `<div><dt>${escapeHtml(label)}</dt><dd>${renderExtractedValue(values.get(label))}</dd></div>`).join('');
    return `<details class="integration-preview-table-row"><summary style="--integration-preview-columns:${columns}"><span class="integration-preview-row-toggle" aria-hidden="true"></span>${summary}</summary><dl>${details}</dl></details>`;
  }).join('');
  return `<div class="integration-preview-table"><div class="integration-preview-table-header" style="--integration-preview-columns:${columns}"><span></span>${header}</div>${body}</div>`;
}

export function renderPatternDiagnostics(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const diagnostics = value as { inspectedElements?: unknown; bestParentScore?: unknown; aggregateScore?: unknown; relationshipScore?: unknown; distinctTargets?: unknown; fields?: Array<{ label?: unknown; score?: unknown }> };
  const parentScore = typeof diagnostics.bestParentScore === 'number' ? Math.round(diagnostics.bestParentScore * 100) : 0;
  const aggregateScore = typeof diagnostics.aggregateScore === 'number' ? Math.round(diagnostics.aggregateScore * 100) : 0;
  const relationshipScore = typeof diagnostics.relationshipScore === 'number' ? Math.round(diagnostics.relationshipScore * 100) : 0;
  const fields = Array.isArray(diagnostics.fields) ? diagnostics.fields : [];
  return `<div class="integration-match-diagnostics"><strong>Why nothing matched</strong><p>The closest parent scored ${parentScore}% and the complete record scored ${aggregateScore}%. ${fields.length ? `Closest fields: ${fields.map((field) => `${escapeHtml(String(field.label || 'Field'))} ${typeof field.score === 'number' ? Math.round(field.score * 100) : 0}%`).join(', ')}.` : ''}</p><small>Relationship ${relationshipScore}% · ${diagnostics.distinctTargets === false ? 'Two or more fields resolved to the same element · ' : ''}Galaxy inspected ${typeof diagnostics.inspectedElements === 'number' ? diagnostics.inspectedElements : 0} visible elements. These scores contain no page text.</small></div>`;
}

export function renderIntegrationActionBuilderDialog(state: AppState): string {
  if (!state.integrationActionBuilderOpen) return '';
  if (state.integrationActionSelectionPending) {
    const selectionName = state.integrationActionSelectionKind === 'parent' ? 'a parent item' : state.integrationActionSelectionKind === 'example' ? 'another example item' : 'target data';
    const collectingFields = state.integrationActionSelectionKind === 'target' && state.integrationActionTargetSelectionFieldIndex === null;
    return `<div class="modal-backdrop" role="presentation"><section class="dialog integration-action-builder-dialog integration-selection-waiting" role="dialog" aria-modal="true" aria-label="Waiting for integration selection"><div class="modal-header"><div><p class="eyebrow">${state.integrationActionDraftActionId ? 'Edit' : 'Build'} record type</p><h2>${collectingFields ? 'Select fields' : `Select ${selectionName}`}</h2><p class="dialog-note">Galaxy has switched to the integration browser. ${collectingFields ? 'Choose all of the fields you want, then select Done.' : 'It will return here after you make a selection.'}</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="cancel-integration-action-selection" aria-label="Cancel selection">×</button></div><div class="integration-selection-waiting-status"><span class="integration-selection-pulse" aria-hidden="true"></span><strong>Waiting for your selection…</strong><span>${collectingFields ? 'Each selected field stays boxed on the page until you finish.' : state.integrationActionSelectionKind === 'target' ? 'Choose one text, image, or value inside the selected item.' : 'Choose the smallest parent containing one complete item and all of the data you want.'}</span></div></section></div>`;
  }
  if (state.integrationActionBuilderStep === 'preview') {
    const canSave = Boolean(state.integrationActionDraftName.trim()) && state.integrationActionTargetLabels.every((label) => label.trim());
    return `<div class="modal-backdrop" role="presentation"><section class="dialog integration-action-builder-dialog integration-preview-dialog" role="dialog" aria-modal="true" aria-label="Preview"><div class="modal-header"><div><p class="eyebrow">${state.integrationActionDraftActionId ? 'Edit' : 'Build'} record type</p><h2>Preview</h2><p class="dialog-note">Galaxy found ${state.integrationActionPreviewRecords.length} matching ${state.integrationActionPreviewRecords.length === 1 ? 'item' : 'items'}. Select a row to see complete values and images.</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="close-integration-action-builder" aria-label="Close">×</button></div><div class="integration-action-builder-content">${renderPatternDiagnostics(state.integrationActionPreviewDiagnostics)}${renderExtractionPreviewTable(state.integrationActionPreviewRecords)}</div><div class="dialog-actions"><button type="button" class="hvy-galaxy-button" data-action="back-integration-action-builder">Back</button><button type="button" class="hvy-galaxy-button primary-button" data-action="save-integration-action-draft" ${canSave ? '' : 'disabled'}>Save</button></div></section></div>`;
  }
  const parents = state.integrationActionAnchors;
  const targets = state.integrationActionExamples;
  const labelsComplete = targets.length > 0 && targets.every((_, index) => state.integrationActionTargetLabels[index]?.trim());
  const fieldHeaders = targets.map((_, fieldIndex) => `<th><div class="integration-field-column-header"><input class="hvy-galaxy-input" aria-label="Field ${fieldIndex + 1} name" data-field="integration-target-label" data-index="${fieldIndex}" value="${escapeAttr(state.integrationActionTargetLabels[fieldIndex] ?? '')}" placeholder="Field ${fieldIndex + 1}"><button type="button" tabindex="-1" class="integration-field-remove integration-field-column-remove" data-action="remove-integration-action-selection" data-kind="target" data-index="${fieldIndex}" aria-label="Remove ${escapeAttr(state.integrationActionTargetLabels[fieldIndex] || `field ${fieldIndex + 1}`)}">×</button><div><button type="button" tabindex="-1" class="hvy-galaxy-button integration-field-setting ${state.integrationActionTargetCardinalities[fieldIndex] === 'list' ? 'is-active' : ''}" data-action="toggle-integration-target-many" data-index="${fieldIndex}" aria-pressed="${state.integrationActionTargetCardinalities[fieldIndex] === 'list'}">Many</button></div></div></th>`).join('');
  const exampleRows = parents.map((_parent, parentIndex) => {
    const liveRecord = state.integrationActionLiveExampleRecords[parentIndex];
    const liveTargets = liveRecord && typeof liveRecord === 'object' && Array.isArray((liveRecord as { targets?: unknown }).targets)
      ? (liveRecord as { targets: Array<{ label?: unknown; value?: unknown }> }).targets
      : [];
    const liveScore = liveRecord && typeof liveRecord === 'object' && typeof (liveRecord as { score?: unknown }).score === 'number'
      ? Math.round((liveRecord as { score: number }).score * 100)
      : null;
    const hasCapturedValues = targets.some((_, fieldIndex) => selectedInspectionContent(state.integrationActionTargetVariants[fieldIndex]?.[parentIndex] ?? ''));
    const cells = targets.map((_, fieldIndex) => {
      const picked = state.integrationActionTargetVariants[fieldIndex]?.[parentIndex] ?? null;
      const absent = state.integrationActionTargetAbsentExamples[fieldIndex]?.[parentIndex] ?? false;
      const liveTarget = liveTargets.find((target) => String(target.label ?? '') === state.integrationActionTargetLabels[fieldIndex]);
      const value = liveTarget ? extractionTableSummary(liveTarget.value) : absent ? 'Not present' : picked ? selectedInspectionContent(picked) || 'Saved structure' : 'Not matched';
      return `<td class="${picked ? '' : 'missing'}" title="${escapeAttr(value)}">${escapeHtml(value)}</td>`;
    }).join('');
    return `<tr><th scope="row"><span>Example ${parentIndex + 1}${liveTargets.length ? `<small>Best live fit${liveScore === null ? '' : ` · ${liveScore}%`}</small>` : hasCapturedValues ? '<small>Captured example</small>' : '<small>No live fit</small>'}</span><button type="button" tabindex="-1" class="integration-field-remove integration-field-column-remove integration-example-remove" data-action="remove-integration-action-selection" data-kind="example" data-index="${parentIndex}" aria-label="Remove example ${parentIndex + 1}">×</button></th>${cells}</tr>`;
  }).join('');
  const requirements = targets.map((_, fieldIndex) => `<button type="button" class="hvy-galaxy-button integration-field-setting ${state.integrationActionTargetOptional[fieldIndex] ? '' : 'is-active'}" data-action="toggle-integration-target-required" data-index="${fieldIndex}" aria-pressed="${state.integrationActionTargetOptional[fieldIndex] ? 'false' : 'true'}">${escapeHtml(state.integrationActionTargetLabels[fieldIndex] || `Field ${fieldIndex + 1}`)}</button>`).join('');
  const canSave = Boolean(state.integrationActionDraftName.trim()) && labelsComplete && parents.length > 0;
  return `<div class="modal-backdrop" role="presentation"><section class="dialog integration-action-builder-dialog integration-record-table-dialog" role="dialog" aria-modal="true" aria-label="${state.integrationActionDraftActionId ? 'Edit' : 'Build'} record type" aria-busy="${state.integrationActionPreviewPending}"><div class="modal-header"><div><p class="eyebrow">${state.integrationActionDraftActionId ? 'Edit' : 'Build'} record type</p><h2>Define fields and examples</h2><p class="dialog-note">${state.integrationActionPreviewPending ? 'Previewing matches against the integration page in the background…' : state.integrationActionEditPageLoading ? 'Preparing the integration page for editing…' : 'Fields are columns. Saved examples are immutable rows of structural evidence.'}</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="close-integration-action-builder" aria-label="Close" ${state.integrationActionPreviewPending ? 'disabled' : ''}>×</button></div><div class="integration-action-builder-content"><section class="integration-pattern-section integration-record-type-details"><label><span>Name</span><input class="hvy-galaxy-input" data-field="integration-record-type-name" autocomplete="off" value="${escapeAttr(state.integrationActionDraftName)}"></label><label><span>Description <small>Optional</small></span><input class="hvy-galaxy-input" data-field="integration-record-type-description" value="${escapeAttr(state.integrationActionDraftDescription)}"></label></section><section class="integration-pattern-section integration-confidence-first"><label class="integration-confidence-control"><span><strong>Minimum match confidence</strong><output>${Math.round(state.integrationActionMinimumConfidence * 100)}%</output></span><input type="range" min="50" max="95" step="1" value="${Math.round(state.integrationActionMinimumConfidence * 100)}" data-field="integration-action-confidence"><small>Lower values accept more structural variation.</small></label></section><section class="integration-pattern-section"><div class="integration-section-heading"><div><h3>Examples</h3><p>Values are truncated in the table. Saved record types retain structural signatures rather than private page text.</p></div><button type="button" class="hvy-galaxy-button" data-action="add-another-integration-action-example" data-parent-index="0" ${parents.length && !state.integrationActionEditPageLoading && !state.integrationActionPreviewPending ? '' : 'disabled'}>+ Add fields</button></div><div class="integration-example-table-wrap"><table class="integration-example-table"><thead><tr><th>Example</th>${fieldHeaders}</tr></thead><tbody>${exampleRows}<tr class="integration-add-example-row"><th><button type="button" class="hvy-galaxy-button" data-action="add-integration-action-anchor" ${state.integrationActionEditPageLoading || state.integrationActionPreviewPending ? 'disabled' : ''}>＋</button></th><td colspan="${Math.max(1, targets.length)}">Add example</td></tr></tbody></table></div></section><section class="integration-pattern-section integration-required-fields"><div><h3>Required fields</h3><p>Illuminate fields that must exist for a record to match.</p></div><div>${requirements || '<span class="integration-empty-value">Add fields to configure requirements.</span>'}</div></section></div><div class="dialog-actions">${state.integrationActionPreviewPending ? '<span class="integration-background-operation"><span class="integration-selection-pulse" aria-hidden="true"></span>Scanning page…</span>' : ''}<button type="button" class="hvy-galaxy-button" data-action="test-integration-action-pattern" ${labelsComplete && parents.length && !state.integrationActionEditPageLoading && !state.integrationActionPreviewPending ? '' : 'disabled'}>Highlight matches</button><button type="button" class="hvy-galaxy-button" data-action="preview-integration-action" ${labelsComplete && parents.length && !state.integrationActionEditPageLoading && !state.integrationActionPreviewPending ? '' : 'disabled'}>${state.integrationActionPreviewPending ? 'Previewing…' : 'Preview'}</button><button type="button" class="hvy-galaxy-button primary-button" data-action="save-integration-action-draft" ${canSave && !state.integrationActionPreviewPending ? '' : 'disabled'}>Save</button></div></section></div>`;
}

export function renderIntegrationCommandBuilderDialog(state: AppState): string {
  if (!state.integrationCommandBuilderOpen) return '';
  if (state.integrationCommandSelectionPending) {
    return `<div class="modal-backdrop" role="presentation"><section class="dialog integration-action-builder-dialog integration-selection-waiting" role="dialog" aria-modal="true" aria-label="Recording command"><div class="modal-header"><div><p class="eyebrow">Add ${state.integrationCommandDraftScope === 'record' ? 'item' : 'page'} command</p><h2>Record and verify the action</h2><p class="dialog-note">Galaxy has switched to the integration browser. Build the complete action there in one pass.</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="cancel-integration-command-builder" aria-label="Cancel command">×</button></div><div class="integration-selection-waiting-status"><span class="integration-selection-pulse" aria-hidden="true"></span><strong>Recording in the browser…</strong><span>Each step is structurally resolved and performed before you add the next one.</span></div></section></div>`;
  }
  const steps = state.integrationCommandDraftSteps.map((step, index) => {
    const target = escapeHtml(selectedInspectionContent(step.target) || 'Structural control');
    const detail = step.gesture === 'type' ? `Enter a parameter into ${target}` : `${integrationCommandGestureLabel(step.gesture)} ${target}`;
    return `<div class="integration-selection-row"><div class="integration-selection-review"><strong>${index + 1}</strong><span>${detail}</span><small>Resolved and performed successfully while recording.</small></div></div>`;
  }).join('');
  const inputFields = state.integrationCommandDraftSteps.flatMap((step, index) => step.gesture === 'type' && step.inputId ? [`<label><span>Parameter for step ${index + 1}</span><input class="hvy-galaxy-input" name="recordedInput:${escapeAttr(step.inputId)}" placeholder="Parameter name" required autocomplete="off"></label>`] : []).join('');
  return `<div class="modal-backdrop" role="presentation"><form class="dialog integration-action-builder-dialog" role="dialog" aria-modal="true" aria-label="Name recorded command" data-form="integration-command-reconcile"><div class="modal-header"><div><p class="eyebrow">${state.integrationCommandDraftScope === 'record' ? 'Item command' : 'Page command'}</p><h2>Name the recorded action</h2><p class="dialog-note">The browser already verified every interaction. Name the action and its text parameters; temporary recording values are not retained.</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="cancel-integration-command-builder" aria-label="Cancel command">×</button></div><label><span>Action name</span><input class="hvy-galaxy-input" name="commandName" placeholder="Action name" required autocomplete="off"></label>${inputFields}<section class="integration-selection-collection"><h3>Verified sequence</h3><div>${steps}</div></section><div class="dialog-actions"><button type="button" class="hvy-galaxy-button" data-action="cancel-integration-command-builder">Cancel</button><button type="submit" class="hvy-galaxy-button primary-button">Save action</button></div></form></div>`;
}

export function renderIntegrationCommandRunDialog(state: AppState): string {
  const request = state.integrationCommandRunRequest;
  if (!request) return '';
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === request.integrationId);
  const action = request.actionId ? integration?.actions.find((candidate) => candidate.id === request.actionId) : undefined;
  const page = request.pageId ? integration?.pages.find((candidate) => candidate.id === request.pageId) : undefined;
  const command = action?.commands?.find((candidate) => candidate.id === request.commandId)
    ?? page?.commands?.find((candidate) => candidate.id === request.commandId);
  if (!command) return '';
  const fields = (command.inputs ?? []).map((input) => {
    const attributes = `class="hvy-galaxy-input" name="commandInput:${escapeAttr(input.id)}" ${input.required ? 'required' : ''}`;
    const control = input.id.includes('body') ? `<textarea ${attributes} rows="6"></textarea>` : `<input ${attributes} autocomplete="off">`;
    return `<label><span>${escapeHtml(input.name)}</span>${control}</label>`;
  }).join('');
  return `<div class="modal-backdrop modal-backdrop-stacked" role="presentation"><form class="dialog" role="dialog" aria-modal="true" aria-label="Run ${escapeAttr(command.name)}" data-form="integration-command-run"><div class="modal-header"><div><p class="eyebrow">Run action</p><h2>${escapeHtml(command.name)}</h2><p class="dialog-note">Enter the values for this run.</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="cancel-integration-command-run" aria-label="Cancel command">×</button></div>${fields}<div class="dialog-actions"><button type="button" class="hvy-galaxy-button" data-action="cancel-integration-command-run">Cancel</button><button type="submit" class="hvy-galaxy-button primary-button">Run</button></div></form></div>`;
}

export function renderIntegrationActionResultDialog(state: AppState): string {
  if (!state.integrationActionResultOpen) return '';
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.actions.some((action) => action.id === state.integrationActionResultActionId));
  const action = integration?.actions.find((candidate) => candidate.id === state.integrationActionResultActionId);
  const commands = action?.commands?.filter((command) => command.scope === 'record') ?? [];
  const commandContext = integration && action ? { integrationId: integration.id, actionId: action.id, commands } : undefined;
  return `<div class="modal-backdrop" role="presentation"><section class="dialog integration-action-builder-dialog" role="dialog" aria-modal="true" aria-label="Action results"><div class="modal-header"><div><p class="eyebrow">Fetched items</p><h2>${escapeHtml(state.integrationActionResultName)}</h2><p class="dialog-note">Found ${state.integrationActionResultRecords.length} matching ${state.integrationActionResultRecords.length === 1 ? 'item' : 'items'} on the current page.</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="close-integration-action-result" aria-label="Close">×</button></div><div class="integration-action-builder-content">${renderExtractionRecords(state.integrationActionResultRecords, commandContext)}</div><div class="dialog-actions"><button type="button" class="hvy-galaxy-button primary-button" data-action="close-integration-action-result">Done</button></div></section></div>`;
}

export function renderStructuredDataValue(value: unknown, depth = 0): string {
  if (depth >= 4) return '<span class="integration-empty-value">Nested data</span>';
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="integration-empty-value">No items</span>';
    return `<div class="integration-structured-items">${value.slice(0, 100).map((item) => `<details><summary>${isRecord(item) ? escapeHtml(String(item.title ?? item.name ?? item.id ?? 'Item')) : escapeHtml(String(item))}</summary>${renderStructuredDataValue(item, depth + 1)}</details>`).join('')}</div>`;
  }
  if (isRecord(value)) {
    return `<dl class="integration-structured-fields">${Object.entries(value).slice(0, 100).map(([key, item]) => `<div><dt>${escapeHtml(key)}</dt><dd>${renderStructuredDataValue(item, depth + 1)}</dd></div>`).join('')}</dl>`;
  }
  if (typeof value === 'string' && /^https:\/\//.test(value)) return `<a href="${escapeAttr(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`;
  return `<span>${escapeHtml(String(value ?? ''))}</span>`;
}

export function renderIntegrationStructuredResultDialog(state: AppState): string {
  if (!state.integrationStructuredResultOpen) return '';
  return `<div class="modal-backdrop" role="presentation"><section class="dialog integration-action-builder-dialog" role="dialog" aria-modal="true" aria-label="Structured data result"><div class="modal-header"><div><p class="eyebrow">Structured data</p><h2>${escapeHtml(state.integrationStructuredResultName)}</h2><p class="dialog-note">Fetched through the selected integration profile. Expand items to inspect their fields.</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="close-integration-structured-result" aria-label="Close">×</button></div><div class="integration-action-builder-content">${renderStructuredDataValue(state.integrationStructuredResult)}</div><div class="dialog-actions"><button type="button" class="hvy-galaxy-button primary-button" data-action="close-integration-structured-result">Done</button></div></section></div>`;
}

export function renderIntegrationActionDiscardDialog(state: AppState): string {
  if (!state.integrationActionDiscardDialogOpen) return '';
  return `<div class="modal-backdrop modal-backdrop-stacked" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-label="Discard record type changes"><h2>Discard these changes?</h2><p>Your record type edits, selected examples, fields, and extraction preview will be lost.</p><div class="dialog-actions"><button type="button" class="hvy-galaxy-button" data-action="cancel-discard-integration-action">Keep editing</button><button type="button" class="hvy-galaxy-button danger-button" data-action="confirm-discard-integration-action">Discard changes</button></div></section></div>`;
}

export function renderIntegrationRecordDeleteDialog(state: AppState): string {
  if (!state.integrationRecordDeleteDialogOpen) return '';
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationRecordDeleteIntegrationId);
  const action = integration?.actions.find((candidate) => candidate.id === state.integrationRecordDeleteActionId);
  return `<div class="modal-backdrop modal-backdrop-stacked" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-label="Delete record type"><h2>Delete ${escapeHtml(action?.name ?? 'this record type')}?</h2><p>This permanently removes the record type and all of its item commands. It does not change the web page or its account data.</p><div class="dialog-actions"><button type="button" class="hvy-galaxy-button" data-action="cancel-delete-integration-action">Cancel</button><button type="button" class="hvy-galaxy-button danger-button" data-action="confirm-delete-integration-action">Delete record type</button></div></section></div>`;
}

export function renderIntegrationCommandDeleteDialog(state: AppState): string {
  if (!state.integrationCommandDeleteDialogOpen) return '';
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationCommandDeleteIntegrationId);
  const action = integration?.actions.find((candidate) => candidate.id === state.integrationCommandDeleteActionId);
  const command = action?.commands?.find((candidate) => candidate.id === state.integrationCommandDeleteCommandId);
  return `<div class="modal-backdrop modal-backdrop-stacked" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-label="Delete item command"><h2>Delete ${escapeHtml(command?.name ?? 'this item command')}?</h2><p>This removes the command from ${escapeHtml(action?.name ?? 'the record type')}. It does not run the command or change the web page.</p><div class="dialog-actions"><button type="button" class="hvy-galaxy-button" data-action="cancel-delete-integration-command">Cancel</button><button type="button" class="hvy-galaxy-button danger-button" data-action="confirm-delete-integration-command">Delete item command</button></div></section></div>`;
}

export function renderAddIntegrationPageDialog(state: AppState): string {
  if (!state.addIntegrationPageDialogOpen) return '';
  return `<div class="modal-backdrop" role="presentation"><form class="dialog" role="dialog" aria-modal="true" aria-label="Add integration page" data-form="add-integration-page"><h2>Add web page</h2><label><span>Name</span><input class="hvy-galaxy-input" name="pageName" required autocomplete="off" placeholder="Name for this page"></label><label><span>HTTPS URL</span><input class="hvy-galaxy-input" name="pageUrl" type="url" required pattern="https://.*" placeholder="https://example.com/"></label><div class="dialog-actions"><button class="hvy-galaxy-button" type="button" data-action="cancel-add-integration-page">Cancel</button><button class="hvy-galaxy-button" type="submit">Add page</button></div></form></div>`;
}

export function renderIntegrationReadyChecksDialog(state: AppState): string {
  if (!state.integrationReadyChecksDialogOpen || !state.integrationReadyChecksDraft) return '';
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.integrationReadyChecksIntegrationId);
  const page = integration?.pages.find((candidate) => candidate.id === state.integrationReadyChecksPageId);
  if (!integration || !page) return '';
  const draft = state.integrationReadyChecksDraft;
  if (state.integrationReadyCheckSelectionPending) {
    return `<div class="modal-backdrop modal-backdrop-stacked" role="presentation"><section class="dialog integration-selection-waiting" role="dialog" aria-modal="true" aria-label="Select a ready check"><h2>Select a page landmark</h2><p class="dialog-note">Choose an element that is only present when ${escapeHtml(page.name)} is ready. Galaxy will return here after the selection.</p><div class="integration-selection-waiting-status"><span class="integration-selection-pulse" aria-hidden="true"></span><strong>Waiting for your selection…</strong></div><div class="dialog-actions"><button type="button" class="hvy-galaxy-button" data-action="cancel-integration-ready-check-selection">Cancel selection</button></div></section></div>`;
  }
  const modeHelp = draft.urlMode === 'strict-url'
    ? 'The complete URL, including its path, query, and fragment, must match.'
    : draft.urlMode === 'strict-domain'
      ? 'The current hostname must match exactly.'
      : 'The regular expression is evaluated against the current hostname.';
  const validation = state.integrationReadyCheckValidationResult;
  const validationBadge = (ready: boolean, failure: string) => `<span class="integration-ready-result" data-state="${ready ? 'ready' : 'failed'}">${ready ? '✓ Passed' : `× ${escapeHtml(failure)}`}</span>`;
  const elements = draft.elements.length ? draft.elements.map((check) => {
    const result = validation?.elements.find((candidate) => candidate.id === check.id);
    const failure = result?.reason === 'value_changed' ? 'Value changed' : 'Not found';
    return `<article class="integration-ready-check-row"><div><div class="integration-ready-check-heading"><strong>${escapeHtml(check.name)}</strong>${result ? validationBadge(result.ready, failure) : ''}</div><small>Leave the value blank to check only that the element exists.</small><input class="hvy-galaxy-input" name="readyValue:${escapeAttr(check.id)}" value="${escapeAttr(check.expectedValue ?? '')}" placeholder="Element exists"></div><button type="button" class="hvy-galaxy-button danger-button" data-action="remove-integration-ready-check" data-check-id="${escapeAttr(check.id)}">Remove</button></article>`;
  }).join('') : '<div class="integration-empty-state integration-section-empty"><strong>No element checks</strong><span>The URL check alone determines when this page is ready.</span></div>';
  const validationSummary = validation
    ? `<section class="integration-ready-validation" data-state="${validation.ready ? 'ready' : 'failed'}"><div><strong>${validation.ready ? 'Page is ready' : 'Page is not ready'}</strong><span>${escapeHtml(validation.ready ? 'Every ready check passed after reloading the page.' : validation.message)}</span></div>${validationBadge(validation.urlReady, 'URL did not match')}</section>`
    : '<section class="integration-ready-validation"><div><strong>Not tested yet</strong><span>Reload the configured page to validate the URL and every landmark.</span></div></section>';
  return `<div class="modal-backdrop modal-backdrop-stacked" role="presentation"><form class="dialog integration-ready-checks-dialog" role="dialog" aria-modal="true" aria-label="Ready checks" data-form="integration-ready-checks"><input type="hidden" name="integrationId" value="${escapeAttr(integration.id)}"><input type="hidden" name="pageId" value="${escapeAttr(page.id)}"><div class="modal-header"><div><p class="eyebrow">${escapeHtml(page.name)}</p><h2>Ready checks</h2><p class="dialog-note">Use ready checks to avoid pulling incorrect data or attempting wrong commands.</p></div><button type="button" class="hvy-galaxy-button icon-button" data-action="cancel-integration-ready-checks" aria-label="Close">×</button></div><section class="integration-ready-url"><label><span>URL check</span><select class="hvy-galaxy-select" name="urlMode" data-action="integration-ready-url-mode" data-page-url="${escapeAttr(page.url)}"><option value="strict-url" ${draft.urlMode === 'strict-url' ? 'selected' : ''}>Strict URL</option><option value="strict-domain" ${draft.urlMode === 'strict-domain' ? 'selected' : ''}>Strict domain</option><option value="domain-regex" ${draft.urlMode === 'domain-regex' ? 'selected' : ''}>Domain regex</option></select></label><label><span>Expected URL or domain</span><input class="hvy-galaxy-input" name="urlValue" required value="${escapeAttr(draft.urlValue)}"></label><p class="field-help" data-ready-url-help>${escapeHtml(modeHelp)}</p></section><section><div class="integration-section-heading"><div><h3>Page landmarks</h3><p>Use page landmarks to ensure you're logged in, etc.</p></div><button type="button" class="hvy-galaxy-button" data-action="add-integration-ready-check" data-integration-id="${escapeAttr(integration.id)}" data-page-id="${escapeAttr(page.id)}">+ Select element</button></div><div class="integration-ready-check-list">${elements}</div></section>${validationSummary}<div class="dialog-actions"><button type="button" class="hvy-galaxy-button" data-action="cancel-integration-ready-checks">Cancel</button><button type="button" class="hvy-galaxy-button" data-action="test-integration-ready-checks" data-integration-id="${escapeAttr(integration.id)}" data-page-id="${escapeAttr(page.id)}">Reload page &amp; test</button><button type="submit" class="hvy-galaxy-button primary-button">Save ready checks</button></div></form></div>`;
}

export function renderAddIntegrationProfileDialog(state: AppState): string {
  if (!state.addIntegrationProfileDialogOpen) return '';
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === state.selectedIntegrationId);
  return `<div class="modal-backdrop" role="presentation"><form class="dialog" role="dialog" aria-modal="true" aria-label="Add integration profile" data-form="add-integration-profile"><h2>Add ${escapeHtml(integration?.name ?? 'integration')} profile</h2><label><span>Name</span><input class="hvy-galaxy-input" name="profileName" required autocomplete="off" placeholder="Work account"></label><p class="field-help">This profile has its own browser storage and can remain signed in alongside other profiles.</p><div class="dialog-actions"><button class="hvy-galaxy-button" type="button" data-action="cancel-add-integration-profile">Cancel</button><button class="hvy-galaxy-button" type="submit">Add profile</button></div></form></div>`;
}

export function renderIntegrationVaultResetDialog(state: AppState): string {
  if (!state.integrationVaultResetDialogOpen) return '';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="Reset integrations">
        <h2>Reset integrations?</h2>
        <p>This deletes the encrypted integration vault, its operating-system key, and browser data. You will need to sign in again.</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-reset-integration-vault">Cancel</button>
          <button type="button" class="hvy-galaxy-button danger-button" data-action="confirm-reset-integration-vault">Delete and reset</button>
        </div>
      </section>
    </div>`;
}
