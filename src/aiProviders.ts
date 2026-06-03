export interface AiProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyPlaceholder: string;
  modelPlaceholder: string;
  docsUrl: string;
}

type AiProviderActionKey = 'chat' | 'edit' | 'importPlanning' | 'importWriting' | 'importCleanup' | 'semanticFilter' | 'compaction';

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
