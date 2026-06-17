"use client";

/**
 * useEnabledSkillTools
 *
 * 从后端 Skill 中心拉取已启用的工具名列表，供 Chat 页面构建 tool_names 白名单。
 *
 * 规则：
 * - builtin / custom 类型且 enabled=true → 工具名加入白名单
 * - collab 类型（forward_message / save_memory）→ 始终排除（仅在协作 Agent 对话中使用）
 * - 后端未配置（NEXT_PUBLIC_BACKEND_URL 为空）→ 返回 null（不过滤，使用全部工具）
 *
 * 工具名映射规则（与 skill_runner.py 保持一致）：
 *   builtin Skill → 直接使用注册时的工具名（search / read_document）
 *   custom Skill  → "skill_" + snake_case(name)
 */

import { useState, useEffect } from "react";
import { skillsApi } from "@/lib/api/client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

/** 将 Skill 名称转换为 snake_case（与后端 skill_runner._to_snake_case 保持一致） */
function toSnakeCase(name: string): string {
  let s = name.trim().replace(/[\s-]+/g, "_").replace(/[^\w]/g, "");
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
  s = s.replace(/([a-z\d])([A-Z])/g, "$1_$2");
  return s.toLowerCase();
}

/** 根据 Skill 元数据推断注册到 tool_registry 的工具名 */
function resolveToolName(skillType: string, skillName: string): string {
  if (skillType === "builtin") {
    // 内置工具直接用小写名称（search.py → "search"，read_document.py → "read_document"）
    return toSnakeCase(skillName);
  }
  // 自建 Skill：前缀 "skill_"
  return `skill_${toSnakeCase(skillName)}`;
}

export interface EnabledSkillToolsResult {
  /** 已启用的工具名白名单（null 表示不过滤，使用全部工具） */
  toolNames: string[] | null;
  loading: boolean;
}

export function useEnabledSkillTools(): EnabledSkillToolsResult {
  const [toolNames, setToolNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!BACKEND_URL) {
      // 未配置后端，不过滤
      setToolNames(null);
      setLoading(false);
      return;
    }

    skillsApi
      .list(true) // enabled_only=true
      .then(({ skills }) => {
        const names = skills
          .filter((s) => s.skill_type !== "collab") // 排除协作专用工具
          .map((s) => resolveToolName(s.skill_type, s.name));
        setToolNames(names);
      })
      .catch(() => {
        // 拉取失败时不过滤（降级为全部工具）
        setToolNames(null);
      })
      .finally(() => setLoading(false));
  }, []);

  return { toolNames, loading };
}
