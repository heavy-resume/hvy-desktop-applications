import type { AiActionKey, AiProviderConfig, AiSettings, AppSettings } from './backend';
import { aiProviderPreset } from './aiProviders';
import { logDebugEvent } from './debugLog';

type HvyChatProvider = 'openai' | 'anthropic' | 'qwen';
type HvyRequestMode = 'qa' | 'component-edit' | 'document-edit' | 'pdf-template-import';

interface HvyProxyMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface HvyProxyRequest {
  provider: HvyChatProvider;
  model: string;
  messages: HvyProxyMessage[];
  context: string;
  mode: HvyRequestMode;
  traceRunId?: string;
}

interface HvyHostChatResponse {
  output: string;
}

interface ChatCompletionRequestBody {
  model: string;
  messages: HvyProxyMessage[];
  stream: boolean;
  chat_template_kwargs?: {
    enable_thinking?: boolean;
  };
}

interface SemanticResponseDebug {
  provider: string;
  model: string;
  ok: boolean;
  status: number;
  durationMs: number;
  traceRunId?: string;
  body?: ChatCompletionRequestBody;
  output?: string;
  payload?: unknown;
}

interface HvyHostChatClient {
  complete(request: HvyProxyRequest, options?: { signal?: AbortSignal; debugLabel?: string }): Promise<HvyHostChatResponse>;
  toolTurn(request: HvyProxyRequest, options?: { signal?: AbortSignal; debugLabel?: string }): Promise<HvyHostChatResponse>;
}

const recentSemanticResponses = new Map<string, SemanticResponseDebug>();
const RECENT_SEMANTIC_RESPONSE_LIMIT = 50;

export function getSemanticResponseDebug(traceRunId: string | undefined): SemanticResponseDebug | null {
  if (!traceRunId) return recentSemanticResponses.get('__latest__') ?? null;
  return recentSemanticResponses.get(traceRunId) ?? null;
}

export function installAiChatClient(settings: AiSettings, appSettings?: AppSettings): void {
  window.HVY_CHAT_CLIENT = createAiChatClient(settings, appSettings);
}

export function activeAiProvider(settings: AiSettings): AiProviderConfig {
  return aiProviderConfig(settings, settings.activeProviderId);
}

function createAiChatClient(settings: AiSettings, appSettings?: AppSettings): HvyHostChatClient | null {
  if (!settings.providers.some((provider) => provider.baseUrl.trim())) {
    return null;
  }
  const complete = (request: HvyProxyRequest, options?: { signal?: AbortSignal; debugLabel?: string }) =>
    requestOpenAiCompatibleCompletion(settings, appSettings, request, taskForRequest(request, options?.debugLabel), options?.signal);
  return { complete, toolTurn: complete };
}

