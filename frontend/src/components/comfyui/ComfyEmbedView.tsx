import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  apiComfyEmbedHide,
  apiComfyEmbedShow,
  apiComfyLogs,
  apiComfyOpenExternal,
  apiComfyStart,
  apiComfyStatus,
  apiComfyStop,
  canEmbedComfy,
  type ComfyStatus,
} from "@/lib/ipc";
import { dismissManagerHint, managerHintDismissed } from "@/lib/comfy-prefs";
import { LogIcon } from "@/components/shell/icons";
import { fmt, useI18n } from "@/lib/i18n";

const POLL_MS = 1500;

const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [aria-modal="true"]';

function useOverlayOpen(root: React.RefObject<HTMLElement | null>): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      const found = Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some((el) => !root.current?.contains(el));
      setOpen(found);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-modal", "open"],
    });
    return () => observer.disconnect();
  }, [root]);
  return open;
}

function LemonComfyMark() {
  return (
    <span aria-hidden="true" className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-[#16180B]">
      <svg width="20" height="20" viewBox="0 0 92 92" fill="none">
        <g stroke="#E8F53C" strokeWidth="5" strokeLinecap="round">
          <path d="M30 24H46V40" />
          <path d="M30 68H46V52" />
          <path d="M62 46H72" />
        </g>
        <rect x="8" y="14" width="22" height="20" rx="5" fill="#E8F53C" />
        <rect x="8" y="58" width="22" height="20" rx="5" fill="#E8F53C" />
        <rect x="38" y="36" width="24" height="20" rx="5" fill="#F4F8B8" />
      </svg>
    </span>
  );
}

type ViewState = "running" | "starting" | "evicted" | "crashed" | "stopped";

const barButton = "h-9 cursor-pointer border-0 bg-transparent px-3 text-[13px] font-semibold text-foreground hover:bg-secondary rounded-lg";

export function ComfyEmbedView({ onBack, onManage }: { onBack: () => void; onManage: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ComfyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [hint, setHint] = useState(() => !managerHintDismissed());
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const overlayOpen = useOverlayOpen(root);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await apiComfyStatus();
      if (mounted.current) setStatus(next);
    } catch {
      // keep the last state
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const server = status?.server;
  const reason = server?.stop_reason;
  const view: ViewState =
    server?.state === "running"
      ? "running"
      : server?.state === "starting" || busy
        ? "starting"
        : reason?.kind === "evicted"
          ? "evicted"
          : reason?.kind === "exited"
            ? "crashed"
            : "stopped";

  const followLogs = showLog || view === "starting" || view === "crashed";
  useEffect(() => {
    if (!followLogs) return;
    let cancelled = false;
    const load = async () => {
      try {
        const lines = await apiComfyLogs(200);
        if (!cancelled && mounted.current) setLogs(lines);
      } catch {
        // keep what is shown
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [followLogs]);

  const embedded = canEmbedComfy();
  const visible = embedded && view === "running" && !overlayOpen;
  const lastRect = useRef("");
  const place = useCallback(() => {
    const el = panel.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    if (key === lastRect.current) return;
    lastRect.current = key;
    void apiComfyEmbedShow({ x: r.left, y: r.top, width: r.width, height: r.height }).catch((err: unknown) => {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  useLayoutEffect(() => {
    if (!visible) {
      lastRect.current = "";
      if (embedded) void apiComfyEmbedHide().catch(() => undefined);
      return;
    }
    place();
    const el = panel.current;
    const observer = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(place) : null;
    if (el && observer) observer.observe(el);
    window.addEventListener("resize", place);

    const poll = setInterval(place, 400);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      clearInterval(poll);
    };
  }, [visible, embedded, place]);

  useEffect(
    () => () => {
      if (canEmbedComfy()) void apiComfyEmbedHide().catch(() => undefined);
    },
    []
  );

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err: unknown) {
      if (mounted.current) setError(`${failure}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (mounted.current) setBusy(false);
      void refresh();
    }
  };

  const restart = () => void run(apiComfyStart, "ComfyUI nie uruchomił się");
  const stop = () => void run(apiComfyStop, "Nie udało się zatrzymać ComfyUI");

  const version = status?.installed?.version;
  const meta = [version, view === "running" && server?.port ? `127.0.0.1:${server.port}` : null].filter(Boolean).join(" · ");
  const label =
    view === "running"
      ? t("comfyStatusRunning")
      : view === "starting"
        ? t("comfyStatusStarting")
        : view === "crashed" && reason?.kind === "exited"
          ? fmt(t("comfyStatusExited"), { code: reason.status.replace(/\D+/g, "") || reason.status })
          : t("comfyStatusStopped");
  const dot = view === "running" ? "bg-ok" : view === "starting" ? "bg-warn animate-pulse" : view === "crashed" ? "bg-destructive" : "bg-muted-foreground";

  const card =
    view === "evicted"
      ? {
          dot: "bg-warn",
          title: t("comfyEvictedTitle"),
          text: t("comfyEvictedText"),
          primary: t("comfyEvictedPrimary"),
          secondary: { label: t("comfyEvictedSecondary"), onClick: onBack },
          hint: t("comfyEvictedHint"),
        }
      : view === "crashed"
        ? {
            dot: "bg-destructive",
            title: t("comfyCrashedTitle"),
            text: fmt(t("comfyCrashedText"), {
              code: reason?.kind === "exited" ? reason.status.replace(/\D+/g, "") || reason.status : "?",
            }),
            primary: t("comfyCrashedPrimary"),
            secondary: { label: t("comfyCrashedSecondary"), onClick: () => setShowLog(true) },
            hint: t("comfyCrashedHint"),
          }
        : view === "stopped"
          ? {
              dot: "bg-muted-foreground",
              title: t("comfyStoppedTitle"),
              text: t("comfyStoppedText"),
              primary: t("comfyStoppedPrimary"),
              secondary: { label: t("comfyStoppedSecondary"), onClick: onManage },
              hint: t("comfyStoppedHint"),
            }
          : null;

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col">
      <div className="box-border flex h-14 shrink-0 items-center gap-3.5 border-b border-border bg-card px-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 cursor-pointer items-center gap-2 border-0 bg-transparent text-[13.5px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          {t("comfyBackApps")}
        </button>
        <span aria-hidden="true" className="h-6 w-px bg-border" />
        <LemonComfyMark />
        <h1 className="m-0 font-display text-lg font-extrabold">ComfyUI</h1>
        <div role="status" className="inline-flex items-center gap-2 text-[13px]">
          <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", dot)} />
          <span className="font-semibold">{label}</span>
        </div>
        {meta && <span className="font-mono text-xs text-muted-foreground">{meta}</span>}
        <span className="flex-1" />
        <button type="button" aria-pressed={showLog} onClick={() => setShowLog((v) => !v)} className={cn(barButton, showLog && "bg-secondary")}>
          {t("comfyLog")}
        </button>
        <button type="button" onClick={onManage} className={barButton}>
          {t("comfyManage")}
        </button>
        <button
          type="button"
          onClick={() => void apiComfyOpenExternal().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
          disabled={view !== "running"}
          className={cn(barButton, "disabled:cursor-default disabled:opacity-50")}
        >
          {t("comfyOpenBrowser")}
        </button>
        {(view === "running" || view === "starting") && (
          <button
            type="button"
            onClick={stop}
            className="h-9 cursor-pointer rounded-[10px] border-2 border-foreground bg-transparent px-4 text-[13px] font-bold text-foreground"
          >
            {view === "starting" ? t("cancel") : t("comfyStop")}
          </button>
        )}
        {(view === "evicted" || view === "crashed" || view === "stopped") && (
          <button
            type="button"
            onClick={restart}
            disabled={busy}
            className="h-9 cursor-pointer rounded-[10px] border-0 bg-primary px-[18px] text-[13px] font-extrabold text-primary-foreground disabled:opacity-60"
          >
            {view === "stopped" ? t("comfyStart") : t("comfyRestart")}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="m-0 shrink-0 border-b border-border bg-card px-5 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {view === "running" && hint && (
        <div role="note" className="flex shrink-0 items-center gap-3 bg-primary px-5 py-2.5 text-[12.5px] font-semibold leading-[1.45] text-primary-foreground">
          <span className="min-w-0 flex-1">
            {t("comfyManagerHintPrefix")}{" "}
            <span className="whitespace-nowrap font-mono">--enable-manager</span>. {t("comfyManagerHintSuffix")}
          </span>
          <button
            type="button"
            onClick={() => {
              dismissManagerHint();
              setHint(false);
            }}
            className="h-8 cursor-pointer rounded-lg border-0 bg-transparent px-3 text-[12.5px] font-bold underline"
          >
            {t("comfyDismissHint")}
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#202020]">
        {/* The native ComfyUI view is laid over this empty panel. */}
        <div ref={panel} aria-label={t("comfyPanelAria")} className="absolute inset-0" data-testid="comfy-embed-panel">
          {view === "running" && !embedded && (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[#bdbdbd]">
              {t("comfyBrowserFallback")}
            </div>
          )}
        </div>

        {view === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background p-8">
            <div className="flex w-[560px] max-w-full flex-col items-center gap-[18px] text-center">
              <svg aria-hidden="true" width="64" height="64" viewBox="0 0 120 120" className="animate-spin">
                <circle cx="60" cy="60" r="50" fill="none" stroke="hsl(var(--border))" strokeWidth="9" />
                <path d="M60 10A50 50 0 0 1 110 60" fill="none" stroke="hsl(var(--primary))" strokeWidth="9" strokeLinecap="round" />
              </svg>
              <h2 className="m-0 font-display text-[30px] font-extrabold tracking-[-0.01em]">{t("comfyStartingTitle")}</h2>
              <p className="m-0 max-w-[440px] text-[14.5px] leading-[1.6] text-muted-foreground">
                {t("comfyStartingDesc")}
              </p>
              <pre className="m-0 box-border w-full whitespace-pre-wrap rounded-[14px] border border-border bg-card px-4 py-3.5 text-left font-mono text-[11.5px] leading-[1.6] text-foreground">
                {logs.slice(-4).join("\n") || "…"}
              </pre>
            </div>
          </div>
        )}

        {card && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 p-8">
            <section role="alertdialog" aria-label={card.title} className="flex w-[520px] max-w-full flex-col gap-3.5 rounded-3xl border border-border bg-card px-[30px] py-7 shadow-pop">
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-full", card.dot)} />
                <h2 className="m-0 font-display text-[26px] font-extrabold tracking-[-0.01em]">{card.title}</h2>
              </div>
              <p className="m-0 text-[14.5px] leading-[1.6] text-muted-foreground">{card.text}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={restart}
                  disabled={busy}
                  className="h-12 cursor-pointer rounded-[14px] border-0 bg-primary px-6 text-[15px] font-extrabold text-primary-foreground disabled:opacity-60"
                >
                  {card.primary}
                </button>
                <button
                  type="button"
                  onClick={card.secondary.onClick}
                  className="inline-flex h-12 cursor-pointer items-center rounded-[14px] border-2 border-foreground bg-transparent px-5 text-[15px] font-bold text-foreground"
                >
                  {card.secondary.label}
                </button>
              </div>
              <div className="text-[12.5px] text-muted-foreground">{card.hint}</div>
            </section>
          </div>
        )}
      </div>

      {showLog && (
        <section aria-label={t("comfyLogAria")} className="shrink-0 border-t border-border bg-card px-5 py-3">
          <div className="mb-1.5 flex items-center gap-2 text-[13px] font-bold">
            <LogIcon size={16} /> {t("comfyLog")}
          </div>
          <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6]" data-testid="comfy-embed-logs">
            {logs.length ? logs.join("\n") : t("comfyLogEmpty")}
          </pre>
        </section>
      )}
    </div>
  );
}
