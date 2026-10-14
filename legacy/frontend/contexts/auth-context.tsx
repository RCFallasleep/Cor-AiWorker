"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authApi, getStoredUser, clearToken, type User } from "@/lib/api/client";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 初始化：从 localStorage 恢复用户状态，并验证 Token 有效性
  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
      // 后台验证 Token 是否仍有效
      authApi.me().then(setUser).catch(() => {
        clearToken();
        setUser(null);
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { user } = await authApi.login(username, password);
    setUser(user);
  }, []);

  const register = useCallback(async (username: string, password: string, displayName?: string) => {
    const { user } = await authApi.register(username, password, displayName);
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
