import type { ModelPackageManifest } from "@/types/manifest";

const modules = import.meta.glob("../../../../schemas/hub/*.json", {
  eager: true,
  import: "default",
}) as Record<string, ModelPackageManifest>;

export const BUNDLED_MANIFESTS: readonly ModelPackageManifest[] = Object.values(modules).sort(
  (a, b) => a.id.localeCompare(b.id)
);

export function bundledManifest(id: string): ModelPackageManifest | undefined {
  return BUNDLED_MANIFESTS.find((m) => m.id === id);
}

export function resolveVariant(
  manifest: ModelPackageManifest,
  variantId: string
): ModelPackageManifest {
  const variants = manifest.variants;
  if (!variants || variants.length === 0) {
    throw new Error(`Manifest '${manifest.id}' has no variants`);
  }
  const variantIndex = variants.findIndex((v) => v.id === variantId);
  if (variantIndex < 0) {
    throw new Error(`Variant '${variantId}' not found in manifest '${manifest.id}'`);
  }
  const variant = variants[variantIndex];

  const baseRuntime = variant.runtime ?? manifest.runtime;
  const runtime = {
    ...baseRuntime,
    ...(variant.context_window ? { context_window: variant.context_window } : {}),
    ...(variant.output_tokens ? { output_tokens: variant.output_tokens } : {}),
  };

  return {
    ...manifest,
    id: `${manifest.id}-${variant.id}`,
    name: `${manifest.name} · ${variant.name}`,
    description: variant.description ?? manifest.description,
    hardware_requirements: variant.hardware_requirements ?? manifest.hardware_requirements,
    install: variant.install ?? manifest.install,
    runtime,
    variants: undefined,
    family: manifest.family ?? {
      id: manifest.id,
      name: manifest.name,
      variant: variant.name,
      order: variantIndex,
    },
  };
}

export function defaultVariantId(manifest: ModelPackageManifest): string {
  const variants = manifest.variants ?? [];
  const same = variants.find((v) => JSON.stringify(v.install ?? null) === JSON.stringify(manifest.install));
  return (same ?? variants[0])?.id ?? "";
}

export function asVariant<T extends { manifest: ModelPackageManifest }>(item: T, variantId: string): T {
  const manifest = resolveVariant(item.manifest, variantId);
  const out: T & { name?: unknown; min_vram_gb?: unknown } = { ...item, manifest };
  if ("name" in item) out.name = manifest.name;
  if ("min_vram_gb" in item) out.min_vram_gb = manifest.hardware_requirements.min_vram_gb;
  return out;
}

export function expandVariants<T extends { manifest: ModelPackageManifest }>(items: readonly T[]): T[] {
  return items.flatMap((item) => {
    const variants = item.manifest.variants;
    return variants?.length ? variants.map((v) => asVariant(item, v.id)) : [item];
  });
}
