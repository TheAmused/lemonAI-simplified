import { useEffect, useRef, useState } from "react";
import { isOffloaded, type HardwareStatus } from "@/lib/ipc";
import { fmt, useI18n } from "@/lib/i18n";
import { formatGb } from "@/lib/families";
import { cn } from "@/lib/utils";
import { HardwareMonitorWidget } from "@/components/hardware/HardwareMonitorWidget";

export interface StatusBarProps {
  status: HardwareStatus | null;
  onStatusChange?: (status: HardwareStatus) => void;

  hubOnline?: boolean | null;
  version?: string;
}

const gb = (mb: number) => mb / 1024;

function Meter({ label, parts, total }: { label: string; parts: { value: number; className: string }[]; total: number }) {
  const used = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(used)}
      className="w-24 h-[5px] rounded-[3px] bg-secondary overflow-hidden inline-flex"
    >
      {parts.map((part, i) => (
        <span
          key={i}
          className={part.className}
          style={{ width: `${total > 0 ? Math.min(100, (part.value / total) * 100) : 0}%` }}
        />
      ))}
    </span>
  );
}

export function StatusBar({ status, onStatusChange, hubOnline, version = "0.1.0" }: StatusBarProps) {
  const { t, lang } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!detailsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setDetailsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [detailsOpen]);

  const totalVram = status?.total_vram_mb ?? 0;
  const usedVram = status?.allocated_vram_mb ?? 0;
  const totalRam = status?.host_ram_mb ?? 0;
  const available = status?.available_ram_mb;
  const usedRam = available !== undefined && available !== null ? Math.max(0, totalRam - available) : null;
  const modelsRam = (status?.active_models ?? []).reduce((sum, m) => sum + (m.ram_mb ?? 0), 0);
  const offloaded = (status?.active_models ?? []).some((m) => isOffloaded(m.placement));
  const g = (mb: number) => formatGb(gb(mb), lang);

  return (
    <footer
      ref={ref}
      className="relative h-9 shrink-0 flex items-center gap-6 px-5 border-t border-border bg-card text-xs text-muted-foreground whitespace-nowrap overflow-visible z-20"
    >
      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        aria-expanded={detailsOpen}
        aria-haspopup="true"
        className={cn("h-[26px] cursor-pointer rounded-lg px-2 hover:text-foreground", detailsOpen && "bg-secondary")}
      >
        {status?.device_name ?? status?.accelerator ?? "—"}
      </button>

      {status && totalVram > 0 && (
        <span className="flex items-center gap-2">
          VRAM
          <Meter label="VRAM" total={totalVram} parts={[{ value: usedVram, className: "h-full bg-line" }]} />
          <span className="font-mono text-foreground">
            {g(usedVram)} / {g(totalVram)}
          </span>
        </span>
      )}

      {status && totalRam > 0 && usedRam !== null && (
        <span className="flex items-center gap-2">
          RAM
          <Meter
            label="RAM"
            total={totalRam}
            parts={[
              { value: Math.max(0, usedRam - modelsRam), className: "h-full bg-ram-other" },
              { value: Math.min(modelsRam, usedRam), className: offloaded ? "h-full bg-warn" : "h-full bg-line" },
            ]}
          />
          <span className="font-mono text-foreground">
            {g(usedRam)} / {g(totalRam)}
          </span>
          {modelsRam > 0 && (
            <span className={offloaded ? "text-warn font-medium" : undefined}>
              {fmt(t("ramModelUses"), { x: g(modelsRam) })}
            </span>
          )}
        </span>
      )}

      <span className="flex-1" />
      {hubOnline !== null && hubOnline !== undefined && <span>{hubOnline ? t("hubConnectedShort") : t("hubUnavailableShort")}</span>}
      <span>v{version}</span>

      {detailsOpen && (
        <div role="dialog" aria-label="Monitor sprzętu" className="absolute bottom-full left-[88px] mb-1 w-[380px] rounded-[20px] border border-border bg-card shadow-pop whitespace-normal">
          <HardwareMonitorWidget status={status} onStatusChange={onStatusChange} />
        </div>
      )}
    </footer>
  );
}
