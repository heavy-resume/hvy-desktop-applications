import { saveDocumentAsDialog, type Workspace } from './backend';
import { createWorkspaceEmbeddingChunkResults, type WorkspaceEmbeddingChunkResult } from './embeddingIndex';
import { defaultBlockSchema } from '../../heavy-file-format/src/document-factory';
import { requestProxyCompletion } from '../../heavy-file-format/src/chat/chat';
import { serializeHvy, type VisualDocument } from './hvy';
import { state } from './state';
import type { ChatMessage } from '../../heavy-file-format/src/types';

let currentAbortController: AbortController | null = null;
const WORKSPACE_CHAT_DOCUMENT_PREFIX = 'workspace-chat:';
const WORKSPACE_CHAT_RESPONSE_INSTRUCTIONS = [
  'Answer in readable Markdown for a chat transcript.',
  'Use concise headings, bullets, and emphasis when useful.',
  'Do not include HVY serialization comments, component markers, XML/HTML comments, or code fences unless the user explicitly asks for code.',
  'When naming source files, use the provided Markdown source links. Do not print raw filesystem paths.',
  'Use the provided indexed document excerpts as evidence. If the excerpts do not support a confident answer, say what is missing.',
].join('\n');

export function openWorkspaceChat(workspacePath: string, targetDirectory = ''): void {
  const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
  state.openWorkspaceActionsPath = null;
  state.workspaceChat.open = true;
  state.workspaceChat.workspacePath = workspacePath;
  state.workspaceChat.targetDirectory = normalizeFolderScope(targetDirectory);
  state.workspaceChat.scopeLabel = workspaceChatScopeLabel(workspace, targetDirectory);
  state.workspaceChat.status = null;
  state.workspaceChat.error = null;
  state.workspaceChat.dirty = false;
  state.workspaceChat.closePromptOpen = false;
  state.workspaceChat.progress = null;
  state.workspaceChat.messages = [];
  state.workspaceChat.draft = '';
  state.workspaceChat.isSending = false;
}

export function workspaceChatDocumentPath(workspacePath: string, targetDirectory = ''): string {
  return `${WORKSPACE_CHAT_DOCUMENT_PREFIX}${encodeURIComponent(workspacePath)}:${encodeURIComponent(normalizeFolderScope(targetDirectory))}`;
}

export function isWorkspaceChatDocumentPath(path: string): boolean {
  return path.startsWith(WORKSPACE_CHAT_DOCUMENT_PREFIX);
}

export function currentWorkspaceChatDocumentPath(): string | null {
  const workspacePath = state.workspaceChat.workspacePath;
  return workspacePath ? workspaceChatDocumentPath(workspacePath, state.workspaceChat.targetDirectory) : null;
}

export function currentWorkspaceChatDocumentName(): string {
  return `Chat - ${state.workspaceChat.scopeLabel || 'Workspace'}`;
}

export function updateWorkspaceChatDraft(value: string): void {
  state.workspaceChat.draft = value;
}

