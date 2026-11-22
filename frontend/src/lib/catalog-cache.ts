import type { HubScript } from "@/lib/hub-api";

export const CATALOG_CACHE_KEY = "lemonai:catalog-cache";

export interface CachedCatalog {
  lastSyncedAt: number;
  hubUrl?: string;
  scripts: HubScript[];
}

export function getCachedCatalog(): CachedCatalog | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    const raw = window.localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.lastSyncedAt !== "number" ||
      !Array.isArray(parsed.scripts) ||
      !parsed.scripts.every((s: unknown) => s && typeof s === "object" && "manifest" in s)
    ) {
      return null;
    }
    return parsed as CachedCatalog;
  } catch {
    return null;
  }
}

export function setCachedCatalog(scripts: HubScript[], hubUrl?: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const entry: CachedCatalog = {
      lastSyncedAt: Date.now(),
      hubUrl,
      scripts,
    };
    window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // QuotaExceededError, SecurityError, etc. — ignore gracefully
  }
}

export function clearCachedCatalog(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    window.localStorage.removeItem(CATALOG_CACHE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function formatCacheDate(timestamp: number, lang: string = "pl"): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return "";
    }
    const locale = lang === "en" ? "en-US" : "pl-PL";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return new Date(timestamp).toISOString();
  }
}
