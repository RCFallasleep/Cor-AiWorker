/**
 * 外观偏好：明暗模式 × 皮肤。
 *
 * 目前保存在浏览器本地；M3-3 改为保存到本地服务的设置中，使浏览器与桌面窗口一致。
 * index.html 中有一段内联脚本在页面渲染前执行同样的逻辑，避免先闪一下默认样式；
 * 两处的存储键与取值必须保持一致。
 */

export type Mode = "system" | "light" | "dark";

export interface Skin {
  id: string;
  name: string;
  note: string;
}

export const SKINS: readonly Skin[] = [
  { id: "brand", name: "品牌蓝", note: "默认 · 取自 logo" },
  { id: "teal", name: "青石", note: "沉稳的青绿色" },
  { id: "ink", name: "墨灰", note: "中性、低饱和" },
];

export interface Look {
  mode: Mode;
  skin: string;
}

export const DEFAULT_LOOK: Look = { mode: "system", skin: "brand" };
export const STORAGE_KEY = "cor-aiworker.look";

const MODES: readonly Mode[] = ["system", "light", "dark"];

export function parseLook(raw: string | null): Look {
  if (!raw) return DEFAULT_LOOK;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return DEFAULT_LOOK;
    const { mode, skin } = value as Partial<Record<keyof Look, unknown>>;
    return {
      mode: MODES.includes(mode as Mode) ? (mode as Mode) : DEFAULT_LOOK.mode,
      skin: SKINS.some((s) => s.id === skin) ? (skin as string) : DEFAULT_LOOK.skin,
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

export function loadLook(): Look {
  try {
    return parseLook(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOOK; // 隐私模式等情况下存储不可用
  }
}

export function applyLook(look: Look, root: HTMLElement = document.documentElement): void {
  if (look.mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", look.mode);
  if (look.skin === DEFAULT_LOOK.skin) root.removeAttribute("data-skin");
  else root.setAttribute("data-skin", look.skin);
}

export function saveLook(look: Look): void {
  applyLook(look);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // 存储不可用时只在本次页面中生效
  }
}
