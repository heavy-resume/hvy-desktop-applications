import type { AiConnectionPreset, AiSettings, AiTaskModels } from './backend';

type HvyChatProvider = 'openai' | 'anthropic' | 'qwen';
type HvyRequestMode = 'qa' | 'component-edit' | 'document-edit';

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
}

interface HvyHostChatResponse {
  output: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

interface HvyHostChatClient {
  complete(request: HvyProxyRequest, options?: { signal?: AbortSignal; debugLabel?: string }): Promise<HvyHostChatResponse>;
  toolTurn(request: HvyProxyRequest, options?: { signal?: AbortSignal; debugLabel?: string }): Promise<HvyHostChatResponse>;
}

type AiTaskKey = keyof AiTaskModels;

export function installAiChatClient(settings: AiSettings): void {
  window.HVY_CHAT_CLIENT = createAiChatClient(settings);
}

export function activeAiPreset(settings: AiSettings): AiConnectionPreset {
  return settings.presets.find((preset) => preset.id === settings.activePresetId) ?? settings.presets[0];
}

function createAiChatClient(settings: AiSettings): HvyHostChatClient | null {
  const preset = activeAiPreset(settings);
  if (!preset?.baseUrl.trim()) {
    return null;
  }
  const complete = (request: HvyProxyRequest, options?: { signal?: AbortSignal; debugLabel?: string }) =>
    requestOpenAiCompatibleCompletion(preset, request, taskForRequest(request, options?.debugLabel), options?.signal);
  return { complete, toolTurn: complete };
}

async function requestOpenAiCompatibleCompletion(
  preset: AiConnectionPreset,
  request: HvyProxyRequest,
  task: AiTaskKey,
  signal?: AbortSignal
): Promise<HvyHostChatResponse> {
  const model = preset.models[task].trim() || preset.models.chat.trim() || request.model.trim();
  if (!model) {
    throw new Error(`Choose an AI model for ${taskLabel(task)}.`);
  }
  const response = await fetch(`${preset.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(preset.apiKey.trim() ? { Authorization: `Bearer ${preset.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(request),
      stream: false,
    }),
    signal,
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    throw new Error(readProviderError(payload) || `AI request failed with HTTP ${response.status}.`);
  }
  const output = String(payload?.choices?.[0]?.message?.content ?? '').trim();
  if (!output) {
    throw new Error('AI provider returned no assistant text.');
  }
  return {
    output,
    usage: {
      inputTokens: numberOrUndefined(payload?.usage?.prompt_tokens),
      outputTokens: numberOrUndefined(payload?.usage?.completion_tokens),
      totalTokens: numberOrUndefined(payload?.usage?.total_tokens),
    },
  };
}

function buildMessages(request: HvyProxyRequest): HvyProxyMessage[] {
  const messages = [...request.messages];
  if (request.context.trim()) {
    messages.push({
      role: 'user',
      content: `Context:\n${request.context}`,
    });
  }
  return messages;
}

function taskForRequest(request: HvyProxyRequest, debugLabel = ''): AiTaskKey {
  const label = debugLabel.toLowerCase();
  if (label.includes('compaction')) return 'compaction';
  if (label.includes('ai-import-plan') || label.includes('preplan') || label.includes('missing-sections')) return 'importPlanning';
  if (label.includes('dedupe') || label.includes('fill-ins') || label.includes('xref') || label.includes('repair')) return 'importCleanup';
  if (label.includes('ai-import')) return 'importWriting';
  if (request.mode === 'document-edit' || request.mode === 'component-edit') return 'edit';
  return 'chat';
}

function taskLabel(task: AiTaskKey): string {
  return task.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
}

function readProviderError(payload: any): string {
  return String(payload?.error?.message ?? payload?.message ?? '').trim();
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