export async function submitWorkspaceChat(onUpdate?: () => void): Promise<void> {
  if (state.workspaceChat.isSending) {
    currentAbortController?.abort();
    state.workspaceChat.status = 'Stopping chat...';
    return;
  }
  const question = state.workspaceChat.draft.trim();
  if (!question) return;
  const workspacePath = state.workspaceChat.workspacePath;
  const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
  if (!workspacePath || !workspace) {
    state.workspaceChat.error = 'Open a workspace before using workspace chat.';
    return;
  }
  if (!state.aiSettings.embeddings.enabled) {
    state.workspaceChat.error = 'Enable embeddings before using workspace chat.';
    return;
  }
  const abortController = new AbortController();
  currentAbortController = abortController;
  state.workspaceChat.isSending = true;
  state.workspaceChat.dirty = true;
  syncOpenWorkspaceChatDocument();
  state.workspaceChat.error = null;
  state.workspaceChat.status = null;
  state.workspaceChat.draft = '';
  const userMessage = chatMessage('user', question);
  state.workspaceChat.messages = [...state.workspaceChat.messages, userMessage];
  onUpdate?.();
  try {
    const results = await createWorkspaceEmbeddingChunkResults(workspace, {
      query: question,
      targetDirectory: state.workspaceChat.targetDirectory,
      signal: abortController.signal,
    }, state.aiSettings, {
      maxResults: 18,
      onProgress: (progress) => {
        state.workspaceChat.progress = progress;
        state.workspaceChat.status = progress.rebuiltChunks > 0
          ? `Rebuilding embeddings (${progress.rebuiltChunks} rebuilt, ${progress.reusedChunks} reused)`
          : null;
        onUpdate?.();
      },
    });
    state.workspaceChat.status = null;
    onUpdate?.();
    const context = buildWorkspaceChatContext(results, state.aiSettings.maxContextChars);
    const completionParams = {
      settings: {
        provider: 'openai',
        model: state.aiSettings.actions.chat.model,
        maxContextChars: state.aiSettings.maxContextChars,
      },
      messages: toHvyChatMessages(state.workspaceChat.messages),
      context,
      responseInstructions: WORKSPACE_CHAT_RESPONSE_INSTRUCTIONS,
      mode: 'qa',
      debugLabel: 'workspace-chat',
      maxContextChars: state.aiSettings.maxContextChars,
      client: window.HVY_CHAT_CLIENT ?? null,
      signal: abortController.signal,
    } as const;
    const draftOutput = await requestProxyCompletion(completionParams);
    const sourceLinks = workspaceChatSourceLinks(results);
    const invalidLinks = invalidWorkspaceCitationTargets(draftOutput, sourceLinks.map((source) => source.target));
    let output = draftOutput;
    if (invalidLinks.length > 0) {
      state.workspaceChat.status = 'Correcting source links...';
      onUpdate?.();
      output = await requestProxyCompletion({
        ...completionParams,
        messages: [
          ...completionParams.messages,
          { id: crypto.randomUUID(), role: 'assistant', content: draftOutput },
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: buildWorkspaceCitationRepairPrompt(invalidLinks, sourceLinks.map((source) => source.link)),
          },
        ],
        debugLabel: 'workspace-chat-link-repair',
      });
      const remainingInvalidLinks = invalidWorkspaceCitationTargets(output, sourceLinks.map((source) => source.target));
      if (remainingInvalidLinks.length > 0) {
        output = removeInvalidWorkspaceCitations(output, remainingInvalidLinks);
      }
    }
    state.workspaceChat.messages = [...state.workspaceChat.messages, chatMessage('assistant', output)];
    state.workspaceChat.status = null;
    onUpdate?.();
  } catch (error) {
    if (isAbortError(error)) {
      state.workspaceChat.status = 'Chat stopped';
    } else {
      state.workspaceChat.error = error instanceof Error ? error.message : String(error);
      state.workspaceChat.status = null;
      state.workspaceChat.messages = [...state.workspaceChat.messages, chatMessage('assistant', state.workspaceChat.error, true)];
    }
    onUpdate?.();
  } finally {
    if (currentAbortController === abortController) {
      currentAbortController = null;
    }
    state.workspaceChat.isSending = false;
    onUpdate?.();
  }
}

export function requestCloseWorkspaceChat(): boolean {
  if (!state.workspaceChat.open) return false;
  if (state.workspaceChat.dirty && state.workspaceChat.messages.length > 0) {
    state.workspaceChat.closePromptOpen = true;
    return false;
  }
  closeWorkspaceChatNow();
  return true;
}

export function cancelCloseWorkspaceChat(): void {
  state.workspaceChat.closePromptOpen = false;
}

export function discardWorkspaceChat(): void {
  closeWorkspaceChatNow();
}

export function cancelWorkspaceChatIndexing(): void {
  currentAbortController?.abort();
  state.workspaceChat.status = state.workspaceChat.isSending ? 'Stopping chat...' : 'Stopping indexing...';
}

export async function saveWorkspaceChat(): Promise<void> {
  if (state.workspaceChat.messages.length === 0) {
    state.workspaceChat.error = 'Ask at least one question before saving this chat.';
    return;
  }
  const document = createWorkspaceChatDocument();
  const bytes = await serializeHvy(document);
  const file = await saveDocumentAsDialog({
    suggestedName: `${safeFileName(`Chat - ${state.workspaceChat.scopeLabel || 'Workspace'} - ${new Date().toISOString().slice(0, 10)}`)}.hvy`,
    bytes,
  });
  if (!file) return;
  state.status = `Saved ${file.name}`;
  closeWorkspaceChatNow();
}

