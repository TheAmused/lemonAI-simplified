import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DialogFooter, DialogStatus } from "@/components/ui/dialog-parts";
import { linkButton, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { cn } from "@/lib/utils";
import { Notice, Page, PageHeader, ProgressLine, Section } from "@/components/shell/Page";
import { CheckIcon, LogIcon } from "@/components/shell/icons";
import { InfoTip } from "@/components/ui/info-tip";
import { getComfyOpenMode, setComfyOpenMode, type ComfyOpenMode } from "@/lib/comfy-prefs";
import {
  COMFY_DEVICE_LABELS,
  apiComfyLocation,
  apiComfyLogs,
  apiComfyOpen,
  apiComfyOpenExternal,
  apiComfyStart,
  apiComfyStatus,
  apiComfyStop,
  apiComfySetLocation,
  apiComfyUninstall,
  pickFolder,
  type ComfyDevice,
  type ComfyLocationInfo,
  type ComfyProgress,
  type ComfyStage,
  type ComfyStatus,
} from "@/lib/ipc";
import {
  cancelComfyInstall,
  checkComfyRelease,
  clearComfyOutcome,
  loadComfyAutoUpdate,
  setComfyAutoUpdate,
  startComfyInstall,
  useComfyInstall,
} from "@/lib/comfy-store";

const STAGES: { stage: ComfyStage; label: string }[] = [
  { stage: "release", label: "Wyszukiwanie najnowszej wersji" },
  { stage: "download", label: "Pobieranie" },
  { stage: "extract", label: "Rozpakowywanie" },
  { stage: "manager", label: "ComfyUI-Manager" },
  { stage: "check", label: "Test uruchomienia" },
];

const STAGE_ORDER: Record<ComfyStage, number> = {
  release: 0,
  download: 1,
  verify: 1,
  extract: 2,
  python: 2,
  git: 3,
  manager: 3,
  custom_nodes: 3,
  check: 4,
  move: 0,
  done: 5,
};

const STATUS_POLL_MS = 3000;

function percent(done?: number | null, total?: number | null): number | null {
  if (typeof done !== "number" || typeof total !== "number" || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((done * 100) / total)));
}

export function formatGb(bytes: number | null | undefined): string {
  if (typeof bytes !== "number") return "?";
  return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
}

function devicesFor(status: ComfyStatus): ComfyDevice[] {
  const all: ComfyDevice[] = ["nvidia", "nvidia_legacy", "amd", "intel", "apple", "cpu"];

  return status.flavor === "portable" ? all.filter((d) => d !== "apple") : all;
}

export interface ComfyUIViewProps {

  onBack?: () => void;

  onOpen?: () => void;
}

