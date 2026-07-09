export interface AiProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyPlaceholder: string;
  modelPlaceholder: string;
  docsUrl: string;
}

type AiProviderActionKey = 'chat' | 'edit' | 'importPlanning' | 'importWriting' | 'importCleanup' | 'semanticFilter' | 'compaction';
export type AiEmbeddingProviderMode = 'cloud' | 'local';

export interface AiEmbeddingModelPreset {
  id: string;
  label: string;
}

export interface AiEmbeddingProviderPreset {
  id: string;
  mode: AiEmbeddingProviderMode;
  modelPlaceholder: string;
  defaultModel: string;
  models: AiEmbeddingModelPreset[];
}

export const aiProviderPresets: AiProviderPreset[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyPlaceholder: 'optional',
    modelPlaceholder: 'llama3.2',
    docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKeyPlaceholder: 'optional',
    modelPlaceholder: 'local-model',
    docsUrl: 'https://lmstudio.ai/docs/developer/openai-compat',
  },
  {
    id: 'unsloth',
    name: 'Unsloth Studio',
    baseUrl: 'http://127.0.0.1:8888/v1',
    apiKeyPlaceholder: 'optional',
    modelPlaceholder: 'unsloth/GLM-4.7-Flash',
    docsUrl: 'https://unsloth.ai/docs/basics/codex',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    apiKeyPlaceholder: 'optional',
    modelPlaceholder: 'served model name',
    docsUrl: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyPlaceholder: 'sk-...',
    modelPlaceholder: 'gpt-5.4-mini',
    docsUrl: 'https://developers.openai.com/api/reference/overview',
  },
  {
    id: 'voyage',
    name: 'Voyage AI',
    baseUrl: 'https://api.voyageai.com/v1',
    apiKeyPlaceholder: 'pa-...',
    modelPlaceholder: 'voyage-4',
    docsUrl: 'https://docs.voyageai.com/docs/embeddings',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com',
    apiKeyPlaceholder: 'API key',
    modelPlaceholder: 'embed-v4.0',
    docsUrl: 'https://docs.cohere.com/v2/reference/embed',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyPlaceholder: 'API key',
    modelPlaceholder: 'gemini-embedding-001',
    docsUrl: 'https://ai.google.dev/api/embeddings',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyPlaceholder: 'sk-ant-...',
    modelPlaceholder: 'claude-sonnet-4-6',
    docsUrl: 'https://platform.claude.com/docs/en/api/openai-sdk',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyPlaceholder: 'sk-or-...',
    modelPlaceholder: 'openai/gpt-5.4-mini',
    docsUrl: 'https://openrouter.ai/docs/api-reference/overview',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyPlaceholder: 'gsk_...',
    modelPlaceholder: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/docs/overview',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyPlaceholder: 'API key',
    modelPlaceholder: 'mistral-small-latest',
    docsUrl: 'https://docs.mistral.ai/api',
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyPlaceholder: 'API key',
    modelPlaceholder: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    docsUrl: 'https://docs.together.ai/docs/inference/openai-compatibility',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    baseUrl: '',
    apiKeyPlaceholder: 'optional',
    modelPlaceholder: 'model name',
    docsUrl: 'https://developers.openai.com/api/reference/overview',
  },
];

export function aiProviderPreset(id: string): AiProviderPreset {
  return aiProviderPresets.find((preset) => preset.id === id) ?? aiProviderPresets[0];
}

export function aiProviderDefaultModel(id: string, action?: AiProviderActionKey): string {
  if (id === 'openai') {
    return action === 'chat' || action === 'semanticFilter' || action === 'compaction'
      ? 'gpt-5.4-nano'
      : 'gpt-5.4-mini';
  }
  return aiProviderPreset(id).modelPlaceholder;
}

export const aiEmbeddingProviderPresets: AiEmbeddingProviderPreset[] = [
  {
    id: 'openai',
    mode: 'cloud',
    modelPlaceholder: 'text-embedding-ada-002',
    defaultModel: 'text-embedding-ada-002',
    models: [
      { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002' },
      { id: 'text-embedding-3-small', label: 'text-embedding-3-small' },
      { id: 'text-embedding-3-large', label: 'text-embedding-3-large' },
    ],
  },
  {
    id: 'mistral',
    mode: 'cloud',
    modelPlaceholder: 'mistral-embed',
    defaultModel: 'mistral-embed',
    models: [
      { id: 'mistral-embed', label: 'mistral-embed' },
    ],
  },
  {
    id: 'voyage',
    mode: 'cloud',
    modelPlaceholder: 'voyage-4',
    defaultModel: 'voyage-4',
    models: [
      { id: 'voyage-4', label: 'voyage-4' },
      { id: 'voyage-4-large', label: 'voyage-4-large' },
      { id: 'voyage-4-lite', label: 'voyage-4-lite' },
      { id: 'voyage-code-3', label: 'voyage-code-3' },
      { id: 'voyage-law-2', label: 'voyage-law-2' },
      { id: 'voyage-finance-2', label: 'voyage-finance-2' },
    ],
  },
  {
    id: 'cohere',
    mode: 'cloud',
    modelPlaceholder: 'embed-v4.0',
    defaultModel: 'embed-v4.0',
    models: [
      { id: 'embed-v4.0', label: 'embed-v4.0' },
      { id: 'embed-english-v3.0', label: 'embed-english-v3.0' },
      { id: 'embed-multilingual-v3.0', label: 'embed-multilingual-v3.0' },
    ],
  },
  {
    id: 'gemini',
    mode: 'cloud',
    modelPlaceholder: 'gemini-embedding-001',
    defaultModel: 'gemini-embedding-001',
    models: [
      { id: 'gemini-embedding-001', label: 'gemini-embedding-001' },
    ],
  },
  {
    id: 'ollama',
    mode: 'local',
    modelPlaceholder: 'nomic-embed-text',
    defaultModel: 'nomic-embed-text',
    models: [
      { id: 'nomic-embed-text', label: 'nomic-embed-text' },
      { id: 'mxbai-embed-large', label: 'mxbai-embed-large' },
    ],
  },
  {
    id: 'lm-studio',
    mode: 'local',
    modelPlaceholder: 'local embedding model',
    defaultModel: 'local-model',
    models: [
      { id: 'local-model', label: 'local-model' },
    ],
  },
  {
    id: 'custom',
    mode: 'local',
    modelPlaceholder: 'model name',
    defaultModel: '',
    models: [],
  },
];

export function aiEmbeddingProviderPreset(id: string): AiEmbeddingProviderPreset {
  return aiEmbeddingProviderPresets.find((preset) => preset.id === id) ?? aiEmbeddingProviderPresets[0];
}

export function aiEmbeddingProvidersForMode(mode: AiEmbeddingProviderMode): AiEmbeddingProviderPreset[] {
  return aiEmbeddingProviderPresets.filter((preset) => preset.mode === mode);
}

export function aiEmbeddingDefaultModel(id: string): string {
  return aiEmbeddingProviderPreset(id).defaultModel;
}
