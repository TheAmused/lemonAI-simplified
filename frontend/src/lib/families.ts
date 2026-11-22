import type { ModelPackageManifest } from "@/types/manifest";
import { asVariant } from "@/lib/catalog";

export interface MachineMemory {

  vramGb?: number;

  ramGb?: number;
}

export type FitKind = "gpu" | "ram" | "none";

export const RAM_RESERVE_GB = 8;

const UNKNOWN_RAM_GB = 16;

export function needs(manifest: ModelPackageManifest): { vramGb: number; ramGb: number; cpuOk: boolean } {
  const hw = manifest.hardware_requirements;
  return {
    vramGb: hw?.min_vram_gb ?? 0,
    ramGb: hw?.min_ram_gb ?? 0,
    cpuOk: (hw?.supported_accelerators ?? []).includes("cpu"),
  };
}

export function fitOf(manifest: ModelPackageManifest, machine: MachineMemory, allowOffload = true): FitKind {
  const need = needs(manifest);
  const ram = machine.ramGb ?? UNKNOWN_RAM_GB;
  if (need.ramGb > ram) return "none";
  if (machine.vramGb === undefined) return "gpu";
  if (need.vramGb <= machine.vramGb) return "gpu";
  if (allowOffload && need.vramGb <= machine.vramGb + Math.max(0, ram - RAM_RESERVE_GB)) return "ram";
  return "none";
}

export function overflowGb(manifest: ModelPackageManifest, machine: MachineMemory): number {
  if (machine.vramGb === undefined) return 0;
  return Math.max(0, Math.round((needs(manifest).vramGb - machine.vramGb) * 10) / 10);
}

export interface Recommendation<T> {

  recommended: T;
  fits: Map<T, FitKind>;
}

export function recommend<T extends { manifest: ModelPackageManifest }>(
  members: readonly T[],
  machine: MachineMemory,
  allowOffload = true
): Recommendation<T> {
  const fits = new Map<T, FitKind>(members.map((m) => [m, fitOf(m.manifest, machine, allowOffload)]));
  const bySize = [...members].sort((a, b) => needs(a.manifest).vramGb - needs(b.manifest).vramGb);
  const largest = (kind: FitKind) => [...bySize].reverse().find((m) => fits.get(m) === kind);
  const recommended = largest("gpu") ?? largest("ram") ?? bySize[0];
  return { recommended, fits };
}

export interface FamilyEntry<T> {
  kind: "family";
  id: string;
  name: string;

  members: T[];
}

export interface SingleEntry<T> {
  kind: "single";
  item: T;
}

export type CatalogEntry<T> = FamilyEntry<T> | SingleEntry<T>;

export function groupCatalog<T extends { manifest: ModelPackageManifest }>(items: readonly T[]): CatalogEntry<T>[] {
  const families = new Map<string, FamilyEntry<T>>();
  const entries: CatalogEntry<T>[] = [];
  for (const item of items) {
    if (item.manifest.variants && item.manifest.variants.length > 0) {
      if (item.manifest.variants.length === 1) {
        entries.push({ kind: "single", item: asVariant(item, item.manifest.variants[0].id) });
      } else {
        const members: T[] = item.manifest.variants.map((v) => asVariant(item, v.id));
        const entry: FamilyEntry<T> = {
          kind: "family",
          id: item.manifest.id,
          name: item.manifest.name,
          members,
        };
        entries.push(entry);
      }
      continue;
    }

    const family = item.manifest.family;
    if (!family) {
      entries.push({ kind: "single", item });
      continue;
    }
    const existing = families.get(family.id);
    if (existing) {
      existing.members.push(item);
    } else {
      const entry: FamilyEntry<T> = { kind: "family", id: family.id, name: family.name, members: [item] };
      families.set(family.id, entry);
      entries.push(entry);
    }
  }
  return entries.map((entry) => {
    if (entry.kind === "family") {
      entry.members.sort((a, b) => (a.manifest.family?.order ?? 0) - (b.manifest.family?.order ?? 0));
      if (entry.members.length === 1) return { kind: "single", item: entry.members[0] } as SingleEntry<T>;
    }
    return entry;
  });
}

export function variantsLabel(count: number, lang: "pl" | "en"): string {
  if (lang === "en") return count === 1 ? "1 version" : `${count} versions`;
  if (count === 1) return "1 wersja";
  const lastTwo = count % 100;
  const last = count % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} wersje`;
  return `${count} wersji`;
}

export function formatGb(value: number, lang: "pl" | "en" = "pl"): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${lang === "pl" ? text.replace(".", ",") : text} GB`;
}