async function requestOpenAiCompatibleCompletion(
  settings: AiSettings,
  appSettings: AppSettings | undefined,
  request: HvyProxyRequest,
  task: AiActionKey,
  signal?: AbortSignal
): Promise<HvyHostChatResponse> {
  const action = settings.actions[task] ?? settings.actions.chat;
  const providerId = resolveProviderId(settings, action.providerId);
  const provider = aiProviderConfig(settings, providerId);
  if (!provider?.baseUrl.trim()) {
    throw new Error(`Choose an AI provider for ${taskLabel(task)}.`);
  }
  const model = action.model.trim() || settings.actions.chat.model.trim() || request.model.trim();
  if (!model) {
    throw new Error(`Choose an AI model for ${taskLabel(task)}.`);
  }
  const stream = provider.provider === 'unsloth';
  let body = buildChatCompletionBody(model, request, task, provider.provider, stream);
  logDebugEvent('llm', 'llm:request', {
    task,
    mode: request.mode,
    provider: provider.provider,
    model,
    stream,
    traceRunId: request.traceRunId,
    contextChars: request.context.length,
    messageCount: body.messages.length,
    messageChars: body.messages.reduce((total, message) => total + message.content.length, 0),
  });
  const startedAt = performance.now();
  let response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  const durationMs = () => Math.round((performance.now() - startedAt) * 10) / 10;
  if (stream) {
    if (!response.ok) {
      logLlmResponse(task, appSettings, provider.provider, model, response, durationMs(), request.traceRunId, body);
    }
    const result = await readStreamingChatCompletionResponse(response);
    logLlmResponse(task, appSettings, provider.provider, model, response, durationMs(), request.traceRunId, body, result.output);
    return result;
  }
  let payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    logLlmResponse(task, appSettings, provider.provider, model, response, durationMs(), request.traceRunId, body, undefined, payload);
    throw new Error(formatProviderHttpError(response.status, payload));
  }
  let output = String(payload?.choices?.[0]?.message?.content ?? '').trim();
  if (!output) {
    logLlmResponse(task, appSettings, provider.provider, model, response, durationMs(), request.traceRunId, body);
    throw new Error('AI provider returned no assistant text.');
  }
  if (shouldRetryBareEmptySemanticOutput(task, output)) {
    logDebugEvent('llm', 'llm:semantic-filter-retry', {
      task,
      provider: provider.provider,
      model,
      traceRunId: request.traceRunId,
      reason: 'bare-empty-array',
      initialOutput: output,
    });
    body = buildSemanticFilterRetryBody(body, output);
    response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
    payload = await response.json().catch(() => null) as any;
    if (!response.ok) {
      logLlmResponse(task, appSettings, provider.provider, model, response, durationMs(), request.traceRunId, body, undefined, payload);
      throw new Error(formatProviderHttpError(response.status, payload));
    }
    output = String(payload?.choices?.[0]?.message?.content ?? '').trim();
    if (!output) {
      logLlmResponse(task, appSettings, provider.provider, model, response, durationMs(), request.traceRunId, body);
      throw new Error('AI provider returned no assistant text.');
    }
  }
  logLlmResponse(task, appSettings, provider.provider, model, response, durationMs(), request.traceRunId, body, output);
  return { output };
}

function logLlmResponse(
  task: AiActionKey,
  appSettings: AppSettings | undefined,
  provider: string,
  model: string,
  response: Response,
  durationMs: number,
  traceRunId: string | undefined,
  body: ChatCompletionRequestBody,
  output?: string,
  payload?: unknown,
): void {
  const includeSemanticDebug = shouldDebugSemanticSearch(task, appSettings);
  logDebugEvent('llm', 'llm:response', {
    task,
    provider,
    model,
    ok: response.ok,
    status: response.status,
    durationMs,
    ...(traceRunId ? { traceRunId } : {}),
    ...(includeSemanticDebug ? { body } : {}),
    ...(includeSemanticDebug && typeof output === 'string' ? { outputChars: output.length, output } : {}),
    ...(includeSemanticDebug && payload !== undefined ? { payload } : {}),
  });
  if (task === 'semanticFilter') {
    rememberSemanticResponse({
      provider,
      model,
      ok: response.ok,
      status: response.status,
      durationMs,
      ...(traceRunId ? { traceRunId } : {}),
      ...(includeSemanticDebug ? { body } : {}),
      ...(typeof output === 'string' ? { output } : {}),
      ...(payload !== undefined ? { payload } : {}),
    });
  }
}

function rememberSemanticResponse(entry: SemanticResponseDebug): void {
  const key = entry.traceRunId ?? '__latest__';
  recentSemanticResponses.delete(key);
  recentSemanticResponses.set(key, entry);
  recentSemanticResponses.delete('__latest__');
  recentSemanticResponses.set('__latest__', entry);
  while (recentSemanticResponses.size > RECENT_SEMANTIC_RESPONSE_LIMIT) {
    const oldest = recentSemanticResponses.keys().next().value;
    if (typeof oldest !== 'string') break;
    recentSemanticResponses.delete(oldest);
  }
}

function shouldDebugSemanticSearch(task: AiActionKey, appSettings: AppSettings | undefined): boolean {
  return task === 'semanticFilter' && appSettings?.debugSemanticSearch === true;
}

function shouldRetryBareEmptySemanticOutput(task: AiActionKey, output: string): boolean {
  return task === 'semanticFilter' && output.trim() === '[]';
}

function buildSemanticFilterRetryBody(body: ChatCompletionRequestBody, output: string): ChatCompletionRequestBody {
  return {
    ...body,
    messages: [
      ...body.messages,
      {
        role: 'assistant',
        content: output,
      },
      {
        role: 'user',
        content: [
          'The previous semantic filter response was only an empty final JSON array.',
          'That does not show the required first-pass candidate evaluation.',
          'Re-read the candidate list and do the first pass before the final JSON array.',
          'If there are truly no matches, write a brief first-pass note saying no candidate obviously satisfies the prompt, then end with [].',
        ].join(' '),
      },
    ],
  };
}

