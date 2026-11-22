import { useMemo, useState } from "react";
import type { ModelPackageManifest } from "@/types/manifest";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { fmt, useI18n } from "@/lib/i18n";
import { fitOf, formatGb, needs, overflowGb, recommend, type FitKind, type MachineMemory } from "@/lib/families";
import { cn } from "@/lib/utils";

export interface VersionPickerDialogProps<T extends { manifest: ModelPackageManifest }> {
  familyName: string;

  members: T[];
  machine: MachineMemory;

  allowOffload?: boolean;
  installedIds: string[];

  busy?: boolean;
  onInstall: (member: T) => void;
  onOpen: (member: T) => void;
  onClose: () => void;
}

const CHART_HEIGHT = 200;

function variantName(manifest: ModelPackageManifest, familyName?: string): string {
  if (manifest.family?.variant) return manifest.family.variant;
  if (familyName && manifest.name.startsWith(familyName)) {
    const stripped = manifest.name.slice(familyName.length).replace(/^[\s·\-:]+/, "").trim();
    if (stripped) return stripped;
  }
  return manifest.name;
}

export function VersionPickerDialog<T extends { manifest: ModelPackageManifest }>({
  familyName,
  members,
  machine,
  allowOffload: initialOffload = true,
  installedIds,
  busy,
  onInstall,
  onOpen,
  onClose,
}: VersionPickerDialogProps<T>) {
  const { t, lang } = useI18n();
  const [allowOffload, setAllowOffload] = useState(initialOffload);
  const [picked, setPicked] = useState<string | null>(null);

  const { recommended, fits } = useMemo(
    () => recommend(members, machine, allowOffload),
    [members, machine, allowOffload]
  );
  const fit = (m: T): FitKind => fits.get(m) ?? fitOf(m.manifest, machine, allowOffload);
  const pickedMember = members.find((m) => m.manifest.id === picked);
  const selected = pickedMember && fit(pickedMember) !== "none" ? pickedMember : recommended;
  const selectedFit = fit(selected);
  const installed = installedIds.includes(selected.manifest.id);

  const vram = machine.vramGb;
  const scaleMax = Math.max(vram ?? 0, ...members.map((m) => needs(m.manifest).vramGb), 1) * 1.08;
  const px = (gb: number) => Math.round((Math.max(0, gb) / scaleMax) * CHART_HEIGHT);
  const linePx = vram !== undefined ? px(vram) : null;

  const name = (m: T) => `${familyName} · ${variantName(m.manifest, familyName)}`;
  const fitText =
    selectedFit === "gpu"
      ? selected === recommended
        ? t("pickerWhyRecommended")
        : t("pickerFitsGpu")
      : selectedFit === "ram"
        ? fmt(t("pickerSpills"), { x: formatGb(overflowGb(selected.manifest, machine), lang) })
        : t("pickerTooBig");

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={fmt(t("pickerTitle"), { x: familyName })}
      size="2xl"
      aria-labelledby="version-picker-title"
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground leading-relaxed">{t("pickerHint")}</p>

        <div className="relative">
          {linePx !== null && (
            <>
              <div
                aria-hidden="true"
                className="absolute left-0 right-0 border-t-2 border-dashed border-foreground z-10 pointer-events-none"
                style={{ bottom: 56 + linePx }}
              />
              <div
                aria-hidden="true"
                className="absolute right-0 z-10 whitespace-nowrap bg-card pl-2 text-xs font-bold"
                style={{ bottom: 56 + linePx + 4 }}
              >
                {t("pickerYourCard")} · {formatGb(vram ?? 0, lang)}
              </div>
            </>
          )}
          <div role="radiogroup" aria-label={fmt(t("pickerTitle"), { x: familyName })} className="flex gap-4">
            {members.map((m) => {
              const f = fit(m);
              const on = m === selected;
              const need = needs(m.manifest).vramGb;
              const inGpu = vram === undefined ? need : Math.min(need, vram);
              const fitWord = f === "gpu" ? t("fitGpu") : f === "ram" ? t("fitRam") : t("fitNone");
              const tag =
                m === recommended ? t("pickerRecommended") : installedIds.includes(m.manifest.id) ? t("pickerInstalled") : "";
              return (
                <button
                  key={m.manifest.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={f === "none"}
                  aria-label={`${name(m)}, ${formatGb(need, lang)}, ${fitWord}`}
                  onClick={() => f !== "none" && setPicked(m.manifest.id)}
                  className={cn("flex-1 min-w-0 flex flex-col", f === "none" ? "cursor-not-allowed" : "cursor-pointer")}
                >
                  <span className="flex flex-col justify-end gap-1.5" style={{ height: CHART_HEIGHT + 22 }}>
                    <span className="h-4 text-center text-xs font-extrabold text-ink">{tag}</span>
                    <span
                      className={cn(
                        "flex flex-col rounded-t-[10px] overflow-hidden border-[1.5px] border-b-0 outline outline-[3px] outline-offset-[3px]",
                        f === "none" ? "border-border" : "border-primary",
                        on ? "outline-foreground" : "outline-transparent"
                      )}
                    >
                      <span
                        className={f === "none" ? "bg-secondary" : "bg-warn/70"}
                        style={{ height: px(need) - px(inGpu) }}
                      />
                      <span
                        className={f === "none" ? "bg-secondary" : on ? "bg-primary" : "bg-primary/60"}
                        style={{ height: Math.max(4, px(inGpu)) }}
                      />
                    </span>
                  </span>
                  <span className="h-14 flex flex-col items-center pt-2.5 border-t border-border">
                    <span className={cn("text-base", on ? "font-extrabold" : "font-semibold")}>{variantName(m.manifest, familyName)}</span>
                    <span className="text-xs text-muted-foreground">{formatGb(need, lang)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-6 items-start rounded-2xl bg-primary/15 px-5 py-4">
          <div className="flex-[999_1_300px] min-w-0">
            <div className="text-lg font-extrabold">{name(selected)}</div>
            {selected.manifest.description && (
              <p className="mt-1.5 text-sm leading-relaxed">{selected.manifest.description}</p>
            )}
            <p className={cn("mt-2.5 text-[13px] font-bold", selectedFit === "gpu" ? "text-ok" : "text-warn")}>{fitText}</p>
          </div>
          <dl className="flex-[1_1_160px] grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">{t("pickerGpuNeed")}</dt>
            <dd className="font-bold text-right">{formatGb(needs(selected.manifest).vramGb, lang)}</dd>
            <dt className="text-muted-foreground">{t("pickerRamNeed")}</dt>
            <dd className="font-bold text-right">{formatGb(needs(selected.manifest).ramGb, lang)}</dd>
          </dl>
        </div>

        <label className="flex gap-3 items-start cursor-pointer">
          <input
            type="checkbox"
            checked={allowOffload}
            onChange={() => setAllowOffload((v) => !v)}
            className="mt-0.5 h-[18px] w-[18px] accent-[hsl(var(--primary))]"
          />
          <span>
            <span className="block text-sm font-bold">{t("pickerAllowRam")}</span>
            <span className="block text-[13px] text-muted-foreground mt-0.5">{t("pickerAllowRamDesc")}</span>
          </span>
        </label>

        <div className="flex flex-wrap gap-3 items-center justify-end">
          <span className="flex-1 text-[13px] text-muted-foreground">
            {machine.vramGb !== undefined &&
              fmt(t("pickerDetected"), {
                vram: formatGb(machine.vramGb, lang),
                ram: machine.ramGb !== undefined ? formatGb(machine.ramGb, lang) : "?",
              })}
          </span>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          {installed ? (
            <Button size="lg" onClick={() => onOpen(selected)}>
              {fmt(t("pickerOpen"), { x: variantName(selected.manifest) })}
            </Button>
          ) : (
            <Button size="lg" disabled={busy || selectedFit === "none"} onClick={() => onInstall(selected)}>
              {fmt(t("pickerInstall"), { x: variantName(selected.manifest) })}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
