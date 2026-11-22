import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstallStep, ModelPackageManifest } from "@/types/manifest";
import {
  apiAiProvidersList,
  apiCivitaiFetchInfo,
  apiGetHardwareStatus,
  apiInstallModel,
  apiManifestExtractFromUrl,
  apiVaultDelete,
  apiVaultList,
  apiVaultSave,
  apiVaultValidate,
  installPercent,
  saveTextFile,
  type AiProviderPublic,
  type CivitaiModelInfo,
  type InstallProgress,
  type SourceSummary,
  type VaultEntry,
} from "@/lib/ipc";
import { apiUploadScript, type HubScript, type HubUser } from "@/lib/hub-api";
import {
  applyRunnerToManifest,
  createDefaultManifest,
  runnerKindFromArchetype,
  slugify,
  type RunnerKind,
} from "@/lib/manifest-builder";
import { useI18n, fmt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DynamicInferenceForm } from "@/components/forms/DynamicInferenceForm";
import { HfFilePicker } from "@/components/hub/HfFilePicker";
import { FormBuilderPanel } from "@/components/creator/FormBuilderPanel";
import { cn } from "@/lib/utils";

export interface CreatorViewProps {
  installedModels: ModelPackageManifest[];
  currentUser: HubUser | null;
  onSignIn: () => void;
  onModelInstalled: (manifest: ModelPackageManifest) => void;
  onOpenInStudio: (modelId: string) => void;
  onPublishedToHub?: (script: HubScript) => void;
}

type CreatorView_ = "editor" | "form";
type EditorTab = "basics" | "form" | "json";
type SourceKind = "hf" | "civitai";

function primaryDownloadStep(manifest: ModelPackageManifest): InstallStep | undefined {
  return manifest.install.find(
    (s) => s.step_type === "hf_download" || s.step_type === "civitai_download"
  );
}

function sourceKindOf(manifest: ModelPackageManifest): SourceKind {
  return primaryDownloadStep(manifest)?.step_type === "civitai_download" ? "civitai" : "hf";
}

function findLoraStep(manifest: ModelPackageManifest): InstallStep | undefined {
  return manifest.install.find(
    (s) =>
      (s.step_type === "hf_download" || s.step_type === "civitai_download") &&
      (s.destination ?? "").toLowerCase().includes("lora")
  );
}

function formatBytesGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 1 : 2)} GB`;
}

export function CreatorView({
  installedModels,
  currentUser,
  onSignIn,
  onModelInstalled,
  onOpenInStudio,
  onPublishedToHub,
}: CreatorViewProps) {
  const { t, lang } = useI18n();

  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [vaultSearch, setVaultSearch] = useState("");
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);

  const [manifest, setManifest] = useState<ModelPackageManifest>(() => createDefaultManifest("gguf"));
  const [rawJson, setRawJson] = useState<string>(() => JSON.stringify(createDefaultManifest("gguf"), null, 2));
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const [view, setView] = useState<CreatorView_>("editor");
  const [formFocus, setFormFocus] = useState(0);
  const [editorTab, setEditorTab] = useState<EditorTab>("basics");
  const [autoOpen, setAutoOpen] = useState(false);
  const [vramBudgetGb, setVramBudgetGb] = useState<number | null>(null);

  const [providers, setProviders] = useState<AiProviderPublic[]>([]);
  const [autoUrl, setAutoUrl] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [modelOverride, setModelOverride] = useState<string>("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [sourceSummary, setSourceSummary] = useState<SourceSummary | null>(null);
  const [extractWarnings, setExtractWarnings] = useState<string[]>([]);

  const [showHfPicker, setShowHfPicker] = useState(false);
  const [civitaiLookupInput, setCivitaiLookupInput] = useState("");
  const [civitaiInfo, setCivitaiInfo] = useState<CivitaiModelInfo | null>(null);
  const [civitaiBusy, setCivitaiBusy] = useState(false);
  const [civitaiError, setCivitaiError] = useState<string | null>(null);

  const [loraEnabled, setLoraEnabled] = useState(false);
  const [loraRepo, setLoraRepo] = useState("");
  const [loraFile, setLoraFile] = useState("");

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingVault, setSavingVault] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [publishing, setPublishing] = useState(false);

  const installedIds = useMemo(() => new Set(installedModels.map((m) => m.id)), [installedModels]);

  const applyManifest = useCallback((next: ModelPackageManifest) => {
    setManifest(next);
    setRawJson(JSON.stringify(next, null, 2));
    setJsonParseError(null);
    const lora = findLoraStep(next);
    setLoraEnabled(Boolean(lora));
    setLoraRepo(lora?.repo_id ?? "");
    setLoraFile(lora?.filename ?? "");
  }, []);

  const refreshVault = useCallback(async () => {
    try {
      const list = await apiVaultList();
      setVaultEntries(list);
    } catch {
      // ignore initial vault read error
    }
  }, []);

  useEffect(() => {
    void apiGetHardwareStatus()
      .then((hw) => {
        if (hw.safe_budget_mb > 0) setVramBudgetGb(hw.safe_budget_mb / 1024);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refreshVault();
    void apiAiProvidersList()
      .then((list) => {
        setProviders(list);
        const def = list.find((p) => p.is_default) ?? list[0];
        if (def) setSelectedProviderId(def.id);
      })
      .catch(() => {});
  }, [refreshVault]);

  useEffect(() => {
    let active = true;
    void apiVaultValidate(manifest)
      .then((errs) => {
        if (active) setValidationErrors(errs);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [manifest]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );

  const runner = runnerKindFromArchetype(manifest.runtime.archetype);
  const sourceKind = sourceKindOf(manifest);
  const primaryStep = primaryDownloadStep(manifest);

  const filteredVault = useMemo(() => {
    const q = vaultSearch.trim().toLowerCase();
    if (!q) return vaultEntries;
    return vaultEntries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.description ?? "").toLowerCase().includes(q)
    );
  }, [vaultEntries, vaultSearch]);

  const withUpdatedPrimaryDownload = (
    install: InstallStep[],
    updater: (step: InstallStep) => InstallStep
  ): InstallStep[] => {
    const idx = install.findIndex(
      (s) => s.step_type === "hf_download" || s.step_type === "civitai_download"
    );
    const nextInstall = [...install];
    if (idx >= 0) {
      nextInstall[idx] = updater(nextInstall[idx]);
    } else {
      nextInstall.push(updater({ step_type: "hf_download", repo_id: "", destination: "weights/model" }));
    }
    return nextInstall;
  };

  const updatePrimaryDownload = (updater: (step: InstallStep) => InstallStep) => {
    applyManifest({ ...manifest, install: withUpdatedPrimaryDownload(manifest.install, updater) });
  };

  const handleSwitchSource = (nextSource: SourceKind) => {
    if (nextSource === sourceKind) return;
    updatePrimaryDownload(() =>
      nextSource === "civitai"
        ? {
            step_type: "civitai_download",
            civitai_model_id: civitaiInfo?.model_id ?? 1,
            civitai_version_id: civitaiInfo?.version_id ?? 1,
            filename: civitaiInfo?.files[0]?.name ?? "model.safetensors",
            destination: `weights/${civitaiInfo?.files[0]?.name ?? "model.safetensors"}`,
            sha256: civitaiInfo?.files[0]?.sha256 ?? undefined,
          }
        : {
            step_type: "hf_download",
            repo_id: "owner/repo",
            filename: runner === "gguf" ? "model.gguf" : undefined,
            destination: runner === "gguf" ? "weights/model.gguf" : "weights/model",
          }
    );
  };

  const handleCivitaiLookup = async () => {
    if (!civitaiLookupInput.trim()) return;
    setCivitaiBusy(true);
    setCivitaiError(null);
    try {
      const info = await apiCivitaiFetchInfo(civitaiLookupInput.trim());
      setCivitaiInfo(info);
      const primary = info.files.find((f) => f.primary) ?? info.files[0];
      let next = manifest;
      if (info.model_type.toLowerCase() === "checkpoint" && runner !== "diffusers") {
        next = applyRunnerToManifest(next, "diffusers");
      }
      const nextInstall = next.install.filter(
        (s) => s.step_type !== "hf_download" && s.step_type !== "civitai_download"
      );
      if (primary) {
        nextInstall.push({
          step_type: "civitai_download",
          civitai_model_id: info.model_id,
          civitai_version_id: info.version_id,
          filename: primary.name,
          destination: `weights/${primary.name}`,
          sha256: primary.sha256 ?? undefined,
        });
      }

      const nextInputs =
        info.trained_words.length > 0
          ? next.ui.inputs.map((inp) =>
              inp.name === "prompt" ? { ...inp, quick_chips: info.trained_words } : inp
            )
          : next.ui.inputs;

      applyManifest({
        ...next,
        id: slugify(info.name) || `civitai-${info.model_id}`,
        name: info.name,
        description: info.description_text || next.description,
        category: "image",
        content_rating: info.nsfw ? "adult" : "general",
        install: nextInstall,
        ui: {
          ...next.ui,
          title: info.name,
          inputs: nextInputs,
        },
      });
    } catch (err: unknown) {
      setCivitaiError(err instanceof Error ? err.message : String(err));
    } finally {
      setCivitaiBusy(false);
    }
  };

  const handleLoraChange = (enabled: boolean, repo: string, file: string) => {
    setLoraEnabled(enabled);
    setLoraRepo(repo);
    setLoraFile(file);
    const withoutLora = manifest.install.filter(
      (s) => !(s.destination ?? "").toLowerCase().includes("lora")
    );
    if (enabled && repo.trim()) {
      const safeFile = file.trim() || "adapter.safetensors";
      withoutLora.push({
        step_type: "hf_download",
        repo_id: repo.trim(),
        filename: safeFile,
        destination: `loras/${safeFile}`,
      });
    }
    applyManifest({ ...manifest, install: withoutLora });
  };

  const handleAutoExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoUrl.trim()) return;
    setExtracting(true);
    setExtractError(null);
    setStatusMessage(null);
    try {
      const result = await apiManifestExtractFromUrl(
        autoUrl.trim(),
        selectedProviderId || null,
        modelOverride.trim() || null
      );
      applyManifest(result.manifest);
      setSourceSummary(result.source_summary);
      setExtractWarnings(result.warnings);
      setActiveVaultId(null);
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveToVault = async (target: ModelPackageManifest = manifest) => {
    setSavingVault(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      const saved = await apiVaultSave(target);
      setActiveVaultId(saved.id);
      await refreshVault();
      setStatusMessage(t("creatorSavedToVault"));
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingVault(false);
    }
  };

  const handleInstallLocally = async (target: ModelPackageManifest) => {
    setActionError(null);
    setStatusMessage(null);
    setInstallingId(target.id);
    setInstallProgress(null);
    try {
      await apiInstallModel(target, (p) => setInstallProgress(p));
      onModelInstalled(target);
      setStatusMessage(`${t("installed")}: ${target.name}`);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingId(null);
      setInstallProgress(null);
    }
  };

  const handlePublishToHub = async (target: ModelPackageManifest) => {
    if (!currentUser) {
      onSignIn();
      return;
    }
    setPublishing(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      const formData = new FormData();
      formData.append(
        "metadata",
        JSON.stringify({
          name: target.name,
          slug: target.id,
          description: target.description ?? target.name,
          category: target.category ?? "llm",
          manifest: target,
        })
      );
      const uploaded = await apiUploadScript(formData);
      setStatusMessage(t("creatorPublishedToHub"));
      onPublishedToHub?.(uploaded);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  };

  const handleExportJson = async (target: ModelPackageManifest) => {
    try {
      await saveTextFile(target.id || "manifest", JSON.stringify(target, null, 2), "json");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDuplicate = async (entry: VaultEntry) => {
    const copyId = `${entry.id}-copy`;
    const copy: ModelPackageManifest = {
      ...structuredClone(entry.manifest),
      id: copyId,
      name: `${entry.name} (Copy)`,
      ui: { ...structuredClone(entry.manifest.ui), title: `${entry.name} (Copy)` },
    };
    await handleSaveToVault(copy);
    applyManifest(copy);
  };

  const handleDeleteVaultEntry = async (id: string) => {
    try {
      await apiVaultDelete(id);
      if (activeVaultId === id) setActiveVaultId(null);
      await refreshVault();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRawJsonChange = (text: string) => {
    setRawJson(text);
    try {
      const parsed = JSON.parse(text) as ModelPackageManifest;
      if (!parsed || typeof parsed !== "object") {
        setJsonParseError("JSON must be an object");
        return;
      }
      setJsonParseError(null);
      setManifest(parsed);
    } catch (err: unknown) {
      setJsonParseError(err instanceof Error ? err.message : String(err));
    }
  };

  const inputCls =
    "w-full h-12 px-3.5 rounded-xl border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary";
  const labelCls = "block text-[13px] font-bold mb-2";
  const sectionTitleCls = "text-base font-extrabold";
  const outlineBtn =
    "h-12 px-[18px] rounded-xl border-2 border-foreground bg-transparent text-sm font-bold cursor-pointer hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed";
  const textBtn =
    "h-10 px-1 bg-transparent text-sm font-semibold text-foreground hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  const totalErrors = validationErrors.length + (jsonParseError ? 1 : 0);
  const installPct = installPercent(installProgress);

  const fmtGb = (n: number) => {
    const rounded = String(Math.round(n * 10) / 10);
    return lang === "pl" ? rounded.replace(".", ",") : rounded;
  };
  const needGb = manifest.hardware_requirements.min_vram_gb;
  const fitsGpu = vramBudgetGb === null || needGb <= vramBudgetGb;
  const fitText =
    vramBudgetGb === null
      ? fmt(t("creatorFitUnknown"), { x: fmtGb(needGb) })
      : fitsGpu
        ? fmt(t("creatorFitOk"), { x: fmtGb(needGb), y: fmtGb(vramBudgetGb) })
        : fmt(t("creatorFitSpill"), { x: fmtGb(needGb) });
  const fitPct =
    vramBudgetGb === null ? 0 : Math.round(Math.min(1, needGb / Math.max(vramBudgetGb, 0.1)) * 100);

  const startNewModel = () => {
    applyManifest(createDefaultManifest("gguf"));
    setActiveVaultId(null);
    setSourceSummary(null);
    setExtractWarnings([]);
    setStatusMessage(null);
    setActionError(null);
    setView("editor");
    setEditorTab("basics");
  };

  const openFormEditor = (focus: number) => {
    setFormFocus(focus);
    setView("form");
    setEditorTab("form");
  };

  const addFieldAndEdit = () => {
    const names = new Set(manifest.ui.inputs.map((i) => i.name));
    let n = manifest.ui.inputs.length + 1;
    while (names.has(`param_${n}`)) n += 1;
    applyManifest({
      ...manifest,
      ui: {
        ...manifest.ui,
        inputs: [
          ...manifest.ui.inputs,
          { name: `param_${n}`, label: `Parameter ${n}`, widget: "text", default: "" },
        ],
      },
    });
    openFormEditor(manifest.ui.inputs.length);
  };

  const tabDefs: { id: EditorTab; label: string }[] = [
    { id: "basics", label: t("creatorTabBasics") },
    { id: "form", label: t("creatorTabFormBuilder") },
    { id: "json", label: t("creatorTabRawJson") },
  ];

  const kindLabel = (kind: string) =>
    kind === "llm"
      ? t("creatorKindChat")
      : kind === "image"
        ? t("creatorKindImage")
        : kind === "audio"
          ? t("creatorKindAudio")
          : kind === "vision"
            ? t("creatorKindVision")
            : t("creatorKindMultimodal");

  const previewIcon =
    (manifest.category ?? "llm") === "image" ? (
      <path d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M9 9.5h.01" />
    ) : manifest.category === "audio" ? (
      <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" />
    ) : (
      <path d="M4 5h16v11H9l-5 4z" />
    );

  const tabList = (
    <div role="tablist" aria-label={t("creatorTabsAria")} className="flex gap-6">
      {tabDefs.map((tab) => {
        const on = view === "form" ? tab.id === "form" : editorTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => {
              if (tab.id === "form") {
                if (view !== "form") setEditorTab("form");
                return;
              }
              setView("editor");
              setEditorTab(tab.id);
            }}
            className={cn(
              "h-11 inline-flex items-center border-b-[3px] text-base cursor-pointer transition-colors",
              on
                ? "border-primary font-extrabold text-foreground"
                : "border-transparent font-semibold text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  if (view === "form") {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-background text-foreground">
        <div className="w-full max-w-[clamp(1240px,66vw,1860px)] mx-auto px-10 pt-7 pb-11 space-y-[22px]">
          <header className="flex flex-wrap items-end gap-5">
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setView("editor");
                  setEditorTab("form");
                }}
                className="text-sm font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {t("creatorBack")}
              </button>
              <h1 className="mt-1 font-display text-4xl leading-[1.1] font-extrabold tracking-[-0.02em]">
                {t("creatorFormTitle")}
              </h1>
            </div>
            {tabList}
          </header>

          <div className="flex gap-8 items-start">
            <div className="flex-1 min-w-0">
              <FormBuilderPanel
                ui={manifest.ui}
                initialExpanded={formFocus}
                onChange={(nextUi) => applyManifest({ ...manifest, ui: nextUi })}
              />
            </div>
            <section
              aria-label={t("creatorPreviewTitle")}
              className="hidden lg:flex w-[380px] shrink-0 flex-col gap-3.5 sticky top-0"
            >
              <h2 className="text-[13px] font-bold text-muted-foreground tracking-[.05em] uppercase">
                {t("creatorStudioPreviewHeading")}
              </h2>
              <div className="rounded-[20px] bg-card border border-border p-5">
                <DynamicInferenceForm mode="preview" variant="panel" schema={manifest.ui} />
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden bg-background text-foreground">
      {/* Left — your manifests */}
      <aside
        aria-label={t("creatorListAria")}
        className="w-[264px] shrink-0 border-r border-border pt-8 pb-6 pl-8 pr-5 flex flex-col gap-3.5 min-h-0"
      >
        <div>
          <h1 className="font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.02em]">
            {t("creatorTitle")}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground leading-normal">{t("creatorSubtitle")}</p>
        </div>

        <Button type="button" size="lg" className="w-full h-12 font-extrabold" onClick={startNewModel}>
          {t("creatorNewManifest")}
        </Button>

        <label className="flex items-center gap-2 h-10 border-b-2 border-line text-muted-foreground">
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            type="search"
            value={vaultSearch}
            onChange={(e) => setVaultSearch(e.target.value)}
            placeholder={t("creatorVaultSearchPlaceholder")}
            aria-label={t("creatorFilterAria")}
            className="flex-1 min-w-0 border-0 outline-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground"
          />
        </label>

        <div className="flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
          {filteredVault.length === 0 ? (
            <p className="py-2.5 text-[13px] text-muted-foreground leading-[1.55]">{t("creatorVaultEmpty")}</p>
          ) : (
            <ul className="space-y-1.5" aria-label={t("creatorListAria")}>
              {filteredVault.map((entry) => {
                const isSelected = activeVaultId === entry.id;
                const isInstalled = installedIds.has(entry.id);
                return (
                  <li
                    key={entry.id}
                    className={cn(
                      "rounded-xl px-3 py-2.5 transition-colors",
                      isSelected ? "bg-soft" : "hover:bg-secondary/60"
                    )}
                  >
                    <button
                      type="button"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => {
                        applyManifest(entry.manifest);
                        setActiveVaultId(entry.id);
                        setStatusMessage(null);
                        setActionError(null);
                      }}
                      className="w-full text-left cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className={cn("text-sm truncate", isSelected ? "font-extrabold" : "font-bold")}>
                          {entry.name}
                        </span>
                        {isInstalled && (
                          <span className="px-1.5 py-0.5 rounded bg-ok/15 text-ok text-[10px] font-bold shrink-0">
                            {t("installedTag")}
                          </span>
                        )}
                      </div>
                      <span className="block text-[11px] font-mono text-muted-foreground truncate">
                        {entry.id}
                      </span>
                    </button>
                    <div className="flex flex-wrap gap-x-3 pt-1">
                      {isInstalled && (
                        <button
                          type="button"
                          onClick={() => onOpenInStudio(entry.id)}
                          className="text-xs font-semibold underline cursor-pointer"
                        >
                          {t("creatorOpenInStudio")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDuplicate(entry)}
                        className="text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        {t("creatorDuplicate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteVaultEntry(entry.id)}
                        className="text-xs font-semibold text-destructive hover:underline cursor-pointer"
                      >
                        {t("delete")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAutoOpen(true)}
          className="self-start p-0 border-0 bg-transparent text-[13px] font-semibold underline cursor-pointer"
        >
          {t("creatorModeAuto")}
        </button>
      </aside>

      {/* Center — model editor */}
      <section
        aria-label={t("creatorEditorAria")}
        className="flex-1 min-w-0 overflow-y-auto px-10 py-8 flex flex-col gap-[22px]"
      >
        <div>
          <input
            type="text"
            aria-label={t("creatorModelName")}
            value={manifest.name}
            onChange={(e) => {
              const nextName = e.target.value;
              applyManifest({ ...manifest, name: nextName, ui: { ...manifest.ui, title: nextName } });
            }}
            className="w-full p-0 border-0 outline-none bg-transparent text-foreground font-display text-4xl leading-[1.15] font-extrabold tracking-[-0.02em]"
          />
          <input
            type="text"
            aria-label={t("slugLabel")}
            value={manifest.id}
            onChange={(e) => applyManifest({ ...manifest, id: slugify(e.target.value) || e.target.value })}
            className="w-full mt-1 p-0 border-0 outline-none bg-transparent text-[13px] text-muted-foreground font-mono"
          />
        </div>

        <div className="border-b border-border">{tabList}</div>

        {editorTab === "basics" && (
          <div className="flex flex-col gap-8 max-w-[640px]">
            {/* Source */}
            <div className="flex flex-col gap-4">
              <h2 className={sectionTitleCls}>{t("creatorSourceTitle")}</h2>
              <div className="flex gap-[22px] text-sm">
                {(["hf", "civitai"] as const).map((kind) => (
                  <label
                    key={kind}
                    className={cn("flex items-center gap-2 cursor-pointer", sourceKind === kind && "font-bold")}
                  >
                    <input
                      type="radio"
                      name="creator-source"
                      checked={sourceKind === kind}
                      onChange={() => handleSwitchSource(kind)}
                      className="h-[18px] w-[18px] accent-[hsl(var(--line))]"
                    />
                    {kind === "hf" ? t("creatorSourceHf") : t("creatorSourceCivitai")}
                  </label>
                ))}
              </div>

              {sourceKind === "hf" ? (
                <>
                  <div className="flex gap-2.5 items-end">
                    <label className="flex-1 min-w-0">
                      <span className={labelCls}>{t("hfRepoLabel")}</span>
                      <input
                        type="text"
                        value={primaryStep?.repo_id ?? ""}
                        onChange={(e) =>
                          updatePrimaryDownload((s) => ({
                            ...s,
                            step_type: "hf_download",
                            repo_id: e.target.value,
                          }))
                        }
                        placeholder="owner/repo"
                        className={cn(inputCls, "font-mono text-[13px]")}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!(primaryStep?.repo_id ?? "").includes("/")}
                      onClick={() => setShowHfPicker(true)}
                      className={outlineBtn}
                    >
                      {t("creatorPickHfFiles")}
                    </button>
                  </div>
                  <label className="block">
                    <span className={labelCls}>{t("hfFileLabel")}</span>
                    <input
                      type="text"
                      value={primaryStep?.filename ?? ""}
                      onChange={(e) =>
                        updatePrimaryDownload((s) => ({
                          ...s,
                          filename: e.target.value.trim() || undefined,
                        }))
                      }
                      placeholder="model-Q4_K_M.gguf"
                      className={cn(inputCls, "font-mono text-[13px]")}
                    />
                  </label>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex-1 min-w-[200px] space-y-1">
                        <span className="text-xs font-semibold">CivitAI URL / ID</span>
                        <input
                          type="text"
                          value={civitaiLookupInput}
                          onChange={(e) => setCivitaiLookupInput(e.target.value)}
                          placeholder={t("creatorCivitaiLookupPlaceholder")}
                          className={cn(inputCls, "font-mono")}
                        />
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={civitaiBusy || !civitaiLookupInput.trim()}
                        onClick={() => void handleCivitaiLookup()}
                      >
                        {civitaiBusy ? t("creatorCivitaiFetching") : t("creatorCivitaiFetchBtn")}
                      </Button>
                    </div>

                    {civitaiError && (
                      <p role="alert" className="text-xs text-destructive">
                        {civitaiError}
                      </p>
                    )}

                    {civitaiInfo && (
                      <div className="rounded-lg border border-border bg-soft/40 p-3 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">{civitaiInfo.name}</span>
                          <span className="px-1.5 py-0.5 rounded bg-secondary font-medium">
                            {civitaiInfo.model_type}
                          </span>
                          {civitaiInfo.base_model && (
                            <span className="text-muted-foreground">{civitaiInfo.base_model}</span>
                          )}
                        </div>
                        {civitaiInfo.trained_words.length > 0 && (
                          <p className="text-muted-foreground">
                            <strong>{t("creatorCivitaiTriggerWords")}:</strong>{" "}
                            {civitaiInfo.trained_words.join(", ")}
                          </p>
                        )}
                        {civitaiInfo.files.length > 0 && (
                          <label className="block space-y-1">
                            <span className="font-semibold">{t("creatorCivitaiSelectFile")}</span>
                            <select
                              value={primaryStep?.filename ?? civitaiInfo.files[0].name}
                              onChange={(e) => {
                                const picked = civitaiInfo.files.find((f) => f.name === e.target.value);
                                if (!picked) return;
                                updatePrimaryDownload((s) => ({
                                  ...s,
                                  step_type: "civitai_download",
                                  civitai_model_id: civitaiInfo.model_id,
                                  civitai_version_id: civitaiInfo.version_id,
                                  filename: picked.name,
                                  destination: `weights/${picked.name}`,
                                  sha256: picked.sha256 ?? undefined,
                                }));
                              }}
                              className={cn(inputCls, "font-mono")}
                            >
                              {civitaiInfo.files.map((f) => (
                                <option key={f.name} value={f.name}>
                                  {f.name} ({formatBytesGb(f.size_bytes)})
                                  {f.sha256 ? " · SHA-256 ✓" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold">Model ID</span>
                        <input
                          type="number"
                          value={primaryStep?.civitai_model_id ?? ""}
                          onChange={(e) =>
                            updatePrimaryDownload((s) => ({
                              ...s,
                              step_type: "civitai_download",
                              civitai_model_id: Number(e.target.value) || undefined,
                            }))
                          }
                          className={cn(inputCls, "font-mono")}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold">Version ID</span>
                        <input
                          type="number"
                          value={primaryStep?.civitai_version_id ?? ""}
                          onChange={(e) =>
                            updatePrimaryDownload((s) => ({
                              ...s,
                              step_type: "civitai_download",
                              civitai_version_id: Number(e.target.value) || undefined,
                            }))
                          }
                          className={cn(inputCls, "font-mono")}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold">SHA-256</span>
                        <input
                          type="text"
                          value={primaryStep?.sha256 ?? ""}
                          onChange={(e) =>
                            updatePrimaryDownload((s) => ({
                              ...s,
                              sha256: e.target.value.trim() || undefined,
                            }))
                          }
                          className={cn(inputCls, "font-mono")}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {runner === "diffusers" && (
                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={loraEnabled}
                      onChange={(e) => handleLoraChange(e.target.checked, loraRepo, loraFile)}
                      className="h-4 w-4 accent-[hsl(var(--line))]"
                    />
                    {t("creatorOptionalLora")}
                  </label>
                  {loraEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={loraRepo}
                        onChange={(e) => handleLoraChange(true, e.target.value, loraFile)}
                        placeholder={t("creatorLoraRepoPlaceholder")}
                        className={cn(inputCls, "font-mono")}
                      />
                      <input
                        type="text"
                        value={loraFile}
                        onChange={(e) => handleLoraChange(true, loraRepo, e.target.value)}
                        placeholder={t("creatorLoraFilePlaceholder")}
                        className={cn(inputCls, "font-mono")}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* What it is */}
            <div className="flex flex-col gap-4">
              <h2 className={sectionTitleCls}>{t("creatorWhatModelTitle")}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className={labelCls}>{t("creatorModelKind")}</span>
                  <select
                    value={manifest.category ?? "llm"}
                    onChange={(e) => applyManifest({ ...manifest, category: e.target.value })}
                    className={inputCls}
                  >
                    {["llm", "image", "audio", "vision", "multimodal"].map((k) => (
                      <option key={k} value={k}>
                        {kindLabel(k)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelCls}>{t("creatorEngine")}</span>
                  <select
                    value={runner}
                    onChange={(e) =>
                      applyManifest(applyRunnerToManifest(manifest, e.target.value as RunnerKind))
                    }
                    className={inputCls}
                  >
                    <option value="gguf">GGUF (llama.cpp)</option>
                    <option value="diffusers">Diffusers</option>
                    <option value="transformers">Transformers</option>
                    <option value="audio">Audio Pipeline</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className={labelCls}>{t("creatorDescription")}</span>
                <textarea
                  rows={2}
                  value={manifest.description ?? ""}
                  onChange={(e) =>
                    applyManifest({
                      ...manifest,
                      description: e.target.value,
                      ui: { ...manifest.ui, description: e.target.value },
                    })
                  }
                  className="w-full resize-y px-3.5 py-3 rounded-xl border border-input bg-card text-sm leading-normal focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
            </div>

            {/* Memory */}
            <div className="flex flex-col gap-4">
              <h2 className={sectionTitleCls}>{t("creatorMemoryTitle")}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className={labelCls}>{t("creatorVramLabel")}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={manifest.hardware_requirements.min_vram_gb}
                    onChange={(e) =>
                      applyManifest({
                        ...manifest,
                        hardware_requirements: {
                          ...manifest.hardware_requirements,
                          min_vram_gb: Number(e.target.value) || 0,
                        },
                      })
                    }
                    className={cn(inputCls, "font-mono")}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>{t("creatorRamLabel")}</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={manifest.hardware_requirements.min_ram_gb}
                    onChange={(e) =>
                      applyManifest({
                        ...manifest,
                        hardware_requirements: {
                          ...manifest.hardware_requirements,
                          min_ram_gb: Math.max(1, Number(e.target.value) || 1),
                        },
                      })
                    }
                    className={cn(inputCls, "font-mono")}
                  />
                </label>
              </div>

              <details className="group border-t border-border pt-3.5">
                <summary className="flex items-center justify-between h-8 text-sm font-bold cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  {t("creatorAdvanced")}
                  <span className="text-[13px] font-normal text-muted-foreground">
                    {t("creatorAdvancedHint")}
                  </span>
                </summary>
                <div className="pt-3.5 space-y-4">
                  {sourceKind === "hf" && (
                    <label className="block">
                      <span className={labelCls}>SHA-256</span>
                      <input
                        type="text"
                        value={primaryStep?.sha256 ?? ""}
                        onChange={(e) =>
                          updatePrimaryDownload((s) => ({
                            ...s,
                            sha256: e.target.value.trim() || undefined,
                          }))
                        }
                        placeholder="optional 64 hex chars"
                        className={cn(inputCls, "font-mono text-[13px]")}
                      />
                    </label>
                  )}
                  {(runner === "gguf" || runner === "transformers") && (() => {
                    const defaultMaxCtx = runner === "gguf" ? 131072 : 32768;
                    const currentCw = manifest.runtime.context_window ?? {
                      recommended: 8192,
                      max_supported: defaultMaxCtx,
                    };
                    const currentOt = manifest.runtime.output_tokens ?? {
                      recommended: Math.min(4096, currentCw.max_supported),
                      max_supported: currentCw.max_supported,
                    };
                    const clampCtx = (n: number) => Math.max(256, Math.min(2_097_152, Math.round(n)));
                    const clampOut = (n: number, ctxCap: number) =>
                      Math.max(64, Math.min(ctxCap, Math.round(n)));
                    const updateContextWindow = (recRaw: number, maxRaw: number) => {
                      const rec = clampCtx(Number.isFinite(recRaw) ? recRaw : currentCw.recommended);
                      const max = Math.max(rec, clampCtx(Number.isFinite(maxRaw) ? maxRaw : currentCw.max_supported));
                      const prevOt = manifest.runtime.output_tokens;
                      const nextOt = prevOt
                        ? {
                            recommended: Math.min(prevOt.recommended, Math.min(prevOt.max_supported, max)),
                            max_supported: Math.max(64, Math.min(prevOt.max_supported, max)),
                          }
                        : undefined;
                      applyManifest({
                        ...manifest,
                        runtime: {
                          ...manifest.runtime,
                          context_window: { recommended: rec, max_supported: max },
                          ...(nextOt ? { output_tokens: nextOt } : {}),
                        },
                      });
                    };
                    const updateOutputTokens = (recRaw: number, maxRaw: number) => {
                      const ctxCap = currentCw.max_supported;
                      const max = clampOut(Number.isFinite(maxRaw) ? maxRaw : currentOt.max_supported, ctxCap);
                      const rec = Math.min(max, clampOut(Number.isFinite(recRaw) ? recRaw : currentOt.recommended, max));
                      applyManifest({
                        ...manifest,
                        runtime: {
                          ...manifest.runtime,
                          output_tokens: { recommended: rec, max_supported: max },
                        },
                      });
                    };
                    return (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <span className="text-xs font-semibold block">{t("creatorContextWindowTitle")}</span>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block space-y-1">
                              <span className="text-[11px] text-muted-foreground">
                                {t("creatorContextRecommendedLabel")}
                              </span>
                              <input
                                data-testid="creator-ctx-recommended"
                                type="number"
                                min={256}
                                max={2097152}
                                step={1}
                                value={currentCw.recommended}
                                onChange={(e) => {
                                  const nextRec = Number(e.target.value);
                                  if (!Number.isFinite(nextRec) || nextRec <= 0) return;
                                  updateContextWindow(nextRec, currentCw.max_supported);
                                }}
                                className={inputCls}
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-[11px] text-muted-foreground">
                                {t("creatorContextMaxSupportedLabel")}
                              </span>
                              <input
                                data-testid="creator-ctx-max-supported"
                                type="number"
                                min={256}
                                max={2097152}
                                step={1}
                                value={currentCw.max_supported}
                                onChange={(e) => {
                                  const nextMax = Number(e.target.value);
                                  if (!Number.isFinite(nextMax) || nextMax <= 0) return;
                                  const clampedMax = clampCtx(nextMax);
                                  const rec = Math.min(currentCw.recommended, clampedMax);
                                  updateContextWindow(rec, clampedMax);
                                }}
                                className={inputCls}
                              />
                            </label>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{t("creatorContextWindowHint")}</p>
                        </div>

                        <div className="space-y-1.5">
                          <span className="text-xs font-semibold block">{t("creatorOutputTokensTitle")}</span>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block space-y-1">
                              <span className="text-[11px] text-muted-foreground">
                                {t("creatorOutputRecommendedLabel")}
                              </span>
                              <input
                                data-testid="creator-out-recommended"
                                type="number"
                                min={64}
                                max={currentCw.max_supported}
                                step={1}
                                value={currentOt.recommended}
                                onChange={(e) => {
                                  const nextRec = Number(e.target.value);
                                  if (!Number.isFinite(nextRec) || nextRec <= 0) return;
                                  updateOutputTokens(nextRec, currentOt.max_supported);
                                }}
                                className={inputCls}
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-[11px] text-muted-foreground">
                                {t("creatorOutputMaxSupportedLabel")}
                              </span>
                              <input
                                data-testid="creator-out-max-supported"
                                type="number"
                                min={64}
                                max={currentCw.max_supported}
                                step={1}
                                value={currentOt.max_supported}
                                onChange={(e) => {
                                  const nextMax = Number(e.target.value);
                                  if (!Number.isFinite(nextMax) || nextMax <= 0) return;
                                  const clampedMax = clampOut(nextMax, currentCw.max_supported);
                                  const rec = Math.min(currentOt.recommended, clampedMax);
                                  updateOutputTokens(rec, clampedMax);
                                }}
                                className={inputCls}
                              />
                            </label>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{t("creatorOutputTokensHint")}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </details>
            </div>
          </div>
        )}

        {editorTab === "form" && (
          <div className="flex flex-col max-w-[640px]">
            <p className="mb-3.5 text-sm text-muted-foreground leading-[1.55]">{t("creatorFormIntro")}</p>
            {manifest.ui.inputs.map((inp, idx) => (
              <div
                key={`${idx}-${inp.name}`}
                className="flex items-center gap-4 py-4 border-t border-border"
              >
                <div className="flex-1 min-w-0 text-base font-bold truncate">{inp.label || inp.name}</div>
                <div className="text-[13px] text-muted-foreground">{inp.widget}</div>
                <button
                  type="button"
                  aria-label={`${t("creatorEditField")} ${inp.name}`}
                  onClick={() => openFormEditor(idx)}
                  className={textBtn}
                >
                  {t("creatorEditField")}
                </button>
              </div>
            ))}
            <div className="border-t border-border pt-[18px]">
              <Button type="button" variant="outline" className="h-11 px-5" onClick={addFieldAndEdit}>
                {t("fbAddInput").replace(/^\+\s*/, "")}
              </Button>
            </div>
          </div>
        )}

        {editorTab === "json" && (
          <div className="space-y-3 max-w-[640px]">
            <textarea
              aria-label={t("creatorTabRawJson")}
              value={rawJson}
              onChange={(e) => handleRawJsonChange(e.target.value)}
              spellCheck={false}
              rows={22}
              className="w-full px-[22px] py-5 rounded-2xl border border-border bg-secondary/50 font-mono text-[13px] leading-[1.65] focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {jsonParseError && (
              <p role="alert" className="text-xs text-destructive font-mono">
                JSON syntax error: {jsonParseError}
              </p>
            )}
            {validationErrors.length > 0 && (
              <ul
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive space-y-1"
              >
                {validationErrors.map((err, idx) => (
                  <li key={idx}>• {err}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Right — how others will see it */}
      <aside
        aria-label={t("creatorPreviewAside")}
        className="w-[340px] xl:w-[400px] shrink-0 border-l border-border bg-card px-8 pt-8 pb-7 flex flex-col gap-6 min-h-0 overflow-y-auto"
      >
        <div className="text-[13px] font-bold text-muted-foreground tracking-[.05em] uppercase">
          {t("creatorCatalogPreview")}
        </div>

        <div className="flex gap-4 items-start">
          <div
            aria-hidden="true"
            className="shrink-0 h-12 w-12 rounded-[14px] bg-soft text-ink flex items-center justify-center"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {previewIcon}
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold tracking-[-0.01em] break-words">{manifest.name || "—"}</div>
            <div className="text-[13px] text-muted-foreground mt-[3px]">{t("creatorYouPrivate")}</div>
            <div className="text-sm text-muted-foreground leading-normal mt-2.5">{manifest.description}</div>
            {vramBudgetGb !== null && (
              <div className="h-1.5 rounded-[3px] bg-secondary flex overflow-hidden mt-4">
                <span
                  className={cn("h-full", fitsGpu ? "bg-line" : "bg-warn")}
                  style={{ width: `${fitsGpu ? fitPct : 100}%` }}
                />
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-[7px] font-mono">{fitText}</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 py-3.5 border-y border-border text-sm">
          <span
            aria-hidden="true"
            className={cn("h-2.5 w-2.5 rounded-full", totalErrors === 0 ? "bg-ok" : "bg-destructive")}
          />
          <span className="font-bold">
            {totalErrors === 0
              ? t("creatorValidationValid")
              : fmt(t("creatorValidationIssues"), { x: totalErrors })}
          </span>
        </div>

        <span className="flex-1" />

        <div className="flex flex-col gap-2.5">
          {installProgress && (
            <div className="text-xs space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span className="truncate">{installProgress.message}</span>
                {installPct !== null && <span>{installPct}%</span>}
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${installPct ?? 35}%` }} />
              </div>
            </div>
          )}
          {statusMessage && (
            <p role="status" className="text-xs font-semibold text-ok">
              {statusMessage}
            </p>
          )}
          {actionError && (
            <p role="alert" className="text-xs text-destructive">
              {actionError}
            </p>
          )}

          <Button
            type="button"
            size="lg"
            className="h-[52px] rounded-2xl text-base font-extrabold"
            disabled={savingVault || totalErrors > 0}
            onClick={() => void handleSaveToVault(manifest)}
          >
            {t("creatorSaveToVault")}
          </Button>

          {installedIds.has(manifest.id) ? (
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenInStudio(manifest.id)}>
              {t("creatorOpenInStudio")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={installingId !== null || totalErrors > 0}
              onClick={() => void handleInstallLocally(manifest)}
            >
              {installingId === manifest.id ? t("installing") : t("creatorInstallLocally")}
            </Button>
          )}

          <div className="flex justify-between pt-1">
            <button type="button" className={textBtn} onClick={() => void handleExportJson(manifest)}>
              {t("creatorExportJson")}
            </button>
            <button
              type="button"
              className={textBtn}
              disabled={publishing || totalErrors > 0}
              onClick={() => void handlePublishToHub(manifest)}
              title={currentUser ? t("creatorPublishToHub") : t("creatorSignInToPublish")}
            >
              {t("creatorPublishToHub")}
            </button>
          </div>
        </div>
      </aside>

      {/* Fill from a link (AI) */}
      <Modal isOpen={autoOpen} onClose={() => setAutoOpen(false)} title={t("creatorModeAuto")} size="lg">
        <section aria-label={t("creatorModeAuto")} className="space-y-4">
          <p className="text-sm text-muted-foreground leading-normal">{t("creatorAutoIntro")}</p>
          <form onSubmit={(e) => void handleAutoExtract(e)} className="space-y-4">
            <label className="block">
              <span className={labelCls}>URL (Hugging Face / CivitAI)</span>
              <input
                type="text"
                value={autoUrl}
                onChange={(e) => setAutoUrl(e.target.value)}
                placeholder={t("creatorAutoUrlPlaceholder")}
                aria-label="Model URL"
                className={cn(inputCls, "font-mono text-[13px]")}
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className={labelCls}>{t("creatorAutoProviderLabel")}</span>
                <select
                  aria-label={t("creatorAutoProviderLabel")}
                  value={selectedProviderId}
                  onChange={(e) => {
                    setSelectedProviderId(e.target.value);
                    setModelOverride("");
                  }}
                  className={inputCls}
                >
                  {providers.length === 0 ? (
                    <option value="">—</option>
                  ) : (
                    providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                        {p.is_default ? ` (${t("aiProvidersDefaultBadge")})` : ""}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="block">
                <span className={labelCls}>{t("creatorAutoModelOverrideLabel")}</span>
                {selectedProvider && selectedProvider.cached_models.length > 0 ? (
                  <select
                    aria-label={t("creatorAutoModelOverrideLabel")}
                    value={modelOverride}
                    onChange={(e) => setModelOverride(e.target.value)}
                    className={cn(inputCls, "font-mono")}
                  >
                    <option value="">{selectedProvider.default_model || t("aiProvidersDefaultModel")}</option>
                    {selectedProvider.cached_models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label={t("creatorAutoModelOverrideLabel")}
                    value={modelOverride}
                    onChange={(e) => setModelOverride(e.target.value)}
                    placeholder={selectedProvider?.default_model ?? "auto"}
                    className={cn(inputCls, "font-mono")}
                  />
                )}
              </label>
            </div>

            {providers.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("creatorAutoNoProvider")}</p>
            )}

            <div className="flex justify-end gap-2.5">
              {sourceSummary && (
                <Button type="button" variant="outline" size="lg" onClick={() => setAutoOpen(false)}>
                  {t("creatorAutoDone")}
                </Button>
              )}
              <Button type="submit" size="lg" disabled={extracting || !autoUrl.trim()}>
                {extracting ? t("creatorAutoAnalyzing") : t("creatorAutoAnalyzeBtn")}
              </Button>
            </div>
          </form>

          {extractError && (
            <p role="alert" className="text-xs text-destructive">
              {extractError}
            </p>
          )}

          {sourceSummary && (
            <div className="rounded-2xl border border-border bg-soft/40 px-4 py-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{t("creatorAutoSummaryTitle")}:</span>
                <span className="px-1.5 py-0.5 rounded bg-secondary font-mono uppercase text-[10px]">
                  {sourceSummary.source}
                </span>
                <span className="font-semibold">{sourceSummary.title}</span>
                <span className="text-muted-foreground font-mono">({sourceSummary.identifier})</span>
                {sourceSummary.base_model && (
                  <span className="px-1.5 py-0.5 rounded bg-soft border border-border">
                    {sourceSummary.base_model}
                  </span>
                )}
                <span className="text-muted-foreground">{sourceSummary.file_count} files</span>
              </div>
              {sourceSummary.trained_words.length > 0 && (
                <p className="text-muted-foreground">
                  <strong>{t("creatorCivitaiTriggerWords")}:</strong> {sourceSummary.trained_words.join(", ")}
                </p>
              )}
            </div>
          )}

          {extractWarnings.length > 0 && (
            <ul className="rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2 text-xs space-y-0.5">
              <li className="font-bold">{t("creatorAutoWarningsTitle")}</li>
              {extractWarnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          )}
        </section>
      </Modal>

      {showHfPicker && primaryStep?.repo_id && (
        <HfFilePicker
          repoId={primaryStep.repo_id}
          runner={runner}
          onPick={({ file, assessment }) => {
            applyManifest({
              ...manifest,
              hardware_requirements: {
                ...manifest.hardware_requirements,
                min_vram_gb: assessment.suggestedVramGb,
                min_ram_gb: assessment.suggestedRamGb,
              },
              install: withUpdatedPrimaryDownload(manifest.install, (s) => ({
                ...s,
                step_type: "hf_download",
                filename: file?.path ?? s.filename,
                sha256: file?.sha256 ?? s.sha256,
              })),
            });
            setShowHfPicker(false);
          }}
          onClose={() => setShowHfPicker(false)}
        />
      )}
    </div>
  );
}