export function closeWorkspaceChatNow(): void {
  currentAbortController?.abort();
  state.workspaceChat.open = false;
  state.workspaceChat.workspacePath = null;
  state.workspaceChat.targetDirectory = '';
  state.workspaceChat.scopeLabel = '';
  state.workspaceChat.status = null;
  state.workspaceChat.error = null;
  state.workspaceChat.dirty = false;
  state.workspaceChat.closePromptOpen = false;
  state.workspaceChat.progress = null;
  state.workspaceChat.messages = [];
  state.workspaceChat.draft = '';
  state.workspaceChat.isSending = false;
  syncOpenWorkspaceChatDocument();
}

function syncOpenWorkspaceChatDocument(): void {
  if (state.document?.virtual !== 'workspaceChat') return;
  state.document.dirty = state.workspaceChat.dirty;
  state.document.name = currentWorkspaceChatDocumentName();
}

export function buildWorkspaceChatContext(results: WorkspaceEmbeddingChunkResult[], maxContextChars: number): string {
  const sourceLinks = uniqueSourceLinks(results);
  const parts: string[] = sourceLinks.length > 0
    ? [
      [
        'Source links available for citation:',
        ...sourceLinks.map((source) => `- ${source.link}`),
        '',
        'Use those Markdown links when referring to files.',
      ].join('\n'),
    ]
    : [];
  let used = parts.reduce((total, part) => total + part.length, 0);
  for (const [index, result] of results.entries()) {
    const sourceLink = markdownWorkspaceLink(result.documentTitle, workspaceLinkTarget(result));
    const chunk = [
      `Source ${index + 1}: ${sourceLink}`,
      result.contextLabel ? `Location: ${result.contextLabel}` : '',
      `Score: ${result.score.toFixed(3)}`,
      '',
      stripHvySerializationComments(result.text),
    ].filter(Boolean).join('\n');
    if (used + chunk.length > maxContextChars && parts.length > 0) break;
    parts.push(chunk);
    used += chunk.length;
    if (used >= maxContextChars) break;
  }
  return parts.join('\n\n---\n\n');
}

function uniqueSourceLinks(results: WorkspaceEmbeddingChunkResult[]): Array<{ path: string; link: string }> {
  const seen = new Set<string>();
  const sources: Array<{ path: string; link: string }> = [];
  for (const result of results) {
    const path = workspaceDocumentTarget(result.documentPath);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    sources.push({
      path,
      link: markdownWorkspaceLink(result.documentTitle, path),
    });
  }
  return sources;
}

function workspaceChatSourceLinks(results: WorkspaceEmbeddingChunkResult[]): Array<{ target: string; link: string }> {
  const links = new Map<string, string>();
  for (const result of results) {
    const documentTarget = workspaceDocumentTarget(result.documentPath);
    const chunkTarget = workspaceLinkTarget(result);
    links.set(documentTarget, markdownWorkspaceLink(result.documentTitle, documentTarget));
    links.set(chunkTarget, markdownWorkspaceLink(result.documentTitle, chunkTarget));
  }
  return [...links].map(([target, link]) => ({
    target: encodeMarkdownLinkTarget(target),
    link,
  }));
}

export function invalidWorkspaceCitationTargets(output: string, allowedTargets: string[]): string[] {
  const allowed = new Set(allowedTargets);
  const invalid = new Set<string>();
  for (const match of output.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].trim();
    if (target.startsWith('/') && !allowed.has(target)) {
      invalid.add(target);
    }
  }
  return [...invalid];
}

export function removeInvalidWorkspaceCitations(output: string, invalidTargets: string[]): string {
  const invalid = new Set(invalidTargets);
  return output.replace(/\[([^\]\n]*)\]\(([^)\n]+)\)/g, (markdownLink, label: string, rawTarget: string) => (
    invalid.has(rawTarget.trim()) ? label : markdownLink
  ));
}

