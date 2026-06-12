import {
  MessageSquare,
  History,
  Users,
  BrainCircuit,
  Puzzle,
  LayoutDashboard,
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
      { label: "协作交流", href: "/corwork", icon: Users },
      { label: "Agent蜂巢", href: "/corwork/think-tank", icon: BrainCircuit },
    ],
  },
  {
    id: "workbench",
    label: "工作台",
    items: [
      { label: "Skill / MCP Maker", href: "/workbench/skills", icon: Puzzle },
      { label: "协作看板", href: "/workbench/board", icon: LayoutDashboard },
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
