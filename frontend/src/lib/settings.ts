import { useCallback, useEffect, useState } from "react";

export const ADULT_CONTENT_KEY = "lemonai-adult-content";
const CHANGE_EVENT = "lemonai:adult-content";

export function getAdultContent(): boolean {
  try {
    return window.localStorage.getItem(ADULT_CONTENT_KEY) === "on";
  } catch {
    return false;
  }
}

export function setAdultContent(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(ADULT_CONTENT_KEY, "on");
    else window.localStorage.removeItem(ADULT_CONTENT_KEY);
  } catch {
    // Restricted storage: the choice lasts for this session only.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: on }));
}

export function useAdultContent(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => getAdultContent());
  useEffect(() => {
    const sync = (e: Event) => setOn(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  const change = useCallback((next: boolean) => setAdultContent(next), []);
  return [on, change];
}

export function isAdult(manifest: { content_rating?: string | null }): boolean {
  return manifest.content_rating === "adult";
}
