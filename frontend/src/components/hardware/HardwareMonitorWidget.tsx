import { useEffect, useState, useCallback, useRef } from "react";
import { apiGetHardwareStatus, type HardwareStatus } from "@/lib/ipc";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface HardwareMonitorWidgetProps {
  className?: string;
  refreshIntervalMs?: number;
  status?: HardwareStatus | null;
  onStatusChange?: (status: HardwareStatus) => void;
}

function formatMb(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

export function HardwareMonitorWidget({
  className,
  refreshIntervalMs = 3000,
  status: propStatus,
  onStatusChange,
}: HardwareMonitorWidgetProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<HardwareStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiGetHardwareStatus();
      if (isMountedRef.current) {
        setStatus(data);
        setError(null);
        onStatusChangeRef.current?.(data);
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (propStatus) {
      setStatus(propStatus);
      setLoading(false);
      return;
    }
    void fetchStatus();
    if (refreshIntervalMs > 0) {
      const interval = setInterval(() => {
        void fetchStatus();
      }, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchStatus, refreshIntervalMs, propStatus]);

  if (loading && !status) {
    return (
      <div className={cn("p-3 rounded-lg border border-border bg-card/60 text-xs animate-pulse", className)}>
        <div className="h-4 bg-secondary rounded w-3/4 mb-2" />
        <div className="h-2 bg-secondary rounded w-full" />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className={cn("p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-xs text-destructive", className)}>
        <span>{t("hardwareMonitor")}: {error}</span>
      </div>
    );
  }

  if (!status) return null;

  const budget = status.safe_budget_mb > 0 ? status.safe_budget_mb : status.total_vram_mb;
  const usagePercent = budget > 0 ? Math.min(100, Math.round((status.allocated_vram_mb / budget) * 100)) : 0;

  const usageColor =
    usagePercent > 85
      ? "bg-destructive"
      : usagePercent > 60
      ? "bg-warn"
      : "bg-ok";

  const acceleratorBadgeColor =
    status.accelerator.toUpperCase() === "CUDA"
      ? "text-ok border-ok"
      : status.accelerator.toUpperCase() === "ROCM"
      ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
      : status.accelerator.toUpperCase() === "METAL"
      ? "bg-blue-500/10 text-blue-500 border-blue-500/30"
      : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";

  return (
    <div
      role="region"
      aria-label={t("hardwareMonitor")}
      className={cn(
        "flex flex-col gap-3.5 rounded-[20px] bg-card px-[18px] py-4 text-xs font-sans select-none",
        className
      )}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className={cn(
              "px-[7px] py-0.5 rounded-md text-[11px] font-mono font-bold uppercase border-[1.5px] bg-transparent shrink-0",
              acceleratorBadgeColor
            )}
          >
            {status.accelerator}
          </span>
          <span
            className="truncate text-sm font-bold text-foreground"
            title={status.device_name ?? status.accelerator}
          >
            {status.device_name ?? status.accelerator}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchStatus()}
            className="h-8 w-8 p-0 text-base text-muted-foreground hover:text-foreground cursor-pointer"
            title={t("refresh")}
            aria-label={t("refresh")}
          >
            ⟳
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
            aria-expanded={isExpanded}
            aria-label="Toggle hardware details"
          >
            {isExpanded ? "▲" : "▼"}
          </Button>
        </div>
      </div>

      {/* VRAM Progress Bar */}
      <div>
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-muted-foreground font-medium">{t("vramUsage")}</span>
          <span className="font-mono font-semibold text-foreground">
            {formatMb(status.allocated_vram_mb)} / {formatMb(budget)} ({usagePercent}%)
          </span>
        </div>

        <div
          role="progressbar"
          aria-label={t("vramUsage")}
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={status.allocated_vram_mb}
          className="mt-1.5 h-2 w-full bg-secondary rounded overflow-hidden relative"
        >
          <div
            className={cn("h-full transition-all duration-300", usageColor)}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>

      {/* Expandable Technical Details Drawer */}
      {isExpanded && (
        <div className="space-y-3 animate-in fade-in-50 duration-200">
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt className="text-muted-foreground">{t("safeBudget")}</dt>
            <dd className="m-0 font-mono">{formatMb(status.safe_budget_mb)}</dd>
            <dt className="text-muted-foreground">{t("freeVram")}</dt>
            <dd className="m-0 font-mono">{formatMb(status.free_vram_mb)}</dd>
            <dt className="text-muted-foreground">Total VRAM</dt>
            <dd className="m-0 font-mono">{formatMb(status.total_vram_mb)}</dd>
            <dt className="text-muted-foreground">{t("hostRam")}</dt>
            <dd className="m-0 font-mono">{formatMb(status.host_ram_mb)}</dd>
          </dl>

          {/* Active Models in Memory */}
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground block mb-1">
              {t("activeModelsInVram")} ({status.active_models.length})
            </span>
            {status.active_models.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/80 italic">{t("noActiveModelsInVram")}</p>
            ) : (
              <ul className="space-y-1">
                {status.active_models.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between text-[10px] font-mono bg-secondary/50 px-2 py-1 rounded border border-border"
                  >
                    <div className="flex items-center gap-1.5 truncate max-w-[150px]">
                      <span className="font-medium text-foreground truncate">{m.id}</span>
                      <span className={cn(
                        "px-1 py-0.2 rounded text-[9px] uppercase font-bold",
                        m.state === "ready" ? "bg-emerald-500/20 text-emerald-500" :
                        m.state === "inferring" ? "bg-primary/20 text-ink animate-pulse" :
                        "bg-amber-500/20 text-amber-500"
                      )}>
                        {m.state}
                      </span>
                    </div>
                    <span className="text-ink font-semibold shrink-0">{formatMb(m.reserved_mb)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
