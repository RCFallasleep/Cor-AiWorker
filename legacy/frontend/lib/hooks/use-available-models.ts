"use client";

/**
 * useAvailableModels
 * 从本地 SQLite 读取激活的 API Key，
 * 每条激活的 Key 就是一个可用模型（用 modelName 或 label 作为显示名）
 */

import { useState, useEffect, useCallback } from "react";
import { apiKeyRepo, type ApiKeyRecord } from "@/lib/repositories/api-key-repository";

export interface AvailableModel {
  // 用 Key 的 id 作为模型选择器的唯一 id
  id: string;
  // 显示名：优先用 modelName，没有则用 label
  label: string;
  // 实际调用 API 时的 model name：优先用 modelName，没有则用 provider 默认值
  apiName: string;
  provider: string;
  supportsVision: boolean;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  keyValue: string;
  // 原始 Key 记录（供 useChatStream 直接使用）
  keyRecord: ApiKeyRecord;
}

// Provider 默认模型名（用户没填 modelName 时的兜底）
const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4-5",
  openai:    "gpt-4o",
  deepseek:  "deepseek-chat",
  gemini:    "gemini-2.0-flash",
  custom:    "",
};

// Provider 是否默认支持视觉（用户没填 modelName 时的兜底）
const PROVIDER_DEFAULT_VISION: Record<string, boolean> = {
  anthropic: true,
  openai:    true,
  deepseek:  false,
  gemini:    true,
  custom:    false,
};

export function useAvailableModels() {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const keys = await apiKeyRepo.getAll();
    const activeKeys = keys.filter((k) => k.isActive);

    const result: AvailableModel[] = activeKeys.map((k) => ({
      id: k.id,
      label: k.modelName || k.label,
      apiName: k.modelName || PROVIDER_DEFAULT_MODEL[k.provider] || k.provider,
      provider: k.provider,
      supportsVision: PROVIDER_DEFAULT_VISION[k.provider] ?? false,
      baseUrl: k.baseUrl,
      extraHeaders: k.extraHeaders,
      keyValue: k.keyValue,
      keyRecord: k,
    }));

    setModels(result);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { models, loading, refresh };
}
