"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const darkVars: Record<string, string> = {
  "--background": "#0a0a0a",
  "--foreground": "#e5e5e5",
  "--sidebar-bg": "#111111",
  "--sidebar-hover": "#1e1e1e",
  "--sidebar-active": "rgba(23, 37, 84, 0.7)",
  "--text-primary": "#e5e5e5",
  "--text-secondary": "#888888",
  "--text-muted": "#444444",
  "--border-color": "#1f1f1f",
  "--border-subtle": "rgba(55, 65, 81, 0.4)",
  "--accent-blue": "#3b82f6",
  "--online-green": "#22c55e",
  "--topbar-bg": "#111111",
  "--card-bg": "#161616",
};

const lightVars: Record<string, string> = {
  "--background": "#f5f5f5",
  "--foreground": "#111111",
  "--sidebar-bg": "#ffffff",
  "--sidebar-hover": "#f0f0f0",
  "--sidebar-active": "rgba(219, 234, 254, 0.8)",
  "--text-primary": "#111111",
  "--text-secondary": "#666666",
  "--text-muted": "#aaaaaa",
  "--border-color": "#e5e5e5",
  "--border-subtle": "rgba(200, 200, 200, 0.6)",
  "--accent-blue": "#2563eb",
  "--online-green": "#16a34a",
  "--topbar-bg": "#ffffff",
  "--card-bg": "#fafafa",
};

function applyTheme(theme: Theme) {
  const vars = theme === "dark" ? darkVars : lightVars;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  root.setAttribute("data-theme", theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  // 初始化时应用暗色主题
  useEffect(() => {
    applyTheme("dark");
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