function buildChatCompletionBody(
  model: string,
  request: HvyProxyRequest,
  task: AiActionKey,
  providerId: string,
  stream: boolean,
): ChatCompletionRequestBody {
  const disableThinking = providerId === 'unsloth' && (task === 'chat' || task === 'semanticFilter');
  return {
    model,
    messages: buildMessages(request, disableThinking),
    stream,
    ...(disableThinking
      ? { chat_template_kwargs: { enable_thinking: false } }
      : {}),
  };
}

async function readStreamingChatCompletionResponse(response: Response): Promise<HvyHostChatResponse> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as any;
    throw new Error(formatProviderHttpError(response.status, payload));
  }
  if (!response.body) {
    throw new Error('AI provider returned no assistant text.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      output += readStreamingChatCompletionLine(line);
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    output += readStreamingChatCompletionLine(line);
  }
  output = output.trim();
  if (!output) {
    throw new Error('AI provider returned no assistant text.');
  }
  return { output };
}

function readStreamingChatCompletionLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const data = trimmed.slice('data:'.length).trim();
  if (!data || data === '[DONE]') return '';
  try {
    const payload = JSON.parse(data) as any;
    return String(payload?.choices?.[0]?.delta?.content ?? payload?.choices?.[0]?.message?.content ?? '');
  } catch {
    return '';
  }
}

function aiProviderConfig(settings: AiSettings, providerId: string): AiProviderConfig {
  const provider = settings.providers.find((candidate) => candidate.provider === providerId)
    ?? settings.providers.find((candidate) => candidate.provider === settings.activeProviderId);
  if (provider) return provider;
  const preset = aiProviderPreset(providerId || settings.activeProviderId);
  return {
    provider: preset.id,
    baseUrl: preset.baseUrl,
    apiKey: '',
  };
}

function resolveProviderId(settings: AiSettings, providerId: string): string {
  return providerId && providerId !== 'default' ? providerId : settings.activeProviderId;
}

function buildMessages(request: HvyProxyRequest, disableThinking = false): HvyProxyMessage[] {
  const messages = [...request.messages];
  if (disableThinking) {
    let lastUserMessageIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        lastUserMessageIndex = index;
        break;
      }
    }
    if (lastUserMessageIndex >= 0) {
      messages[lastUserMessageIndex] = {
        ...messages[lastUserMessageIndex],
        content: `/no_think\n\n${messages[lastUserMessageIndex].content}`,
      };
    } else {
      messages.push({
        role: 'user',
        content: '/no_think',
      });
    }
  }
  if (request.context.trim()) {
    messages.push({
      role: 'user',
      content: `Context:\n${request.context}`,
    });
  }
  return messages;
}

function taskForRequest(request: HvyProxyRequest, debugLabel = ''): AiActionKey {
  const label = debugLabel.toLowerCase();
  if (label.includes('compaction')) return 'compaction';
  if (label.includes('description-generation')) return 'semanticFilter';
  if (label.includes('semantic-filter')) return 'semanticFilter';
  if (label.includes('ai-import-plan') || label.includes('preplan') || label.includes('missing-sections')) return 'importPlanning';
  if (label.includes('dedupe') || label.includes('fill-ins') || label.includes('xref') || label.includes('repair')) return 'importCleanup';
  if (label.includes('ai-import')) return 'importWriting';
  if (request.mode === 'document-edit' || request.mode === 'component-edit') return 'edit';
  return 'chat';
}

function taskLabel(task: AiActionKey): string {
  return task.replace(/[A-Z]/g, (match: string) => ` ${match.toLowerCase()}`);
}

function readProviderError(payload: any): string {
  return String(payload?.error?.message ?? payload?.message ?? '').trim();
}

function formatProviderHttpError(status: number, payload: any): string {
  const providerMessage = readProviderError(payload);
  const message = providerMessage || `AI request failed with HTTP ${status}.`;
  if (status === 401) {
    return `${message} Check the API key for the selected AI provider.`;
  }
  return message;
}
