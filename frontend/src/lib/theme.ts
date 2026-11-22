import { useState, useEffect, useCallback } from "react";

export type Theme = "lemon" | "light" | "dark" | "system";
export type ResolvedTheme = "lemon" | "light" | "dark";

export const DEFAULT_THEME: Theme = "lemon";

export const THEME_STORAGE_KEY = "lemonai-theme";
const THEME_CHANGE_EVENT = "lemonai:theme-change";

export function getStoredTheme(): Theme {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return DEFAULT_THEME;
    }
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "lemon" || stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setStoredTheme(theme: Theme): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Restricted sandbox or quota exhaustion fallback
  }
}

export function getSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  }
  return "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") {
    return;
  }
  const resolved = resolveTheme(theme);
  const root = document.documentElement.classList;
  root.toggle("dark", resolved === "dark");
  root.toggle("lemon", resolved === "lemon");
}

export function initTheme(): void {
  applyTheme(getStoredTheme());
}

export interface UseThemeReturn {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getStoredTheme())
  );

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    setStoredTheme(nextTheme);
    setResolvedTheme(resolveTheme(nextTheme));
    applyTheme(nextTheme);

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(THEME_CHANGE_EVENT, { detail: nextTheme })
      );
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(next);
  }, [resolvedTheme, setTheme]);

  useEffect(() => {
    applyTheme(theme);
    setResolvedTheme(resolveTheme(theme));

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<Theme>;
      const detail = customEvent.detail;
      if (detail === "lemon" || detail === "light" || detail === "dark" || detail === "system") {
        setThemeState(detail);
        setResolvedTheme(resolveTheme(detail));
        applyTheme(detail);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener(THEME_CHANGE_EVENT, handleSync);
    }

    if (
      theme !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener(THEME_CHANGE_EVENT, handleSync);
        }
      };
    }

    try {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleMediaChange = (event?: MediaQueryListEvent | { matches: boolean }) => {
        const isDark = event ? event.matches : mediaQuery.matches;
        setResolvedTheme(isDark ? "dark" : "light");
        applyTheme("system");
      };

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handleMediaChange);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleMediaChange);
      }

      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener(THEME_CHANGE_EVENT, handleSync);
        }
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener("change", handleMediaChange);
        } else if (mediaQuery.removeListener) {
          mediaQuery.removeListener(handleMediaChange);
        }
      };
    } catch {
      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener(THEME_CHANGE_EVENT, handleSync);
        }
      };
    }
  }, [theme]);

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
  };
}
