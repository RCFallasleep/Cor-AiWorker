/**
 * Provider 配置（唯一数据源）
 * API Key 管理页 和 模型选择器 共用同一份配置，确保名称一致
 */

export interface ProviderConfig {
  id: string;
  label: string;           // 显示名称（两处保持一致）
  keyPlaceholder: string;  // API Key 输入框占位符
}

export const PROVIDERS: ProviderConfig[] = [
  { id: "anthropic", label: "Anthropic",     keyPlaceholder: "sk-ant-..." },
  { id: "openai",    label: "OpenAI",        keyPlaceholder: "sk-..." },
  { id: "deepseek",  label: "DeepSeek",      keyPlaceholder: "sk-..." },
  { id: "gemini",    label: "Google Gemini", keyPlaceholder: "AIza..." },
  { id: "custom",    label: "Custom",        keyPlaceholder: "your-api-key" },
];

export function getProviderLabel(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}
