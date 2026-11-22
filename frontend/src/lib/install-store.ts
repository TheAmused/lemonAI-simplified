import { useSyncExternalStore } from "react";
import type { ModelPackageManifest } from "@/types/manifest";
import { apiCancelInstall, apiInstallModel, type InstallProgress } from "@/lib/ipc";

export interface RunningInstall {
  modelId: string;
  name: string;
  progress: InstallProgress | null;
  cancelRequested: boolean;
}

export interface InstallOutcome {
  modelId: string;
  name: string;

  error: string | null;
}

interface Snapshot {
  running: RunningInstall | null;
  unseen: InstallOutcome | null;
}

let snapshot: Snapshot = { running: null, unseen: null };
const listeners = new Set<() => void>();

function set(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallSnapshot(): Snapshot {
  return snapshot;
}

export function useInstallState(): Snapshot {
  return useSyncExternalStore(subscribe, getInstallSnapshot, getInstallSnapshot);
}

export async function startInstall(manifest: ModelPackageManifest, name = manifest.name): Promise<void> {
  if (snapshot.running) {
    throw new Error(`Model '${snapshot.running.modelId}' is already being installed`);
  }
  set({ running: { modelId: manifest.id, name, progress: null, cancelRequested: false } });
  let error: string | null = null;
  try {
    await apiInstallModel(manifest, (progress) => {
      const running = snapshot.running;
      if (running?.modelId === manifest.id) set({ running: { ...running, progress } });
    });
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    set({ running: null, unseen: { modelId: manifest.id, name, error } });
  }
}

export async function cancelRunningInstall(): Promise<void> {
  const running = snapshot.running;
  if (!running || running.cancelRequested) return;
  set({ running: { ...running, cancelRequested: true } });
  try {
    await apiCancelInstall(running.modelId);
  } catch {
    // The install promise reports the final outcome.
  }
}

export function clearUnseenOutcome(): void {
  if (snapshot.unseen) set({ unseen: null });
}

export function resetInstallStore(): void {
  snapshot = { running: null, unseen: null };
  for (const listener of listeners) listener();
}
