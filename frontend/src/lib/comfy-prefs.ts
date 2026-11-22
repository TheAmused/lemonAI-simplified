
export type ComfyOpenMode = "app" | "browser";

const OPEN_KEY = "lemonai-comfy-open";
const HINT_KEY = "lemonai-comfy-manager-hint";

export function getComfyOpenMode(): ComfyOpenMode {
  try {
    return localStorage.getItem(OPEN_KEY) === "browser" ? "browser" : "app";
  } catch {
    return "app";
  }
}

export function setComfyOpenMode(mode: ComfyOpenMode): void {
  try {
    localStorage.setItem(OPEN_KEY, mode);
  } catch {
    // not persisted
  }
}

export function managerHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissManagerHint(): void {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // shown again next time
  }
}
