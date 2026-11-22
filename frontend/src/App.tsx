import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import {
  apiListModels,
  apiGetModelStatus,
  apiLaunchModel,
  apiStopModel,
  apiExecuteInference,
  apiCheckModelUpdates,
  apiHistorySave,
  supportsChat,
  type InferenceEvent,
} from "@/lib/ipc";
import {
  getCurrentUser,
  apiLogout,
  restoreSession,
  apiGetScripts,
  onAuthStateChange,
  type HubUser,
  type HubScript,
} from "@/lib/hub-api";
import type { ModelPackageManifest, ModelState } from "@/types/manifest";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import type { InferenceMetrics } from "@/components/output/ModelOutputViewer";
import { useI18n } from "@/lib/i18n";
import { expandVariants } from "@/lib/catalog";
import { apiGetHardwareStatus, type HardwareStatus } from "@/lib/ipc";
import { UpdateBanner } from "@/components/updates/UpdateBanner";
import { Button } from "@/components/ui/button";
import { Rail, type AppView } from "@/components/shell/Rail";
import { StatusBar } from "@/components/shell/StatusBar";
import { LemonSlice } from "@/components/shell/icons";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { startComfyUpdateWatch, useComfyInstall } from "@/lib/comfy-store";

const ModelHubView = lazy(() =>
  import("@/components/hub/ModelHubView").then((m) => ({ default: m.ModelHubView }))
);
const ChatWorkspace = lazy(() =>
  import("@/components/chat/ChatWorkspace").then((m) => ({ default: m.ChatWorkspace }))
);
const UserProfileView = lazy(() =>
  import("@/components/profile/UserProfileView").then((m) => ({ default: m.UserProfileView }))
);
const SettingsView = lazy(() =>
  import("@/components/settings/SettingsView").then((m) => ({ default: m.SettingsView }))
);
const AppsView = lazy(() =>
  import("@/components/apps/AppsView").then((m) => ({ default: m.AppsView }))
);
const AdminView = lazy(() =>
  import("@/components/admin/AdminView").then((m) => ({ default: m.AdminView }))
);
const HistoryView = lazy(() =>
  import("@/components/history/HistoryView").then((m) => ({ default: m.HistoryView }))
);
const CreatorView = lazy(() =>
  import("@/components/creator/CreatorView").then((m) => ({ default: m.CreatorView }))
);
const AuthModal = lazy(() =>
  import("@/components/auth/AuthModal").then((m) => ({ default: m.AuthModal }))
);
const ScriptUploadModal = lazy(() =>
  import("@/components/hub/ScriptUploadModal").then((m) => ({ default: m.ScriptUploadModal }))
);

export type { AppView };

function submitLabelKey(model: ModelPackageManifest): "generate" | "run" {
  const output = model.ui.output?.type;
  return output === "image" || output === "audio" ? "generate" : "run";
}

function historyParams(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => !(typeof v === "string" && (v.length > 2000 || v.startsWith("data:"))))
  );
}