export function buildWorkspaceCitationRepairPrompt(invalidTargets: string[], sourceLinks: string[]): string {
  return [
    'Your draft contains workspace citation links that were not among the source links provided to you.',
    '',
    'Invalid link targets:',
    ...invalidTargets.map((target) => `- ${target}`),
    '',
    'The source links you may choose from are:',
    ...sourceLinks.map((link) => `- ${link}`),
    '',
    'Return the complete corrected answer. Preserve the answer content, but replace each invalid workspace citation with the appropriate source link above. Copy link targets exactly. Do not mention this correction.',
  ].join('\n');
}

function markdownWorkspaceLink(label: string, target: string): string {
  return `[${escapeMarkdownLinkLabel(label || target)}](${encodeMarkdownLinkTarget(target)})`;
}

function workspaceLinkTarget(result: WorkspaceEmbeddingChunkResult): string {
  const documentTarget = workspaceDocumentTarget(result.documentPath);
  const fragment = workspaceTargetFragment(result);
  return `${documentTarget}${fragment}`;
}

function workspaceDocumentTarget(documentPath: string): string {
  const workspacePath = state.workspaceChat.workspacePath ?? state.selectedWorkspacePath ?? '';
  const normalizedDocumentPath = normalizePath(documentPath);
  const normalizedWorkspacePath = normalizePath(workspacePath);
  if (normalizedWorkspacePath && normalizedDocumentPath === normalizedWorkspacePath) {
    return '/';
  }
  if (normalizedWorkspacePath && normalizedDocumentPath.startsWith(`${normalizedWorkspacePath}/`)) {
    return `/${normalizedDocumentPath.slice(normalizedWorkspacePath.length + 1)}`;
  }
  if (documentPath.startsWith('/')) {
    return documentPath;
  }
  return `/${documentPath.replace(/^\/+/, '')}`;
}

function workspaceTargetFragment(result: WorkspaceEmbeddingChunkResult): string {
  const target = normalizeFragmentTarget(result.targetRef ?? result.targetId);
  return target ? `#${encodeURIComponent(target)}` : '';
}

function normalizeFragmentTarget(value: string | undefined): string {
  const target = value?.trim() ?? '';
  if (!target || target.startsWith('/')) return '';
  return target.startsWith('#') ? target.slice(1).trim() : target;
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, '\\$1');
}

function encodeMarkdownLinkTarget(value: string): string {
  return value.replace(/\\/g, '/').split('#').map((part, index) => (
    index === 0
      ? encodeURI(part).replace(/[()]/g, encodeURIComponent)
      : encodeURIComponent(part)
  )).join('#');
}

function stripHvySerializationComments(value: string): string {
  return value
    .replace(/<!--\/?hvy:[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createWorkspaceChatDocument(): VisualDocument {
  const title = `Chat - ${state.workspaceChat.scopeLabel || 'Workspace'}`;
  return {
    meta: {
      hvy_version: '0.1',
      title,
      reader_max_width: '64rem',
      component_defaults: { text: { css: 'margin: 0.5rem 0;' } },
      workspace_chat: {
        workspacePath: state.workspaceChat.workspacePath,
        targetDirectory: state.workspaceChat.targetDirectory,
        savedAt: new Date().toISOString(),
      },
    },
    extension: '.hvy',
    attachments: [],
    sections: [
      section('chat-session', title, [
        textBlock(`Scope: ${state.workspaceChat.scopeLabel || 'Workspace'}\n\nSaved: ${new Date().toLocaleString()}`),
        ...state.workspaceChat.messages.map((entry) => textBlock(`**${entry.role === 'user' ? 'You' : 'Assistant'}**\n\n${entry.content}`)),
      ]),
    ],
  };
}

function chatMessage(role: 'user' | 'assistant', content: string, error = false) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    error,
  };
}

function toHvyChatMessages(messages: typeof state.workspaceChat.messages): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.error ? { error: true } : {}),
  }));
}

function section(key: string, title: string, blocks: VisualDocument['sections'][number]['blocks']): VisualDocument['sections'][number] {
  return {
    key,
    customId: key,
    contained: true,
    editorOnly: false,
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title,
    level: 1,
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks,
    children: [],
  };
}

