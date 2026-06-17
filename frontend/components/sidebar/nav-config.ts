import {
  MessageSquare,
  History,
  Users,
  BrainCircuit,
  Puzzle,
  Code2,
  Moon,
  Sparkles,
  Key,
  FileText,
  Timer,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    id: "chat",
    label: "聊天",
    items: [
      { label: "聊天", href: "/chat", icon: MessageSquare },
      { label: "聊天记录", href: "/chat/history", icon: History },
    ],
  },
  {
    id: "corwork",
    label: "协作",
    items: [
      { label: "交流协作", href: "/corwork", icon: Users },
      { label: "Agent蜂巢", href: "/corwork/think-tank", icon: BrainCircuit },
    ],
  },
  {
    id: "workbench",
    label: "工作台",
    items: [
      { label: "Skill / MCP Maker", href: "/workbench/skills", icon: Puzzle },
      { label: "代码编辑", href: "/workbench/editor", icon: Code2 },
      { label: "定时任务", href: "/workbench/schedule", icon: Timer },
    ],
  },
  {
    id: "health",
    label: "Health",
    items: [
      { label: "梦境归档", href: "/health/dreams", icon: Moon },
      { label: "Agent 养成", href: "/health/agent", icon: Sparkles },
    ],
  },
  {
    id: "settings",
    label: "设置",
    items: [
      { label: "API Key 管理", href: "/settings/apikey", icon: Key },
      { label: "Log 日志", href: "/settings/logs", icon: FileText },
    ],
  },
];