export function App() {
  const { t } = useI18n();
  const [currentView, setCurrentView] = useState<AppView>("workspace");
  const [currentUser, setCurrentUser] = useState<HubUser | null>(() =>
    getCurrentUser()
  );
  useEffect(() => onAuthStateChange(setCurrentUser), []);
  const isAdmin = currentUser?.role === "admin";
  useEffect(() => {
    if (!isAdmin) setCurrentView((view) => (view === "admin" ? "workspace" : view));
  }, [isAdmin]);

  const comfyInstall = useComfyInstall();
  useEffect(() => startComfyUpdateWatch(), []);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const openAuth = (tab: "login" | "register" = "login") => {
    setAuthTab(tab);
    setIsAuthModalOpen(true);
  };
  const [logOpen, setLogOpen] = useState(false);
  const [hubOnline, setHubOnline] = useState<boolean | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const [publishedScript, setPublishedScript] = useState<HubScript | null>(null);

  const [models, setModels] = useState<ModelPackageManifest[]>([]);
  const modelsRef = useRef<ModelPackageManifest[]>(models);
  modelsRef.current = models;
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  const [historyPreset, setHistoryPreset] = useState<{
    modelId: string;
    params: Record<string, unknown>;
    key: number;
  } | null>(null);
  const [modelStates, setModelStates] = useState<Record<string, ModelState>>({});
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  const [outputTokens, setOutputTokens] = useState<string>("");
  const [lastParams, setLastParams] = useState<Record<string, unknown> | null>(null);
  const [outputImages, setOutputImages] = useState<string[]>([]);
  const [outputAudios, setOutputAudios] = useState<string[]>([]);
  const [outputJson, setOutputJson] = useState<unknown[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isInferring, setIsInferring] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; unit: string } | null>(
    null
  );
  const [metrics, setMetrics] = useState<InferenceMetrics | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [hardwareStatus, setHardwareStatus] = useState<HardwareStatus | null>(null);

  const appendLog = useCallback((logMsg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => {
      const next = [...prev, `[${timestamp}] ${logMsg}`];
      return next.length > 1500 ? next.slice(next.length - 1500) : next;
    });
  }, []);

  const refreshStatuses = useCallback(async (list: ModelPackageManifest[]) => {
    const statusMap: Record<string, ModelState> = {};
    for (const m of list) {
      try {
        statusMap[m.id] = await apiGetModelStatus(m.id);
      } catch {
        statusMap[m.id] = "stopped";
      }
    }
    setModelStates(statusMap);
  }, []);

  const [updateCount, setUpdateCount] = useState(0);
  const installedKey = models.map((m) => `${m.id}@${m.version}`).join(",");
  useEffect(() => {
    let active = true;

    void apiGetScripts({ adult: true })
      .then((scripts) => {
        if (active) setHubOnline(true);
        return installedKey ? apiCheckModelUpdates(expandVariants(scripts).map((s) => s.manifest)) : [];
      })
      .then((updates) => {
        if (active) setUpdateCount(updates.length);
      })
      .catch(() => {
        if (active) setHubOnline(false);
      });
    return () => {
      active = false;
    };
  }, [installedKey]);

  const refreshModels = useCallback(async () => {
    try {
      setIsLoadingModels(true);
      const list = await apiListModels();
      setModels(list);

      setSelectedModelId((prev) =>
        list.some((m) => m.id === prev) ? prev : list[0]?.id ?? ""
      );
      await refreshStatuses(list);
    } catch (err: unknown) {
      appendLog(`[ERROR] Błąd podczas pobierania manifestów: ${String(err)}`);
    } finally {
      setIsLoadingModels(false);
    }
  }, [appendLog, refreshStatuses]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    let cancelled = false;
    void restoreSession().then((user) => {
      if (!cancelled && user) setCurrentUser(user);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchHw = async () => {
      try {
        const s = await apiGetHardwareStatus();
        if (!cancelled) setHardwareStatus(s);
      } catch {
        // ignore in background
      }
    };
    void fetchHw();
    const timer = setInterval(() => { void fetchHw(); }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const selectedModel = models.find((m) => m.id === selectedModelId);
  const currentStatus = selectedModel
    ? modelStates[selectedModel.id] ?? "stopped"
    : "stopped";

  const handleLaunchModel = async (): Promise<boolean> => {
    if (!selectedModel || launchingId !== null) return false;
    const modelId = selectedModel.id;
    setLaunchingId(modelId);
    try {
      appendLog(`[INFO] Uruchamianie instancji ${selectedModel.name}...`);
      setModelStates((prev) => ({ ...prev, [modelId]: "loading" }));
      await apiLaunchModel(modelId);
      appendLog(`[INFO] Instancja ${selectedModel.name} w stanie Ready.`);
      await refreshStatuses(modelsRef.current);
      return true;
    } catch (err: unknown) {
      appendLog(`[ERROR] Nieudane uruchomienie: ${String(err)}`);
      try {
        const real = await apiGetModelStatus(modelId);
        setModelStates((prev) => ({ ...prev, [modelId]: real }));
      } catch {
        setModelStates((prev) => ({ ...prev, [modelId]: "stopped" }));
      }
      return false;
    } finally {
      setLaunchingId(null);
    }
  };

  const ensureSelectedModelRunning = async (): Promise<boolean> => {
    if (currentStatus === "ready" || currentStatus === "inferring") return true;
    if (currentStatus === "loading" || currentStatus === "unloading") {
      appendLog(`[WARN] Model jest w trakcie zmiany stanu (${currentStatus}); spróbuj ponownie za chwilę.`);
      return false;
    }
    appendLog(`[INFO] Model nie jest uruchomiony. Automatyczne uruchamianie i alokacja VRAM...`);
    return handleLaunchModel();
  };

  const handleChatBusyChange = (modelId: string, busy: boolean) => {
    if (busy) {
      setModelStates((prev) => ({ ...prev, [modelId]: "inferring" }));
      return;
    }
    void apiGetModelStatus(modelId)
      .then((real) => setModelStates((prev) => ({ ...prev, [modelId]: real })))
      .catch(() => undefined);
  };

  const handleStopModel = async () => {
    if (!selectedModel) return;
    try {
      appendLog(`[INFO] Zatrzymywanie modelu ${selectedModel.name}...`);
      setModelStates((prev) => ({ ...prev, [selectedModel.id]: "unloading" }));
      await apiStopModel(selectedModel.id);
      setModelStates((prev) => ({ ...prev, [selectedModel.id]: "stopped" }));
      appendLog(`[INFO] Model ${selectedModel.name} zwolniony z pamięci VRAM.`);
    } catch (err: unknown) {
      appendLog(`[ERROR] Błąd zatrzymywania: ${String(err)}`);
      await refreshStatuses(modelsRef.current);
    }
  };

  const handleExecuteInference = async (
    payload: Record<string, unknown>,
    signal: AbortSignal
  ) => {
    if (!selectedModel) return;
    const modelId = selectedModel.id;
    const modelName = selectedModel.name;

    const keep = (dataUrl: string) => {
      void apiHistorySave(modelId, modelName, dataUrl, historyParams(payload)).catch((err: unknown) =>
        appendLog(`[WARN] Nie zapisano wyniku w historii: ${String(err)}`)
      );
    };

    if (currentStatus === "loading" || currentStatus === "unloading") {
      appendLog(`[WARN] Model jest w trakcie zmiany stanu (${currentStatus}); spróbuj ponownie za chwilę.`);
      return;
    }
    if (currentStatus === "stopped") {
      appendLog(
        `[INFO] Model nie jest uruchomiony. Automatyczne uruchamianie i alokacja VRAM...`
      );
      const launched = await handleLaunchModel();
      if (!launched) {
        return;
      }
    }

    setIsInferring(true);
    setLastParams(historyParams(payload));
    setModelStates((prev) => ({ ...prev, [modelId]: "inferring" }));
    setOutputTokens("");
    setOutputImages([]);
    setOutputAudios([]);
    setOutputJson([]);
    setProgress(null);
    setMetrics(null);

    const startTime = performance.now();
    let firstTokenTime: number | null = null;
    let ttftMs: number | undefined = undefined;
    let tokenCount = 0;

    appendLog(`[INFO] Rozpoczęto zadanie inferencji dla modelu '${modelId}'`);

    let reportedError = false;
    const onEvent = (event: InferenceEvent) => {
      switch (event.kind) {
        case "token": {
          const now = performance.now();
          if (firstTokenTime === null) {
            firstTokenTime = now;
            ttftMs = Math.round(now - startTime);
          }
          tokenCount++;
          const elapsedSec = Math.max(0.05, (now - firstTokenTime) / 1000);
          const liveTps = Number((tokenCount / elapsedSec).toFixed(1));
          setMetrics({
            ttftMs,
            tps: liveTps,
            totalTokens: tokenCount,
            durationMs: Math.round(now - startTime),
          });
          setOutputTokens((prev) => prev + event.text);
          break;
        }
        case "image":
          setOutputImages((prev) => [...prev, event.data_url]);
          keep(event.data_url);
          break;
        case "audio":
          setOutputAudios((prev) => [...prev, event.data_url]);
          keep(event.data_url);
          break;
        case "json":
          setOutputJson((prev) => [...prev, event.value]);
          break;
        case "progress":
          setProgress({ current: event.current, total: event.total, unit: event.unit });
          break;
        case "usage":

          if (event.completion_tokens > 0) {
            tokenCount = event.completion_tokens;
            setMetrics((prev) => ({ ...(prev ?? {}), totalTokens: event.completion_tokens }));
          }
          break;
        case "log":
          appendLog(event.message);
          break;
        case "error":
          reportedError = true;
          appendLog(`[ERROR] ${event.message}`);
          break;
        case "done":
          break;
      }
    };

    try {
      await apiExecuteInference(modelId, payload, { onEvent, signal });
      if (!reportedError) {
        appendLog(`[INFO] Inferencja zakończona pomyślnie.`);
      }
    } catch (err: unknown) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        appendLog(`[WARN] Inferencja przerwana przez użytkownika.`);
      } else if (!reportedError) {
        appendLog(`[ERROR] Błąd inferencji: ${String(err)}`);
      }
    } finally {
      setIsInferring(false);
      setProgress(null);
      const endTime = performance.now();
      const finalDurationMs = Math.round(endTime - startTime);
      const totalElapsedSec =
        firstTokenTime !== null
          ? Math.max(0.05, (endTime - firstTokenTime) / 1000)
          : Math.max(0.05, finalDurationMs / 1000);
      const finalTps =
        tokenCount > 0 ? Number((tokenCount / totalElapsedSec).toFixed(1)) : undefined;

      setMetrics((prev) => {
        if (!prev && tokenCount === 0 && !ttftMs) {
          return {
            durationMs: finalDurationMs,
          };
        }
        return {
          ttftMs: prev?.ttftMs ?? ttftMs,
          tps: finalTps ?? prev?.tps,
          totalTokens: tokenCount || prev?.totalTokens || 0,
          durationMs: finalDurationMs,
        };
      });
      try {
        const real = await apiGetModelStatus(modelId);
        setModelStates((prev) => ({ ...prev, [modelId]: real }));
      } catch {
        setModelStates((prev) => ({ ...prev, [modelId]: "ready" }));
      }
    }
  };

  const handleModelInstalled = (manifest: ModelPackageManifest) => {
    setModels((prev) => {
      const idx = prev.findIndex((m) => m.id === manifest.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = manifest;
        return next;
      }
      return [...prev, manifest];
    });
    setModelStates((prev) => ({ ...prev, [manifest.id]: "stopped" }));
    appendLog(`[INFO] Zainstalowano model '${manifest.name}' (${manifest.id}).`);
  };

  const handleModelUninstalled = (modelId: string) => {
    const name = models.find((m) => m.id === modelId)?.name ?? modelId;
    setModels((prev) => prev.filter((m) => m.id !== modelId));
    setModelStates((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
    setSelectedModelId((prev) => (prev === modelId ? "" : prev));
    appendLog(`[INFO] Odinstalowano model '${name}' (${modelId}).`);
  };

  const handleOpenInWorkspace = (modelId: string) => {
    setSelectedModelId(modelId);
    setCurrentView("workspace");
  };

  const handleScriptUploaded = (script: HubScript) => {
    setIsUploadModalOpen(false);
    appendLog(`[INFO] Opublikowano '${script.name}' w Hubie jako '${script.slug}'. Instalowanie lokalnie...`);
    setPublishedScript(script);
    setCurrentView("hub");
  };

  const handleLogout = () => {
    void apiLogout();
    setCurrentUser(null);
    appendLog("[INFO] Wylogowano z konta LemonAI Hub.");
  };

  const activeSummary =
    selectedModel && hardwareStatus
      ? hardwareStatus.active_models.find((m) => m.id === selectedModel.id) ?? null
      : null;

  const navigate = (view: AppView) => {
    if (view === "profile" && !currentUser) {
      openAuth("login");
      return;
    }
    setCurrentView(view);
  };

  const viewFallback = (
    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      {t("loading")}
    </div>
  );

  const studioHeader = (
    <StudioHeader
      models={models}
      selected={selectedModel}
      states={modelStates}
      onSelect={setSelectedModelId}
      active={activeSummary}
      busy={selectedModel ? launchingId === selectedModel.id : false}
      onRelease={() => void handleStopModel()}
      onOpenCatalog={() => setCurrentView("hub")}
      logOpen={logOpen}
      onToggleLog={selectedModel && supportsChat(selectedModel) ? undefined : () => setLogOpen((o) => !o)}
    />
  );

  const studio = (
    <main
      className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden"
    >
      {models.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
          <LemonSlice size={120} />
          <h1 className="text-[22px] font-extrabold tracking-tight">
            {isLoadingModels ? t("loading") : t("studioNoModelsTitle")}
          </h1>
          {!isLoadingModels && (
            <>
              <p className="text-sm text-muted-foreground max-w-[380px]">{t("studioNoModelsHint")}</p>
              <Button size="lg" onClick={() => setCurrentView("hub")}>
                {t("studioOpenCatalog")}
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          {selectedModel && supportsChat(selectedModel) ? (

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={viewFallback}>
                <ChatWorkspace
                  key={selectedModel.id}
                  model={selectedModel}
                  status={currentStatus}
                  onEnsureRunning={ensureSelectedModelRunning}
                  onBusyChange={(busy) => handleChatBusyChange(selectedModel.id, busy)}
                  onLog={appendLog}
                  logs={logs}
                  header={studioHeader}
                />
              </Suspense>
            </div>
          ) : (
            selectedModel ? (
              <StudioWorkspace
                model={selectedModel}
                header={studioHeader}
                submitLabel={t(submitLabelKey(selectedModel))}
                onExecute={handleExecuteInference}
                isExecuting={isInferring || launchingId === selectedModel.id}
                presetValues={historyPreset?.modelId === selectedModel.id ? historyPreset.params : null}
                presetKey={historyPreset?.modelId === selectedModel.id ? historyPreset.key : 0}
                tokens={outputTokens}
                images={outputImages}
                audios={outputAudios}
                jsonValues={outputJson}
                logs={logs}
                logOpen={logOpen}
                onClearLogs={() => setLogs([])}
                isStreaming={isInferring}
                progress={progress}
                metrics={metrics}
                lastParams={lastParams}
                onOpenHistory={() => setCurrentView("history")}
              />
            ) : (
              <p className="p-8 text-sm text-muted-foreground">{t("noActiveModel")}</p>
            )
          )}
        </>
      )}
    </main>
  );

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
      <div className="flex flex-1 min-h-0">
        <Rail
          view={currentView}
          onNavigate={navigate}
          updateCount={updateCount}
          appUpdate={Boolean(comfyInstall.release?.update_available) && !comfyInstall.running}
          currentUser={currentUser}
          onSignIn={() => openAuth("login")}
          onPublish={() => setIsUploadModalOpen(true)}
          onLogout={handleLogout}
        />

        <div className="flex-1 min-w-0 flex flex-col">
          <UpdateBanner />
          <Suspense fallback={viewFallback}>
            {currentView === "admin" && currentUser && isAdmin ? (
              <AdminView currentUser={currentUser} />
            ) : currentView === "profile" ? (
              <UserProfileView
                currentUser={currentUser}
                onUserUpdated={(updated) => setCurrentUser(updated)}
                onLoggedOut={handleLogout}
                onOpenUploadModal={() => setIsUploadModalOpen(true)}
              />
            ) : currentView === "settings" ? (
              <SettingsView
                currentUser={currentUser}
                onSignIn={() => openAuth("login")}
                onCreateAccount={() => openAuth("register")}
                onOpenProfile={() => setCurrentView("profile")}
                onLogout={handleLogout}
              />
            ) : currentView === "apps" ? (
              <AppsView />
            ) : currentView === "history" ? (
              <HistoryView
                models={models.map((m) => ({ id: m.id, name: m.name }))}
                onOpenStudio={() => setCurrentView("workspace")}
                onUseSettings={(entry) => {
                  if (models.some((m) => m.id === entry.model_id)) {
                    setSelectedModelId(entry.model_id);
                    setHistoryPreset({ modelId: entry.model_id, params: entry.params ?? {}, key: Date.now() });
                  }
                  setCurrentView("workspace");
                }}
              />
            ) : currentView === "creator" ? (
              <CreatorView
                installedModels={models}
                currentUser={currentUser}
                onSignIn={() => openAuth("login")}
                onModelInstalled={handleModelInstalled}
                onOpenInStudio={handleOpenInWorkspace}
                onPublishedToHub={handleScriptUploaded}
              />
            ) : currentView === "hub" ? (
              <ModelHubView
                installedModelIds={models.map((m) => m.id)}
                installedModels={models}

                availableVramGb={
                  hardwareStatus ? Number(((hardwareStatus.safe_budget_mb || hardwareStatus.free_vram_mb) / 1024).toFixed(2)) : undefined
                }
                ramGb={hardwareStatus && hardwareStatus.host_ram_mb > 0 ? hardwareStatus.host_ram_mb / 1024 : undefined}
                memoryMode={hardwareStatus?.memory_mode}
                onModelInstalled={handleModelInstalled}
                onModelUninstalled={handleModelUninstalled}
                onOpenInWorkspace={handleOpenInWorkspace}
                onOpenUploadModal={() => setIsUploadModalOpen(true)}
                currentUser={currentUser}
                publishedScript={publishedScript}
                onPublishedScriptHandled={() => setPublishedScript(null)}
              />
            ) : (
              studio
            )}
          </Suspense>
        </div>
      </div>

      <StatusBar status={hardwareStatus} onStatusChange={(s) => setHardwareStatus(s)} hubOnline={hubOnline} />

      {/* Global Modals */}
      {isAuthModalOpen && (
        <Suspense fallback={null}>
          <AuthModal
            isOpen={isAuthModalOpen}
            initialTab={authTab}
            onClose={() => setIsAuthModalOpen(false)}
            onAuthSuccess={(user) => {
              setCurrentUser(user);
              setIsAuthModalOpen(false);
              appendLog(`[INFO] Zalogowano pomyślnie jako ${user.username}`);
            }}
          />
        </Suspense>
      )}

      {isUploadModalOpen && (
        <Suspense fallback={null}>
          <ScriptUploadModal
            isOpen={isUploadModalOpen}
            onClose={() => setIsUploadModalOpen(false)}
            onScriptUploaded={handleScriptUploaded}
            currentUser={currentUser}
            onOpenAuth={() => {
              setIsUploadModalOpen(false);
              openAuth("login");
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