export function ComfyUIView({ onBack, onOpen }: ComfyUIViewProps = {}) {
  const [openMode, setOpenMode] = useState<ComfyOpenMode>(getComfyOpenMode);
  const install = useComfyInstall();
  const [status, setStatus] = useState<ComfyStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [device, setDevice] = useState<ComfyDevice | "auto">("auto");
  const [busy, setBusy] = useState<"start" | "stop" | "uninstall" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const release = install.release;
  const [checking, setChecking] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [keepData, setKeepData] = useState(true);
  const [installSize, setInstallSize] = useState<number | null>(null);

  const [move, setMove] = useState<{ picked: string; info: ComfyLocationInfo; current: ComfyLocationInfo } | null>(null);
  const [moveExisting, setMoveExisting] = useState(true);
  const [moving, setMoving] = useState<ComfyProgress | null>(null);
  const mounted = useRef(true);
  const checkedOnce = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await apiComfyStatus();
      if (mounted.current) {
        setStatus(next);
        setLoadError(null);
      }
    } catch (err: unknown) {
      if (mounted.current) setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const checkUpdate = useCallback(async (quiet: boolean) => {
    setChecking(true);
    try {

      await checkComfyRelease(!quiet);
    } catch (err: unknown) {
      if (mounted.current && !quiet) {
        setActionError(`Nie udało się sprawdzić aktualizacji: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (status?.installed && !checkedOnce.current && !install.running) {
      checkedOnce.current = true;
      void checkUpdate(true);
      void loadComfyAutoUpdate().catch(() => undefined);
    }
  }, [status?.installed, install.running, checkUpdate]);

  useEffect(() => {
    if (!install.outcome) return;
    const outcome = install.outcome;
    clearComfyOutcome();
    if (outcome.ok) {
      setNotice(
        outcome.automatic
          ? `ComfyUI został automatycznie zaktualizowany do ${outcome.installed.version}.`
          : `ComfyUI ${outcome.installed.version} jest gotowy. Kliknij „Uruchom”.`
      );
      setActionError(null);
    } else if (/cancelled/i.test(outcome.error)) {
      setNotice("Instalacja została anulowana. Pobrane dane zostały zachowane — ponowna próba wznowi pobieranie.");
    } else {
      setActionError(
        `${outcome.automatic ? "Automatyczna aktualizacja" : "Instalacja"} nie powiodła się: ${outcome.error}`
      );
    }
    void refresh();
  }, [install.outcome, refresh]);

  const serverState = status?.server.state ?? "stopped";
  const followLogs = showLogs || serverState === "starting" || busy === "start";
  useEffect(() => {
    if (!followLogs) return;
    let cancelled = false;
    const load = async () => {
      try {
        const lines = await apiComfyLogs(400);
        if (!cancelled && mounted.current) setLogs(lines);
      } catch {
        // keep what is shown
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [followLogs]);

  const handleInstall = () => {
    setActionError(null);
    setNotice(null);
    void startComfyInstall(device === "auto" ? null : device);
  };

  const openComfy = async () => {
    if (getComfyOpenMode() === "browser") await apiComfyOpenExternal();
    else if (onOpen) onOpen();
    else await apiComfyOpen();
  };

  const handleStart = async () => {
    setBusy("start");
    setActionError(null);
    setNotice(null);
    try {
      await apiComfyStart();
      await refresh();
      await openComfy();
    } catch (err: unknown) {
      if (mounted.current) {
        setActionError(`ComfyUI nie uruchomił się: ${err instanceof Error ? err.message : String(err)}`);
        setShowLogs(true);
      }
    } finally {
      if (mounted.current) setBusy(null);
      void refresh();
    }
  };

  const handleStop = async () => {
    setBusy("stop");
    setActionError(null);
    try {
      await apiComfyStop();
    } catch (err: unknown) {
      if (mounted.current) setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setBusy(null);
      void refresh();
    }
  };

  const handleOpen = async () => {
    try {
      await openComfy();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const chooseFolder = async () => {
    setActionError(null);
    setNotice(null);
    try {
      const picked = await pickFolder("Gdzie zainstalować ComfyUI?");
      if (!picked) return;
      const [info, current] = await Promise.all([apiComfyLocation(picked), apiComfyLocation(null)]);
      if (!info.writable) {
        setActionError(`LemonAI nie może zapisywać w folderze ${info.root}.`);
        return;
      }
      setMoveExisting(true);
      setMove({ picked, info, current });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!confirmUninstall) return;
    let active = true;
    apiComfyLocation(null)
      .then((info) => active && setInstallSize(info.size_bytes))
      .catch(() => active && setInstallSize(null));
    return () => {
      active = false;
    };
  }, [confirmUninstall]);

  const applyLocation = async (picked: string | null, moveFiles: boolean) => {

    setMoving({ stage: "move", message: "Przygotowywanie…" });
    setActionError(null);
    try {
      const next = await apiComfySetLocation(picked, moveFiles, (p) => {
        if (mounted.current) setMoving(p);
      });
      if (mounted.current) {
        setStatus(next);
        setNotice(`ComfyUI jest teraz w folderze ${next.root}.`);
      }
    } catch (err: unknown) {
      if (mounted.current) setActionError(`Nie udało się zmienić folderu: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (mounted.current) {
        setMoving(null);
        setMove(null);
      }
      void refresh();
    }
  };

  const handleUninstall = async () => {
    setConfirmUninstall(false);
    setBusy("uninstall");
    setActionError(null);
    try {
      await apiComfyUninstall(keepData);
      if (mounted.current) {
        setNotice(
          keepData
            ? "ComfyUI został odinstalowany. Modele, węzły i wyniki zostały zachowane."
            : "ComfyUI został odinstalowany razem z danymi."
        );
      }
    } catch (err: unknown) {
      if (mounted.current) setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setBusy(null);
      void refresh();
    }
  };

  if (!status) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {loadError ? `Nie można odczytać stanu ComfyUI: ${loadError}` : "Ładowanie…"}
      </div>
    );
  }

  const locationSection = (
    <Section
      id="comfy-folder"
      title="Folder"
      label="Folder ComfyUI"
      hint={status.flavor === "portable" ? "ComfyUI z modelami potrzebuje zwykle 10–50 GB." : undefined}
      actions={
        <Button variant="outline" size="sm" onClick={() => void chooseFolder()} disabled={busy !== null || moving !== null || install.running}>
          Zmień folder…
        </Button>
      }
    >
      <p className="font-mono text-[13px] break-all" data-testid="comfy-root">{status.root}</p>
      <p className="text-muted-foreground">Wolne miejsce na dysku: {formatGb(status.free_bytes)}</p>
      {moving && (
        <ProgressLine
          percent={percent(moving.bytes_done, moving.bytes_total)}
          message={moving.message}
          label="Przenoszenie ComfyUI"
        />
      )}
    </Section>
  );

  const stopReason = status.server.stop_reason;
  const installed = status.installed;
  const recommendedLabel = COMFY_DEVICE_LABELS[status.recommended.device];
  const progress = install.progress;
  const pct = percent(progress?.bytes_done, progress?.bytes_total);
  const currentStage = progress ? STAGE_ORDER[progress.stage] : 0;
  const stateText =
    serverState === "running"
      ? `Działa (port ${status.server.port})`
      : serverState === "starting" || busy === "start"
        ? "Uruchamianie…"
        : "Zatrzymany";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Page width={940} className="gap-6">
        <PageHeader
          before={
            onBack && (
              <button
                type="button"
                onClick={onBack}
                className="self-start text-sm font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ← Aplikacje
              </button>
            )
          }
          title="ComfyUI"
          description="Węzłowy generator obrazów i wideo. LemonAI pobiera najnowszą wersję dla Twojej karty graficznej, instaluje ComfyUI-Manager, sprawdza, czy wszystko działa."
        />

        {notice && <Notice tone="ok">{notice}</Notice>}
        {stopReason && serverState === "stopped" && (
          <Notice>
            {stopReason.kind === "evicted"
              ? "ComfyUI został zatrzymany, bo model uruchomiony w LemonAI potrzebował karty graficznej. Uruchom go ponownie, gdy model nie będzie już potrzebny."
              : `ComfyUI zakończył działanie (${stopReason.status}). Szczegóły są w dzienniku.`}
          </Notice>
        )}
        {actionError && <Notice tone="error">{actionError}</Notice>}

        <div>
          {install.running ? (
            <Section
              id="comfy-install"
              title={installed ? "Aktualizowanie…" : "Instalowanie…"}
              label="Instalacja ComfyUI"
              actions={
                <Button variant="outline" size="sm" onClick={() => void cancelComfyInstall()} disabled={install.cancelRequested}>
                  Anuluj
                </Button>
              }
            >
              <ol className="flex flex-col gap-1.5">
                {STAGES.map((s, i) => (
                  <li
                    key={s.stage}
                    className={cn(
                      "flex items-center gap-2.5",
                      i < currentStage ? "text-foreground" : i === currentStage ? "text-foreground font-bold" : "text-muted-foreground"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-5 w-5 rounded-full flex items-center justify-center shrink-0",
                        i < currentStage ? "bg-ok text-white" : i === currentStage ? "bg-primary text-primary-foreground" : "bg-secondary"
                      )}
                    >
                      {i < currentStage ? <CheckIcon size={12} strokeWidth={3} /> : null}
                    </span>
                    {s.label}
                  </li>
                ))}
              </ol>
              <ProgressLine
                percent={pct}
                message={install.cancelRequested ? "Anulowanie…" : (progress?.message ?? "Przygotowywanie…")}
                label="Postęp instalacji ComfyUI"
              />
              <button
                type="button"
                className="self-start text-[13px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => setShowLogs((v) => !v)}
              >
                {showLogs ? "Ukryj szczegóły" : "Pokaż szczegóły"}
              </button>
            </Section>
          ) : !installed ? (
            <>
              <Section
                id="comfy-install"
                title="Instalacja"
                label="Instalacja ComfyUI"
                hint={
                  status.flavor === "portable"
                    ? "Oficjalny pakiet przenośny (ok. 2–3 GB, po rozpakowaniu ok. 8 GB) — z własnym Pythonem, bez zmian w systemie."
                    : "Kod ComfyUI, a Python i PyTorch w osobnym środowisku."
                }
              >
                <p>
                  Wykryto: <span className="font-semibold">{status.recommended.reason}</span> → wersja{" "}
                  <span className="font-semibold">{recommendedLabel}</span>.
                </p>
                {status.recommended.warnings.map((w) => (
                  <p key={w} className="text-warn font-semibold">{w}</p>
                ))}
                <label className="flex items-center gap-3">
                  <span className="text-muted-foreground">Wersja dla</span>
                  <select
                    value={device}
                    onChange={(e) => setDevice(e.target.value as ComfyDevice | "auto")}
                    className="h-10 px-3 rounded-xl border border-border bg-card text-sm cursor-pointer"
                    aria-label="Wersja ComfyUI"
                  >
                    <option value="auto">Automatycznie ({recommendedLabel})</option>
                    {devicesFor(status).map((d) => (
                      <option key={d} value={d}>{COMFY_DEVICE_LABELS[d]}</option>
                    ))}
                  </select>
                </label>
                <Button size="lg" className="self-start" onClick={handleInstall} disabled={moving !== null}>
                  Zainstaluj ComfyUI
                </Button>
              </Section>
              {locationSection}
            </>
          ) : (
            <>
              <Section
                id="comfy-main"
                title={`ComfyUI ${installed.version}`}
                label="ComfyUI"
                hint={
                  <>
                    {COMFY_DEVICE_LABELS[installed.device]}
                    <br />
                    {installed.manager ? `ComfyUI-Manager: ${installed.manager.replace("comfyui_manager==", "v")}` : "ComfyUI-Manager"}
                  </>
                }
              >
                <p className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 rounded-full",
                      serverState === "running" ? "bg-ok" : serverState === "starting" || busy === "start" ? "bg-warn animate-pulse" : "bg-muted-foreground/40"
                    )}
                  />
                  <span className="font-semibold" data-testid="comfy-server-state">{stateText}</span>
                </p>
                {installed.warnings.map((w) => (
                  <p key={w} className="text-warn font-semibold break-words">{w}</p>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  {serverState === "running" ? (
                    <>
                      <Button size="lg" onClick={() => void handleOpen()}>
                        Otwórz ComfyUI
                      </Button>
                      <Button variant="outline" size="lg" onClick={() => void handleStop()} disabled={busy !== null}>
                        Zatrzymaj
                      </Button>
                    </>
                  ) : (
                    <Button size="lg" onClick={() => void handleStart()} disabled={busy !== null || serverState === "starting"}>
                      {busy === "start" || serverState === "starting" ? "Uruchamianie…" : "Uruchom"}
                    </Button>
                  )}
                  <button
                    type="button"
                    aria-pressed={showLogs}
                    onClick={() => setShowLogs((v) => !v)}
                    className={cn(
                      "h-9 px-1 inline-flex items-center gap-2 text-[13px] font-semibold cursor-pointer",
                      showLogs ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <LogIcon size={16} />
                    Dziennik
                  </button>
                </div>
                <p className="text-muted-foreground">
                  Pierwsze uruchomienie trwa dłużej. ComfyUI zajmuje kartę graficzną: uruchomienie modelu
                  w LemonAI zatrzyma ComfyUI, a uruchomienie ComfyUI zatrzyma modele.
                </p>
              </Section>

              <Section
                id="comfy-updates"
                title="Aktualizacje"
                label="Aktualizacje"
                actions={
                  <Button variant="outline" size="sm" onClick={() => void checkUpdate(false)} disabled={checking}>
                    {checking ? "Sprawdzanie…" : "Sprawdź"}
                  </Button>
                }
              >
                {release?.update_available ? (
                  <>
                    <p>
                      Dostępna jest wersja <span className="font-bold">{release.latest}</span>. Modele, węzły i
                      wyniki zostaną zachowane, a zależności węzłów zainstalowane ponownie.
                      {install.autoUpdate && " Zainstaluje się sama, gdy ComfyUI nie będzie działać."}
                    </p>
                    <Button className="self-start" onClick={handleInstall}>
                      Aktualizuj
                    </Button>
                  </>
                ) : release ? (
                  <p className="text-muted-foreground">Masz najnowszą wersję ({release.latest}).</p>
                ) : (
                  <p className="text-muted-foreground">LemonAI sprawdza nowe wersje co kilka godzin.</p>
                )}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={install.autoUpdate}
                    onChange={(e) =>
                      void setComfyAutoUpdate(e.target.checked).catch((err: unknown) =>
                        setActionError(err instanceof Error ? err.message : String(err))
                      )
                    }
                  />
                  <span>
                    <span className="font-semibold">Aktualizuj automatycznie</span>
                    <span className="block text-muted-foreground">
                      Nowa wersja instaluje się, gdy ComfyUI nie działa. Jeśli nie przejdzie testu uruchomienia,
                      zostaje obecna wersja.
                    </span>
                  </span>
                </label>
              </Section>

              <Section id="comfy-manager" title="ComfyUI-Manager" label="ComfyUI-Manager" hint="Dodatek do instalowania węzłów i modeli.">
                <p className="flex flex-wrap items-center gap-2.5">
                  <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ok text-white">
                    <CheckIcon size={12} strokeWidth={3} />
                  </span>
                  <strong>Zainstalowany automatycznie</strong>
                  {installed.manager && <span className="font-mono text-[13px] text-muted-foreground">{installed.manager.replace("comfyui_manager==", "v")}</span>}
                  <InfoTip
                    align="left"
                    text="LemonAI instaluje go przy każdej instalacji i aktualizacji ComfyUI i uruchamia ComfyUI z flagą --enable-manager. W ComfyUI znajdziesz go jako przycisk „Manager” w górnym pasku. Po aktualizacji LemonAI instaluje ponownie zależności zainstalowanych węzłów; jeśli któryś się nie zainstaluje, dostajesz ostrzeżenie."
                  />
                </p>
              </Section>

              <Section id="comfy-opening" title="Otwieranie" label="Otwieranie ComfyUI" hint="Gdzie pokazać interfejs ComfyUI.">
                <fieldset className="m-0 flex flex-col gap-3.5 border-0 p-0">
                  <legend className="sr-only">Gdzie otwierać ComfyUI</legend>
                  {(
                    [
                      ["app", "W oknie LemonAI", "ComfyUI jest widokiem w aplikacji, z paskiem Zatrzymaj, Dziennik i Zarządzaj."],
                      ["browser", "W przeglądarce", "Otwiera adres ComfyUI w Twojej przeglądarce."],
                    ] as const
                  ).map(([mode, title, desc]) => (
                    <label key={mode} className="flex cursor-pointer items-start gap-3.5">
                      <input
                        type="radio"
                        name="comfy-open"
                        checked={openMode === mode}
                        onChange={() => {
                          setOpenMode(mode);
                          setComfyOpenMode(mode);
                        }}
                        className="mt-0.5 h-5 w-5 accent-[hsl(var(--ink))]"
                      />
                      <span>
                        <span className="block text-[15px] font-bold">{title}</span>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">{desc}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </Section>

              {locationSection}

              <Section
                id="comfy-files"
                title="Pliki"
                label="Pliki"
                hint="Modele i węzły możesz też instalować w samym ComfyUI przyciskiem „Manager”."
              >
                <p className="text-muted-foreground">
                  Modele (np. <span className="font-mono">models/checkpoints</span>), węzły, wejścia i wyniki:
                </p>
                <p className="font-mono text-[13px] break-all select-all" data-testid="comfy-data-dir">{status.data_dir}</p>
              </Section>

              <Section id="comfy-remove" title="Usuwanie" label="Usuwanie ComfyUI" hint="Modele, węzły i wyniki możesz zachować.">
                <Button
                  variant="outline"
                  className="self-start text-destructive border-destructive/40"
                  onClick={() => setConfirmUninstall(true)}
                  disabled={busy !== null}
                >
                  Odinstaluj ComfyUI
                </Button>
              </Section>
            </>
          )}
        </div>

        {(showLogs || serverState === "starting" || busy === "start") && (
          <section className="rounded-2xl border border-border bg-card p-4" aria-label="Dziennik ComfyUI">
            <pre className="text-[11px] leading-4 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono" data-testid="comfy-logs">
              {logs.length ? logs.join("\n") : "Brak wpisów."}
            </pre>
          </section>
        )}
      </Page>

      <Modal
        isOpen={move !== null}
        onClose={() => moving === null && setMove(null)}
        title="Zmienić folder ComfyUI?"
        size="md"
        aria-labelledby="comfy-move-title"
      >
        {move && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-[13px] text-muted-foreground">Nowy folder</div>
              <div className="break-all rounded-xl bg-secondary px-4 py-3 font-mono text-[13px]">{move.info.root}</div>
              <div className="mt-1.5 text-[13px] text-muted-foreground">Wolne miejsce: {formatGb(move.info.free_bytes)}</div>
            </div>
            {move.info.existing_install ? (
              <DialogStatus>
                W tym folderze jest już ComfyUI {move.info.existing_install} zainstalowany przez LemonAI — zostanie użyty.
              </DialogStatus>
            ) : (move.current.size_bytes ?? 0) > 0 ? (
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-px h-5 w-5 shrink-0 cursor-pointer accent-[hsl(var(--ink))]"
                  checked={moveExisting}
                  disabled={moving !== null}
                  onChange={(e) => setMoveExisting(e.target.checked)}
                />
                <span className="text-[14.5px] font-semibold leading-[1.45]">
                  Przenieś obecną instalację ({formatGb(move.current.size_bytes)}: program, modele, węzły i wyniki).
                  <span className="mt-0.5 block text-[13px] font-normal leading-normal text-muted-foreground">
                    Bez tego ComfyUI trzeba będzie zainstalować od nowa w nowym folderze.
                  </span>
                </span>
              </label>
            ) : null}
            {!move.info.existing_install && moveExisting && (move.current.size_bytes ?? 0) > (move.info.free_bytes ?? Infinity) && (
              <p className="m-0 text-sm font-bold text-destructive">Na wybranym dysku może zabraknąć miejsca.</p>
            )}
            {moving && (
              <div>
                <div
                  className="h-2 overflow-hidden rounded bg-secondary"
                  role="progressbar"
                  aria-label="Przenoszenie ComfyUI"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent(moving.bytes_done, moving.bytes_total) ?? undefined}
                >
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${percent(moving.bytes_done, moving.bytes_total) ?? 0}%` }} />
                </div>
                <div className="mt-2 flex justify-between gap-3 text-[12.5px] text-muted-foreground">
                  <span>{moving.message}</span>
                  {moving.bytes_total ? (
                    <span className="font-mono">
                      {formatGb(moving.bytes_done)} z {formatGb(moving.bytes_total)}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
            <DialogFooter
              left={
                !move.current.is_default ? (
                  <button type="button" className={cn(linkButton, "font-semibold")} disabled={moving !== null} onClick={() => void applyLocation(null, true)}>
                    Wróć do folderu domyślnego
                  </button>
                ) : undefined
              }
            >
              <button type="button" className={outlineButton} disabled={moving !== null} onClick={() => setMove(null)}>
                Anuluj
              </button>
              <button type="button" className={primaryButton} disabled={moving !== null} onClick={() => void applyLocation(move.picked, moveExisting)}>
                {move.info.existing_install ? "Użyj tego folderu" : moveExisting && (move.current.size_bytes ?? 0) > 0 ? "Przenieś" : "Ustaw folder"}
              </button>
            </DialogFooter>
          </div>
        )}
      </Modal>

      <Modal isOpen={confirmUninstall} onClose={() => setConfirmUninstall(false)} title="Odinstalować ComfyUI?" size="sm" aria-labelledby="comfy-uninstall-title">
        <div className="flex flex-col gap-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-px h-5 w-5 shrink-0 cursor-pointer accent-[hsl(var(--ink))]"
              checked={keepData}
              onChange={(e) => setKeepData(e.target.checked)}
            />
            <span className="text-[14.5px] font-semibold leading-[1.45]">
              Zachowaj modele, węzły, wyniki i ustawienia
              <span className="mt-0.5 block text-[13px] font-normal leading-normal text-muted-foreground">
                Zostaną w folderze {status?.data_dir ?? "danych ComfyUI"}. Po ponownej instalacji wszystko wróci.
              </span>
            </span>
          </label>
          <p className="m-0 text-[13.5px] leading-[1.55] text-muted-foreground">
            Odznacz, aby usunąć także dane{installSize ? ` (ok. ${formatGb(installSize)})` : ""}. Tego nie da się cofnąć.
          </p>
          <DialogFooter>
            <button type="button" className={outlineButton} onClick={() => setConfirmUninstall(false)}>
              Anuluj
            </button>
            <button
              type="button"
              className="h-12 cursor-pointer rounded-[14px] border-0 bg-destructive px-6 text-sm font-extrabold text-destructive-foreground"
              onClick={() => void handleUninstall()}
            >
              Odinstaluj
            </button>
          </DialogFooter>
        </div>
      </Modal>
    </div>
  );
}
