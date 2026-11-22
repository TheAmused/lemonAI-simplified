import { useSyncExternalStore } from "react";
import {
  apiAppAutoUpdate,
  apiComfyCancelInstall,
  apiComfyCheckUpdate,
  apiComfyInstall,
  apiComfyStatus,
  apiSetAppAutoUpdate,
  type ComfyDevice,
  type ComfyInstalled,
  type ComfyProgress,
  type ComfyReleaseInfo,
} from "@/lib/ipc";

export interface ComfyInstallState {
  running: boolean;

  automatic: boolean;
  progress: ComfyProgress | null;
  cancelRequested: boolean;

  outcome:
    | { ok: true; installed: ComfyInstalled; automatic: boolean }
    | { ok: false; error: string; automatic: boolean }
    | null;

  release: ComfyReleaseInfo | null;

  autoUpdate: boolean;
}

const INITIAL: ComfyInstallState = {
  running: false,
  automatic: false,
  progress: null,
  cancelRequested: false,
  outcome: null,
  release: null,
  autoUpdate: true,
};

export const AUTO_UPDATE_FAILED_KEY = "lemonai:comfyui-auto-update-failed";

export const UPDATE_FIRST_CHECK_MS = 20_000;
export const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000;

let state: ComfyInstallState = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<ComfyInstallState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ComfyInstallState {
  return state;
}

export function useComfyInstall(): ComfyInstallState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function failedRelease(): string | null {
  try {
    return localStorage.getItem(AUTO_UPDATE_FAILED_KEY);
  } catch {
    return null;
  }
}

function rememberFailedRelease(tag: string | null): void {
  try {
    if (tag) localStorage.setItem(AUTO_UPDATE_FAILED_KEY, tag);
    else localStorage.removeItem(AUTO_UPDATE_FAILED_KEY);
  } catch {
    // only a convenience
  }
}

export async function startComfyInstall(
  device: ComfyDevice | null,
  options: { automatic?: boolean } = {}
): Promise<void> {
  if (state.running) return;
  const automatic = options.automatic ?? false;
  const target = state.release?.latest ?? null;
  set({ running: true, automatic, progress: null, cancelRequested: false, outcome: null });
  try {
    const installed = await apiComfyInstall(device, (progress) => set({ progress }));
    rememberFailedRelease(null);
    set({
      outcome: { ok: true, installed, automatic },
      release: state.release ? { ...state.release, installed: installed.version, update_available: false } : null,
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    if (automatic && target && !/cancelled/i.test(error)) rememberFailedRelease(target);
    set({ outcome: { ok: false, error, automatic } });
  } finally {
    set({ running: false, automatic: false, progress: null, cancelRequested: false });
  }
}

export async function cancelComfyInstall(): Promise<void> {
  if (!state.running || state.cancelRequested) return;
  set({ cancelRequested: true });
  try {
    await apiComfyCancelInstall();
  } catch {
    // The install itself reports how it ended.
  }
}

export function clearComfyOutcome(): void {
  if (state.outcome) set({ outcome: null });
}

export async function checkComfyRelease(force = false): Promise<ComfyReleaseInfo> {
  const release = await apiComfyCheckUpdate(force);
  set({ release });
  return release;
}

export async function loadComfyAutoUpdate(): Promise<boolean> {
  const autoUpdate = await apiAppAutoUpdate("comfyui");
  set({ autoUpdate });
  return autoUpdate;
}

export async function setComfyAutoUpdate(enabled: boolean): Promise<void> {
  set({ autoUpdate: await apiSetAppAutoUpdate("comfyui", enabled) });
  if (enabled) void comfyUpdateTick();
}

export async function comfyUpdateTick(): Promise<void> {
  if (state.running) return;
  try {
    const status = await apiComfyStatus();
    if (!status.installed) {
      if (state.release) set({ release: null });
      return;
    }
    const [release, autoUpdate] = await Promise.all([checkComfyRelease(false), loadComfyAutoUpdate()]);
    if (
      autoUpdate &&
      release.update_available &&
      !state.running &&
      status.server.state === "stopped" &&
      failedRelease() !== release.latest
    ) {
      await startComfyInstall(null, { automatic: true });
    }
  } catch {
    // Try again at the next round.
  }
}

export function startComfyUpdateWatch(
  firstCheckMs = UPDATE_FIRST_CHECK_MS,
  everyMs = UPDATE_CHECK_EVERY_MS
): () => void {
  let interval: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    void comfyUpdateTick();
    interval = setInterval(() => void comfyUpdateTick(), everyMs);
  }, firstCheckMs);
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}

export function resetComfyInstallStore(): void {
  state = INITIAL;
  rememberFailedRelease(null);
  for (const listener of listeners) listener();
}
