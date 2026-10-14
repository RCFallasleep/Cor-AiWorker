/**
 * 模型配置表（静态定义）
 * 模型列表本身是固定的，但「是否可用」由本地 SQLite 中的 API Key 决定
 */

export interface ModelConfig {
  id: string;           // 内部 ID（选择器用）
  apiName: string;      // 实际调用 API 时的 model name
  label: string;        // 显示名称
  provider: string;     // openai | anthropic | deepseek | gemini | custom
  supportsVision: boolean;
}

export const ALL_MODELS: ModelConfig[] = [
  // Anthropic
  { id: "claude-sonnet-4-6",  apiName: "claude-sonnet-4-5",  label: "Claude Sonnet 4.6",  provider: "anthropic", supportsVision: true },
  { id: "claude-haiku-3-5",   apiName: "claude-haiku-3-5",   label: "Claude Haiku 3.5",   provider: "anthropic", supportsVision: true },
  { id: "claude-opus-4",      apiName: "claude-opus-4-5",    label: "Claude Opus 4",      provider: "anthropic", supportsVision: true },
  // OpenAI
  { id: "gpt-4o",             apiName: "gpt-4o",             label: "GPT-4o",             provider: "openai",    supportsVision: true },
  { id: "gpt-4o-mini",        apiName: "gpt-4o-mini",        label: "GPT-4o mini",        provider: "openai",    supportsVision: false },
  { id: "o3-mini",            apiName: "o3-mini",            label: "o3-mini",            provider: "openai",    supportsVision: false },
  // DeepSeek
  { id: "deepseek-v3",        apiName: "deepseek-chat",      label: "DeepSeek V3",        provider: "deepseek",  supportsVision: false },
  { id: "deepseek-r1",        apiName: "deepseek-reasoner",  label: "DeepSeek R1",        provider: "deepseek",  supportsVision: false },
  // Gemini
  { id: "gemini-2-flash",     apiName: "gemini-2.0-flash",   label: "Gemini 2.0 Flash",   provider: "gemini",    supportsVision: true },
  { id: "gemini-2-pro",       apiName: "gemini-2.0-pro",     label: "Gemini 2.0 Pro",     provider: "gemini",    supportsVision: true },
];

/** 根据 modelId 获取配置 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return ALL_MODELS.find((m) => m.id === modelId);
}

/** 根据 provider 获取该 provider 下所有模型 */
export function getModelsByProvider(provider: string): ModelConfig[] {
  return ALL_MODELS.filter((m) => m.provider === provider);
}