function textBlock(text: string): VisualDocument['sections'][number]['blocks'][number] {
  return {
    id: crypto.randomUUID(),
    text,
    schema: defaultBlockSchema('text'),
    schemaMode: false,
  };
}

function workspaceChatScopeLabel(workspace: Workspace | undefined, targetDirectory: string): string {
  const folder = normalizeFolderScope(targetDirectory);
  if (folder) return folder.split('/').filter(Boolean).at(-1) ?? folder;
  return workspace?.manifest.name || workspace?.path.split(/[\\/]/).filter(Boolean).at(-1) || 'Workspace';
}

export function resolveWorkspaceHref(href: string): string {
  const trimmed = decodeWorkspaceHref(href.trim());
  if (!trimmed) return '';
  const [targetPath] = trimmed.split('#', 1);
  const workspace = state.workspaces.find((candidate) => candidate.path === state.workspaceChat.workspacePath)
    ?? state.workspaces.find((candidate) => candidate.path === state.selectedWorkspacePath);
  if (targetPath?.startsWith('/')) {
    const workspacePath = workspace?.path ?? state.workspaceChat.workspacePath ?? state.selectedWorkspacePath ?? '';
    const workspaceRelativeTarget = targetPath.slice(1);
    const matchedPath = workspace ? findWorkspaceFilePath(workspace, workspaceRelativeTarget) : '';
    if (matchedPath) return matchedPath;
    const withoutWorkspaceName = stripWorkspaceNamePrefix(workspace, workspaceRelativeTarget);
    const matchedWithoutWorkspaceName = workspace && withoutWorkspaceName !== workspaceRelativeTarget
      ? findWorkspaceFilePath(workspace, withoutWorkspaceName)
      : '';
    if (matchedWithoutWorkspaceName) return matchedWithoutWorkspaceName;
    return workspacePath ? normalizePath(`${workspacePath}/${withoutWorkspaceName}`) : normalizePath(targetPath);
  }
  const currentPath = state.document?.virtual === 'workspaceChat' ? '' : state.document?.path ?? '';
  const basePath = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : workspace?.path ?? state.selectedWorkspacePath ?? '';
  return normalizePath(`${basePath}/${targetPath ?? trimmed}`);
}

function findWorkspaceFilePath(workspace: Workspace, workspaceRelativeTarget: string): string {
  const normalizedTarget = normalizePath(workspaceRelativeTarget).replace(/^\/+/, '');
  for (const file of flattenWorkspaceFiles(workspace.files)) {
    const relativePath = normalizePath(file.relativePath ?? file.path).replace(/^\/+/, '');
    const pathRelativeToWorkspace = normalizePath(file.path).startsWith(`${normalizePath(workspace.path)}/`)
      ? normalizePath(file.path).slice(normalizePath(workspace.path).length + 1)
      : relativePath;
    if (relativePath === normalizedTarget || pathRelativeToWorkspace === normalizedTarget) {
      return file.path;
    }
  }
  return '';
}

function stripWorkspaceNamePrefix(workspace: Workspace | undefined, workspaceRelativeTarget: string): string {
  if (!workspace) return workspaceRelativeTarget;
  const normalizedTarget = normalizePath(workspaceRelativeTarget).replace(/^\/+/, '');
  const candidates = [
    workspace.manifest.name,
    workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizePath(candidate).replace(/^\/+|\/+$/g, '');
    if (normalizedCandidate && normalizedTarget === normalizedCandidate) return '';
    if (normalizedCandidate && normalizedTarget.startsWith(`${normalizedCandidate}/`)) {
      return normalizedTarget.slice(normalizedCandidate.length + 1);
    }
  }
  return workspaceRelativeTarget;
}

function flattenWorkspaceFiles(nodes: Workspace['files']): Array<Workspace['files'][number] & { kind: 'file' }> {
  const files: Array<Workspace['files'][number] & { kind: 'file' }> = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      files.push(node);
    } else {
      files.push(...flattenWorkspaceFiles(node.children));
    }
  }
  return files;
}

function decodeWorkspaceHref(href: string): string {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return path.startsWith('/') ? `/${parts.join('/')}` : parts.join('/');
}

function normalizeFolderScope(value: string | null | undefined): string {
  return (value ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'Workspace Chat';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
