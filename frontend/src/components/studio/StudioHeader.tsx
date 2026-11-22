import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelPackageManifest, ModelState } from "@/types/manifest";
import type { ActiveModelSummary } from "@/lib/ipc";
import { isOffloaded } from "@/lib/ipc";
import { fmt, useI18n } from "@/lib/i18n";
import { formatGb, groupCatalog } from "@/lib/families";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, GridIcon, LogIcon, categoryIcon } from "@/components/shell/icons";

export interface StudioHeaderProps {
  models: ModelPackageManifest[];
  selected: ModelPackageManifest | undefined;
  states: Record<string, ModelState>;
  onSelect: (modelId: string) => void;

  active?: ActiveModelSummary | null;
  busy?: boolean;
  onRelease: () => void;
  onOpenCatalog: () => void;
  logOpen?: boolean;

  onToggleLog?: () => void;
}

const dotClass: Record<ModelState, string> = {
  stopped: "bg-muted-foreground/40",
  loading: "bg-warn animate-pulse",
  ready: "bg-ok",
  inferring: "bg-primary animate-pulse",
  unloading: "bg-warn animate-pulse",
};

export function StudioHeader({
  models,
  selected,
  states,
  onSelect,
  active,
  busy,
  onRelease,
  onOpenCatalog,
  logOpen,
  onToggleLog,
}: StudioHeaderProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupCatalog(models.map((manifest) => ({ manifest }))), [models]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const status: ModelState = selected ? states[selected.id] ?? "stopped" : "stopped";
  const running = status !== "stopped";
  const pick = (id: string) => {
    setOpen(false);
    onSelect(id);
  };

  const option = (m: ModelPackageManifest, label: string) => {
    const state = states[m.id] ?? "stopped";
    const isSelected = m.id === selected?.id;
    return (
      <button
        key={m.id}
        type="button"
        role="option"
        aria-selected={isSelected}
        aria-label={m.name}
        onClick={() => pick(m.id)}
        className={cn(
          "w-full flex items-center gap-3 px-4 h-11 text-left text-sm cursor-pointer hover:bg-secondary",
          isSelected && "font-semibold"
        )}
      >
        <span className="text-muted-foreground shrink-0">{categoryIcon(m.category, 18)}</span>
        <span className="flex-1 min-w-0 truncate">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatGb(m.hardware_requirements.min_vram_gb, lang)}
        </span>
        <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass[state])} title={t(state)} />
        <span className="w-4 shrink-0 text-ink">{isSelected && <CheckIcon size={16} />}</span>
      </button>
    );
  };

  let memoryNote: React.ReactNode = null;
  if (running && active) {
    const placement = active.placement;
    const offloaded = isOffloaded(placement);
    const parts: string[] = [];
    if (active.reserved_mb > 0) parts.push(`${formatGb(active.reserved_mb / 1024, lang)} ${t("onGpuShort")}`);
    if (active.ram_mb) parts.push(fmt(t("ramModelUses"), { x: formatGb(active.ram_mb / 1024, lang) }));
    memoryNote = (
      <>
        {parts.length > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{parts.join(", ")}</span>
          </>
        )}
        {placement && (
          <>
            <span aria-hidden="true">·</span>
            <span className={cn(offloaded ? "text-warn font-semibold" : undefined)}>
              {placement.kind === "layers" && offloaded
                ? fmt(t("placementLayers"), { on: String(placement.on_gpu), total: String(placement.total) })
                : offloaded
                  ? t("placementRam")
                  : t("placementGpu")}
            </span>
          </>
        )}
      </>
    );
  }

  return (
    <header className="flex items-end gap-4">
      <div ref={ref} className="relative flex-1 min-w-0">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={selected ? `${t("studioPickModel")}: ${selected.name}` : t("studioPickModel")}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 max-w-full font-display text-[34px] leading-[1.1] font-extrabold tracking-[-0.02em] text-foreground cursor-pointer"
        >
          <span className="truncate">{selected?.name ?? t("studioPickModel")}</span>
          <span className="text-muted-foreground shrink-0">
            <ChevronDownIcon size={24} />
          </span>
        </button>

        {selected && (
          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[13px] text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", dotClass[status])} aria-hidden="true" />
            <span className="text-foreground font-semibold">{t(status)}</span>
            {!running && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("startsOnFirstRun")}</span>
              </>
            )}
            {memoryNote}
            {running && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={onRelease}
                  disabled={busy || status === "loading" || status === "unloading"}
                  className="underline underline-offset-2 text-foreground hover:text-ink disabled:opacity-50 disabled:no-underline cursor-pointer"
                >
                  {t("releaseMemory")}
                </button>
              </>
            )}
          </div>
        )}

        {open && (
          <div
            role="listbox"
            aria-label={t("studioPickModel")}
            className="absolute left-0 top-full mt-2 w-[min(420px,90vw)] max-h-[60vh] overflow-y-auto rounded-2xl bg-card text-card-foreground border border-border shadow-pop py-2 z-40"
          >
            {groups.map((entry) =>
              entry.kind === "family" ? (
                <div key={entry.id} role="group" aria-label={entry.name} className="py-1">
                  <div className="px-4 pt-1 pb-1 text-xs font-semibold text-muted-foreground">{entry.name}</div>
                  {entry.members.map((m) => option(m.manifest, m.manifest.family?.variant ?? m.manifest.name))}
                </div>
              ) : (
                option(entry.item.manifest, entry.item.manifest.name)
              )
            )}
            <div className="border-t border-border mt-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenCatalog();
                }}
                className="w-full flex items-center gap-3 px-4 h-11 text-left text-sm cursor-pointer hover:bg-secondary text-muted-foreground"
              >
                <GridIcon size={18} />
                {t("studioOpenCatalog")}
              </button>
            </div>
          </div>
        )}
      </div>

      {onToggleLog && (
        <button
          type="button"
          onClick={onToggleLog}
          aria-pressed={Boolean(logOpen)}
          className={cn(
            "h-9 px-1 flex items-center gap-2 text-[13px] font-semibold cursor-pointer",
            logOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LogIcon size={16} />
          {t("logToggle")}
        </button>
      )}
    </header>
  );
}
