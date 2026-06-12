"use client";

/**
 * useClientContext
 * 收集浏览器可感知的静态上下文：
 *   - timezone：IANA 时区名（同步获取，100% 可用）
 *   - city：通过 Geolocation API + 反查接口获取（异步，可能失败）
 *
 * 返回的 context 对象可直接随请求传给后端。
 */

import { useState, useEffect } from "react";

export interface ClientContext {
  timezone: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

const STORAGE_KEY = "cor_client_context";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 城市缓存 6 小时

interface CachedContext {
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  cachedAt: number;
}

function loadCache(): CachedContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: CachedContext = JSON.parse(raw);
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(data: Omit<CachedContext, "cachedAt">) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...data, cachedAt: Date.now() })
    );
  } catch {
    // localStorage 不可用时静默忽略
  }
}

/** 通过坐标反查城市名（使用 nominatim 开放 API，无需 key） */
async function reversGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=zh`,
      { headers: { "User-Agent": "Cor-AiWorker/1.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // 优先取城市，其次取县/区，最后取州/省
    return (
      data.address?.city ||
      data.address?.county ||
      data.address?.state ||
      null
    );
  } catch {
    return null;
  }
}

export function useClientContext(): ClientContext {
  const [context, setContext] = useState<ClientContext>(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    city: null,
    latitude: null,
    longitude: null,
  }));

  useEffect(() => {
    // 时区始终实时读取
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // 先尝试读缓存
    const cached = loadCache();
    if (cached) {
      setContext({ timezone, ...cached });
      return;
    }

    // 无缓存时请求 Geolocation
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const city = await reversGeocode(latitude, longitude);
        const locationData = { city, latitude, longitude };
        saveCache(locationData);
        setContext({ timezone, ...locationData });
      },
      () => {
        // 用户拒绝授权或获取失败，静默忽略，city 保持 null
      },
      { timeout: 5000, maximumAge: CACHE_TTL_MS }
    );
  }, []);

  return context;
}
