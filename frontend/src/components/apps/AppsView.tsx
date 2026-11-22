import { useCallback, useEffect, useRef, useState } from "react";
import { ComfyEmbedView } from "@/components/comfyui/ComfyEmbedView";
import { ComfyUIView } from "@/components/comfyui/ComfyUIView";
import { getComfyOpenMode } from "@/lib/comfy-prefs";
import { APPS, PLANNED_APPS, type AppEntry } from "@/lib/apps";
import { useI18n } from "@/lib/i18n";
import { Page, PageHeader, LineSearch, Notice } from "@/components/shell/Page";
import { SearchIcon } from "@/components/shell/icons";
import { cn } from "@/lib/utils";
import {
  COMFY_DEVICE_LABELS,
  apiComfyOpenExternal,
  apiComfyStart,
  apiComfyStatus,
  apiComfyStop,
  type ComfyStatus,
} from "@/lib/ipc";
import { cancelComfyInstall, startComfyInstall, useComfyInstall } from "@/lib/comfy-store";

const STATUS_POLL_MS = 3000;

function percent(done?: number | null, total?: number | null): number | null {
  if (typeof done !== "number" || typeof total !== "number" || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((done * 100) / total)));
}

export function AppsView() {
  const { t } = useI18n();
  const [openApp, setOpenApp] = useState<AppEntry["id"] | "comfyui-embed" | null>(null);
  const [search, setSearch] = useState("");
  const [comfy, setComfy] = useState<ComfyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = useComfyInstall();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const status = await apiComfyStatus();
      if (mounted.current) setComfy(status);
    } catch {
      // the card shows the last known state
    }
  }, []);

  useEffect(() => {
    if (openApp) return;
    void refresh();
    const timer = setInterval(() => void refresh(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, openApp, install.running]);

  useEffect(() => {
    if (!install.running) void refresh();
  }, [install.running, refresh]);

  const openComfy = async () => {
    if (getComfyOpenMode() === "browser") await apiComfyOpenExternal();
    else setOpenApp("comfyui-embed");
  };

  if (openApp === "comfyui") {
    return <ComfyUIView onBack={() => setOpenApp(null)} onOpen={() => setOpenApp("comfyui-embed")} />;
  }
  if (openApp === "comfyui-embed") {
    return <ComfyEmbedView onBack={() => setOpenApp(null)} onManage={() => setOpenApp("comfyui")} />;
  }

  const query = search.trim().toLowerCase();
  const apps = APPS.filter(
    (a) =>
      !query ||
      a.name.toLowerCase().includes(query) ||
      a.description.toLowerCase().includes(query) ||
      a.tags.some((t) => t.toLowerCase().includes(query))
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

  const comfyActions = () => {
    const installed = comfy?.installed ?? null;
    const state = comfy?.server.state ?? "stopped";
    const progress = install.progress;
    const pct = percent(progress?.bytes_done, progress?.bytes_total);
    const update = installed && install.release?.update_available ? install.release.latest : null;
    const status = install.running
      ? installed
        ? install.automatic
          ? "Automatyczna aktualizacja…"
          : "Aktualizowanie…"
        : "Instalowanie…"
      : !installed
        ? "Nie zainstalowano"
        : state === "running"
          ? "Działa"
          : state === "starting" || busy
            ? "Uruchamianie…"
            : `Zainstalowano ${installed.version}`;
    const dot = install.running ? "bg-warn" : state === "running" ? "bg-ok" : "bg-muted-foreground/50";
    const metaText = installed
      ? ` · ${installed.version ? `zainstalowano ${installed.version}` : ""}${installed.version ? " · " : ""}${COMFY_DEVICE_LABELS[installed.device]}`
      : comfy
        ? ` · zalecana wersja: ${COMFY_DEVICE_LABELS[comfy.recommended.device]}`
        : "";
    const statusLine = (
      <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="app-status-comfyui">
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", dot)} />
        <span className={cn("font-bold", state === "running" ? "text-ok" : "text-foreground")}>{status}</span>
        <span className="text-muted-foreground">
          {state === "running" && comfy?.server.port ? ` · port ${comfy.server.port}` : ""}
          {metaText}
        </span>
        {update && !install.running && (
          <span className="text-muted-foreground">
            {" · "}
            <span className="font-semibold text-foreground">jest nowa wersja {update}</span>
            {install.autoUpdate && state !== "stopped" ? " (zainstaluje się po zatrzymaniu)" : ""}
          </span>
        )}
      </div>
    );

    const primary = (label: string, onClick: () => void, disabled = false) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="h-[52px] cursor-pointer rounded-2xl bg-primary text-base font-extrabold text-primary-foreground disabled:cursor-default disabled:opacity-60"
      >
        {label}
      </button>
    );
    const secondary = (label: string, onClick: () => void, disabled = false) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="h-11 cursor-pointer rounded-[14px] border-2 border-foreground text-sm font-bold text-foreground disabled:cursor-default disabled:opacity-50"
      >
        {label}
      </button>
    );

    let actions: React.ReactNode;
    let progressBar: React.ReactNode = null;
    if (install.running) {
      actions = (
        <button
          type="button"
          onClick={() => void cancelComfyInstall()}
          disabled={install.cancelRequested}
          className="h-[52px] cursor-pointer rounded-2xl bg-secondary text-base font-extrabold disabled:opacity-60"
        >
          Anuluj
        </button>
      );
      progressBar = (
        <div
          className="max-w-[460px]"
          {...(pct !== null
            ? { role: "progressbar", "aria-label": "Instalowanie ComfyUI", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct }
            : {})}
        >
          <div className="h-2 overflow-hidden rounded bg-secondary">
            <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${pct ?? 8}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-xs text-muted-foreground">
            <span title={progress?.message}>{install.cancelRequested ? "Anulowanie…" : (progress?.message ?? "Przygotowywanie…")}</span>
            {pct !== null && <span>{pct}%</span>}
          </div>
        </div>
      );
    } else if (!installed) {
      actions = primary("Zainstaluj", () => void startComfyInstall(null), !comfy);
    } else if (state === "running") {
      actions = (
        <>
          {primary("Otwórz", () => void run(openComfy, "Nie udało się otworzyć ComfyUI"))}
          {secondary("Zatrzymaj", () => void run(apiComfyStop, "Nie udało się zatrzymać ComfyUI"), busy)}
        </>
      );
    } else if (update && state === "stopped") {

      actions = (
        <>
          {primary("Aktualizuj", () => void startComfyInstall(null))}
          {secondary(
            busy ? "Uruchamianie…" : "Uruchom",
            () =>
              void run(async () => {
                await apiComfyStart();
                await openComfy();
              }, "ComfyUI nie uruchomił się"),
            busy
          )}
        </>
      );
    } else {
      actions = primary(
        busy || state === "starting" ? "Uruchamianie…" : "Uruchom",
        () =>
          void run(async () => {
            await apiComfyStart();
            await openComfy();
          }, "ComfyUI nie uruchomił się"),
        busy || state === "starting"
      );
    }
    return { statusLine, actions, progressBar, installed: Boolean(installed), updateHint: Boolean(update) && state !== "stopped" };
  };

  const comfyEntry = apps.find((app) => app.id === "comfyui");
  const comfyRow = comfyEntry ? comfyActions() : null;
  const planned = PLANNED_APPS.filter(
    (a) => !query || a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)
  );

  return (
    <Page>
      <PageHeader
        title="Aplikacje"
        description="Programy, które LemonAI instaluje, aktualizuje i uruchamia za Ciebie. Działają obok modeli z Katalogu."
        actions={
          <LineSearch
            value={search}
            onChange={setSearch}
            placeholder={t("appsSearch")}
            label="Szukaj aplikacji"
            icon={<SearchIcon size={18} />}
          />
        }
      />

      {error && (
        <Notice tone="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      {apps.length === 0 && planned.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Brak aplikacji pasujących do wyszukiwania.</p>
      ) : (
        <>
          {comfyEntry && comfyRow && (
            <section
              aria-label={comfyRow.installed ? t("appsInstalled") : t("appsAvailable")}
              className="flex flex-col gap-3.5"
            >
              <h2 className="text-[13px] font-bold tracking-[.05em] text-muted-foreground">
                {comfyRow.installed ? t("appsInstalled") : t("appsAvailable")}
              </h2>
              <article
                aria-label={comfyEntry.name}
                className="flex flex-wrap items-center gap-7 rounded-[28px] border border-border bg-card p-7"
              >
                <div aria-hidden="true" className="flex h-[132px] w-[132px] shrink-0 items-center justify-center rounded-[26px] bg-rail">
                  <svg width="92" height="92" viewBox="0 0 92 92" fill="none">
                    <g stroke="#E8F53C" strokeWidth="3" strokeLinecap="round">
                      <path d="M30 24H46V40" />
                      <path d="M30 68H46V52" />
                      <path d="M62 46H72" />
                    </g>
                    <rect x="8" y="14" width="22" height="20" rx="5" fill="#E8F53C" />
                    <rect x="8" y="58" width="22" height="20" rx="5" fill="#E8F53C" />
                    <rect x="38" y="36" width="24" height="20" rx="5" fill="#F4F8B8" />
                    <rect x="72" y="36" width="12" height="20" rx="5" fill="#E8F53C" />
                  </svg>
                </div>
                <div className="flex min-w-[340px] flex-[1_1_340px] flex-col gap-2.5">
                  <div className="flex flex-wrap items-baseline gap-3.5">
                    <h3 className="font-display text-[30px] font-extrabold tracking-[-0.02em]">{comfyEntry.name}</h3>
                    <span className="text-[13px] text-muted-foreground">
                      autor: {comfyEntry.author} · licencja {comfyEntry.license}
                    </span>
                  </div>
                  <p className="max-w-[520px] text-sm leading-[1.55] text-muted-foreground">{comfyEntry.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {comfyEntry.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-border px-2.5 py-[3px] text-xs text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {comfyRow.statusLine}
                  {comfyRow.progressBar}
                </div>
                <div className="flex min-w-[200px] flex-col items-stretch gap-2">
                  {comfyRow.actions}
                  {!install.running && (
                    <button
                      type="button"
                      onClick={() => setOpenApp("comfyui")}
                      className="flex h-10 cursor-pointer items-center justify-center text-sm font-bold underline"
                    >
                      Szczegóły
                    </button>
                  )}
                </div>
              </article>
              {comfyRow.updateHint && <p className="text-[13px] text-muted-foreground">{t("appsUpdateHint")}</p>}
            </section>
          )}

          {planned.length > 0 && (
            <section aria-label={t("appsPlanned")} className="flex flex-col">
              <h2 className="mb-1 text-[13px] font-bold tracking-[.05em] text-muted-foreground">{t("appsPlanned")}</h2>
              <p className="mb-2.5 text-[13px] text-muted-foreground">{t("appsPlannedNote")}</p>
              {planned.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-[22px] border-t border-dashed border-border py-5">
                  <div
                    aria-hidden="true"
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border-2 border-dashed border-border text-muted-foreground"
                  >
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={a.icon} />
                    </svg>
                  </div>
                  <div className="min-w-[360px] flex-[1_1_360px]">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xl font-bold tracking-[-0.01em]">{a.name}</span>
                      <span className="rounded-md border-[1.5px] border-dashed border-muted-foreground px-2.5 py-[3px] text-xs font-bold text-ink">
                        {t("appsSoonTag")}
                      </span>
                    </div>
                    <p className="mt-1 max-w-[560px] text-sm leading-normal text-muted-foreground">{a.description}</p>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="h-[46px] cursor-not-allowed rounded-[14px] border-2 border-dashed border-border px-[26px] text-sm font-bold text-muted-foreground"
                  >
                    {t("appsSoon")}
                  </button>
                </div>
              ))}
              <div className="border-t border-dashed border-border" />
            </section>
          )}
        </>
      )}
    </Page>
  );
}
