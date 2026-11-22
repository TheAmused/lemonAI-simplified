import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ModelPackageManifest } from "@/types/manifest";
import {
  apiGetScripts,
  apiMyRatings,
  apiRateScript,
  apiRecordScriptInstall,
  offlineCatalog,
  type HubScript,
  type HubUser,
} from "@/lib/hub-api";
import {
  getCachedCatalog,
  setCachedCatalog,
  formatCacheDate,
} from "@/lib/catalog-cache";
import {
  apiCheckModelUpdates,
  apiGetHardwareCapabilities,
  apiUninstallModel,
  installPercent,
  type ModelUpdateInfo,
} from "@/lib/ipc";
import {
  cancelRunningInstall,
  clearUnseenOutcome,
  startInstall,
  useInstallState,
} from "@/lib/install-store";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Modal } from "@/components/ui/modal";
import { HfTokenModal } from "@/components/hub/HfTokenModal";
import { ReportScriptModal } from "@/components/hub/ReportScriptModal";
import { StandardsList, StatusBadge } from "@/components/hub/ModerationBits";
import { StarRating } from "@/components/hub/StarRating";
import { VersionPickerDialog } from "@/components/hub/VersionPickerDialog";
import { DotsIcon, SearchIcon, UploadIcon, categoryIcon } from "@/components/shell/icons";
import { fmt, useI18n } from "@/lib/i18n";
import {
  fitOf,
  formatGb,
  groupCatalog,
  needs,
  recommend,
  variantsLabel,
  type CatalogEntry,
  type FitKind,
  type MachineMemory,
} from "@/lib/families";
import { useAdultContent } from "@/lib/settings";
import { expandVariants } from "@/lib/catalog";
import type { MemoryMode } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export interface ModelHubViewProps {
  installedModelIds: string[];
  onModelInstalled: (manifest: ModelPackageManifest) => void;

  onModelUninstalled?: (modelId: string) => void;
  onOpenInWorkspace: (modelId: string) => void;
  onOpenUploadModal?: () => void;
  currentUser: HubUser | null;

  availableVramGb?: number;

  ramGb?: number;

  memoryMode?: MemoryMode;

  installedModels?: ModelPackageManifest[];

  publishedScript?: HubScript | null;

  onPublishedScriptHandled?: () => void;
}

export type HubSortOption = "default" | "name_asc" | "vram_asc" | "vram_desc" | "rating";

export function installSummary(manifest: ModelPackageManifest): {
  packages: string[];
  repos: string[];
  args: string[];
} {
  const packages = manifest.install.flatMap((s) =>
    s.step_type === "uv_pip_install" ? s.packages ?? [] : []
  );
  const repos = manifest.install.flatMap((s) =>
    s.step_type === "hf_download" && s.repo_id
      ? [s.filename ? `${s.repo_id} (${s.filename})` : s.repo_id]
      : []
  );
  return { packages, repos, args: manifest.runtime.arguments ?? [] };
}

export function getModelCompatibility(
  manifest: ModelPackageManifest,
  fallbackMinVram: number,
  effectiveVram?: number
): { minVram: number; isCompatible: boolean; isCpuSupported: boolean; fitsGpuVram: boolean } {
  const minVram = manifest.hardware_requirements?.min_vram_gb ?? fallbackMinVram;
  const supportedAccelerators = manifest.hardware_requirements?.supported_accelerators;
  const isCpuSupported =
    (supportedAccelerators && supportedAccelerators.includes("cpu")) || minVram === 0;
  const fitsGpuVram = effectiveVram !== undefined ? minVram <= effectiveVram : true;

  const isCompatible = fitsGpuVram || minVram === 0;
  return { minVram, isCompatible, isCpuSupported: Boolean(isCpuSupported), fitsGpuVram };
}

const CANCELLED = "Installation cancelled";

const CATEGORY_TABS = [
  { id: "all", pl: "Wszystkie", en: "All" },
  { id: "llm", pl: "Tekst", en: "Text" },
  { id: "image", pl: "Obraz", en: "Image" },
  { id: "audio", pl: "Audio", en: "Audio" },
  { id: "code", pl: "Kod", en: "Code" },
] as const;

export function FitMeter({
  manifest,
  machine,
  allowOffload,
  prefix,
}: {
  manifest: ModelPackageManifest;
  machine: MachineMemory;
  allowOffload: boolean;
  prefix?: string;
}) {
  const { t, lang } = useI18n();
  const need = needs(manifest).vramGb;
  const vram = machine.vramGb;
  const fit = fitOf(manifest, machine, allowOffload);
  const inGpu = vram === undefined ? need : Math.min(need, vram);
  const over = Math.max(0, need - inGpu);
  const scale = vram && vram > 0 ? vram : Math.max(need, 1);
  const gpuPct = Math.min(100, Math.round((inGpu / scale) * 100));
  const ramPct = Math.min(100 - gpuPct, Math.round((over / scale) * 100));
  const text =
    vram === undefined
      ? `${formatGb(need, lang)} VRAM`
      : fit === "none"
        ? `${formatGb(need, lang)} · ${t("fitNone")}`
        : over > 0
          ? `${formatGb(inGpu, lang)} ${t("onGpuShort")} + ${formatGb(over, lang)} RAM`
          : `${formatGb(need, lang)} / ${formatGb(vram, lang)}`;
  return (
    <div data-testid="fit-meter">
      <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-[3px] bg-secondary">
        <span className={cn("h-full", fit === "none" ? "bg-destructive/60" : "bg-ink")} style={{ width: `${gpuPct}%` }} />
        {over > 0 && <span className={cn("h-full", fit === "none" ? "bg-destructive/40" : "bg-warn")} style={{ width: `${ramPct}%` }} />}
      </div>
      <div
        className={cn(
          "mt-[7px] font-mono text-xs",
          fit === "none" ? "text-destructive" : over > 0 ? "text-warn" : "text-muted-foreground"
        )}
      >
        {prefix ? `${prefix} ` : ""}
        {text}
      </div>
    </div>
  );
}

const rowAction = (kind: "outline" | "primary") =>
  cn(
    "flex h-[46px] min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[14px] border-2 px-2 text-sm font-bold transition-colors disabled:cursor-default disabled:opacity-50",
    kind === "primary"
      ? "border-primary bg-primary text-primary-foreground"
      : "border-foreground text-foreground hover:bg-foreground hover:text-background"
  );

type Entry = CatalogEntry<HubScript>;
const entryMembers = (e: Entry): HubScript[] => (e.kind === "family" ? e.members : [e.item]);

export function ModelHubView({
  installedModelIds,
  onModelInstalled,
  onModelUninstalled,
  onOpenInWorkspace,
  onOpenUploadModal: _onOpenUploadModal,
  currentUser,
  availableVramGb,
  ramGb,
  memoryMode,
  publishedScript,
  onPublishedScriptHandled,
}: ModelHubViewProps) {
  const { t, lang } = useI18n();
  const [adultContent] = useAdultContent();
  const allowOffload = memoryMode !== "gpu_only";
  const [pickerFamily, setPickerFamily] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [scripts, setScripts] = useState<HubScript[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [onlyCurated, setOnlyCurated] = useState(false);
  const [showUnfit, setShowUnfit] = useState(false);
  const [sortBy, setSortBy] = useState<HubSortOption>("default");

  const [ipcVram, setIpcVram] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (availableVramGb !== undefined) return;
    let active = true;
    void apiGetHardwareCapabilities()
      .then((caps) => {
        if (active && caps && typeof caps.available_vram_gb === "number") {
          setIpcVram(caps.available_vram_gb);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [availableVramGb]);

  const effectiveVram = availableVramGb !== undefined ? availableVramGb : ipcVram;
  const machine = useMemo<MachineMemory>(() => ({ vramGb: effectiveVram, ramGb }), [effectiveVram, ramGb]);

  const [hubError, setHubError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const { running: runningInstall, unseen: unseenOutcome } = useInstallState();
  const installingId = runningInstall?.modelId ?? null;
  const installProgress = runningInstall?.progress ?? null;
  const cancelRequested = runningInstall?.cancelRequested ?? false;

  const [confirmScript, setConfirmScript] = useState<HubScript | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<HubScript | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [showTokenModal, setShowTokenModal] = useState(false);

  const [updates, setUpdates] = useState<Record<string, ModelUpdateInfo>>({});
  const [installSuccessToast, setInstallSuccessToast] = useState<string | null>(
    null
  );
  const [reportTarget, setReportTarget] = useState<HubScript | null>(null);
  const [myRatings, setMyRatings] = useState<Record<string, number>>({});

  const [publishNotice, setPublishNotice] = useState<HubScript | null>(null);

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownUnlistedRef = useRef<HubScript[]>([]);
  const isMountedRef = useRef(true);
  const loadReqIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const loadScripts = useCallback(async () => {
    const reqId = ++loadReqIdRef.current;
    try {
      setIsLoading(true);
      const list = await apiGetScripts({ adult: adultContent });
      if (!isMountedRef.current || reqId !== loadReqIdRef.current) return;
      setCachedCatalog(list);

      const own = ownUnlistedRef.current.filter((o) => !list.some((s) => s.slug === o.slug));
      setScripts([...own, ...list]);
      setHubError(null);
      setCachedAt(null);
    } catch (err: unknown) {
      if (isMountedRef.current && reqId === loadReqIdRef.current) {
        const detail = err instanceof Error ? err.message : String(err);
        setHubError(detail);

        const cached = getCachedCatalog();
        if (cached && cached.scripts.length > 0) {
          setCachedAt(cached.lastSyncedAt);
          setScripts(cached.scripts);
        } else {
          setCachedAt(null);
          setScripts(offlineCatalog({ adult: adultContent }));
        }
      }
    } finally {
      if (isMountedRef.current && reqId === loadReqIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [adultContent]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  const filteredScripts = useMemo(() => {
    const list = scripts.filter((s) => {
      if (onlyCurated && !s.is_curated) {
        return false;
      }
      if (selectedCategory !== "all" && s.category.toLowerCase() !== selectedCategory) {
        return false;
      }

      if (!adultContent && (s.is_adult || s.manifest.content_rating === "adult")) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesName =
          s.name.toLowerCase().includes(query) ||
          (s.manifest.name ? s.manifest.name.toLowerCase().includes(query) : false);
        const matchesDesc =
          s.description.toLowerCase().includes(query) ||
          (s.manifest.description ? s.manifest.description.toLowerCase().includes(query) : false);
        const matchesAuthor =
          (s.author ?? "").toLowerCase().includes(query) ||
          (s.manifest.author ?? "").toLowerCase().includes(query);
        const matchesCategory =
          (s.category ?? "").toLowerCase().includes(query) ||
          (s.manifest.category ?? "").toLowerCase().includes(query);
        const matchesSlug =
          s.slug.toLowerCase().includes(query) ||
          (s.manifest.id ?? "").toLowerCase().includes(query);

        if (!matchesName && !matchesDesc && !matchesAuthor && !matchesCategory && !matchesSlug) {
          return false;
        }
      }
      return true;
    });

    if (sortBy === "name_asc") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "vram_asc") {
      list.sort((a, b) => {
        const vramA = a.manifest.hardware_requirements?.min_vram_gb ?? a.min_vram_gb ?? 0;
        const vramB = b.manifest.hardware_requirements?.min_vram_gb ?? b.min_vram_gb ?? 0;
        return vramA - vramB;
      });
    } else if (sortBy === "vram_desc") {
      list.sort((a, b) => {
        const vramA = a.manifest.hardware_requirements?.min_vram_gb ?? a.min_vram_gb ?? 0;
        const vramB = b.manifest.hardware_requirements?.min_vram_gb ?? b.min_vram_gb ?? 0;
        return vramB - vramA;
      });
    } else if (sortBy === "rating") {
      list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.rating_count ?? 0) - (a.rating_count ?? 0));
    }

    return list;
  }, [scripts, onlyCurated, selectedCategory, adultContent, searchQuery, sortBy]);

  const entries = useMemo(() => {
    let grouped = groupCatalog(filteredScripts);

    const title = (e: Entry) => (e.kind === "family" ? e.name : e.item.name);
    const vram = (e: Entry) => Math.min(...entryMembers(e).map((m) => needs(m.manifest).vramGb));
    const rating = (e: Entry) => Math.max(...entryMembers(e).map((m) => m.rating ?? 0));
    if (sortBy === "name_asc") grouped.sort((x, y) => title(x).localeCompare(title(y)));
    else if (sortBy === "vram_asc") grouped.sort((x, y) => vram(x) - vram(y));
    else if (sortBy === "vram_desc") grouped.sort((x, y) => vram(y) - vram(x));
    else if (sortBy === "rating") grouped.sort((x, y) => rating(y) - rating(x));
    return grouped;
  }, [filteredScripts, sortBy]);

  const groups = useMemo(() => {
    const kindOf = (e: Entry): FitKind => {
      const members = entryMembers(e);
      const { recommended, fits } = recommend(members, machine, allowOffload);
      return fits.get(recommended) ?? "gpu";
    };
    const buckets: Record<FitKind, Entry[]> = { gpu: [], ram: [], none: [] };
    for (const e of entries) buckets[kindOf(e)].push(e);
    return [
      { id: "gpu", title: t("catGroupFits"), note: t("catGroupFitsNote"), dot: "bg-ink", entries: buckets.gpu },
      { id: "ram", title: t("catGroupSlower"), note: t("catGroupSlowerNote"), dot: "bg-warn", entries: buckets.ram },
      { id: "none", title: t("catGroupNone"), note: t("catGroupNoneNote"), dot: "bg-destructive", entries: buckets.none },
    ].filter((g) => g.entries.length > 0);
  }, [entries, machine, allowOffload, t]);
  const unfitCount = groups.find((g) => g.id === "none")?.entries.length ?? 0;

  const hero = useMemo(() => {
    if (effectiveVram === undefined) return null;
    const chat = expandVariants(scripts).filter(
      (s) =>
        s.category.toLowerCase() === "llm" &&
        s.is_curated &&
        (adultContent || !(s.is_adult || s.manifest.content_rating === "adult"))
    );
    if (chat.length === 0) return null;
    const { recommended, fits } = recommend(chat, machine, allowOffload);
    if (fits.get(recommended) === "none") return null;
    const family = recommended.manifest.family;
    const siblings = family ? chat.filter((s) => s.manifest.family?.id === family.id) : [recommended];
    return { script: recommended, fit: fits.get(recommended) as FitKind, siblings };
  }, [scripts, machine, allowOffload, adultContent, effectiveVram]);

  const pickerEntry = pickerFamily
    ? groupCatalog(scripts).find((e): e is Extract<Entry, { kind: "family" }> => e.kind === "family" && e.id === pickerFamily)
    : undefined;

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-row-menu]")) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuFor(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  useEffect(() => {
    if (scripts.length === 0 || installedModelIds.length === 0) {
      setUpdates({});
      return;
    }
    let active = true;
    void apiCheckModelUpdates(expandVariants(scripts).map((s) => s.manifest))
      .then((list) => {
        if (active) setUpdates(Object.fromEntries(list.map((u) => [u.model_id, u])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // The id list is rebuilt by the parent on every render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts, installedModelIds.join(",")]);

  useEffect(() => {
    if (!currentUser || hubError) {
      setMyRatings({});
      return;
    }
    let active = true;
    void apiMyRatings()
      .then((r) => active && setMyRatings(r))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentUser, hubError]);

  const rate = async (script: HubScript, stars: number | null) => {
    try {
      const result = await apiRateScript(script.slug, stars);
      setMyRatings((prev) => {
        const next = { ...prev };
        if (result.mine === null) delete next[script.slug];
        else next[script.slug] = result.mine;
        return next;
      });
      setScripts((prev) =>
        prev.map((s) => (s.slug === script.slug ? { ...s, rating: result.rating, rating_count: result.rating_count } : s))
      );
    } catch (err: unknown) {
      setInstallError(`Nie udało się zapisać oceny: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const requestUpdate = (script: HubScript) => {
    if (installingId) return;
    if (script.is_curated) void handleInstall(script);
    else setConfirmScript(script);
  };

  const isModelInstalled = (script: HubScript): boolean =>
    installedModelIds.includes(script.manifest.id);

  const requestInstall = (script: HubScript) => {
    if (installingId) return;
    if (script.is_curated) {
      void handleInstall(script);
    } else {
      setConfirmScript(script);
    }
  };

  const handleCancelInstall = () => cancelRunningInstall();

  const handleUninstall = async (script: HubScript) => {
    const modelId = script.manifest.id;
    setUninstallTarget(null);
    try {
      setUninstallingId(modelId);
      setInstallError(null);
      await apiUninstallModel(modelId);
      if (!isMountedRef.current) return;
      onModelUninstalled?.(modelId);
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setInstallError(
          `Nie udało się odinstalować modelu ${script.name}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } finally {
      if (isMountedRef.current) setUninstallingId(null);
    }
  };

  const handleInstall = async (script: HubScript) => {
    setConfirmScript(null);
    try {
      setInstallError(null);
      await startInstall(script.manifest, script.name);
      if (!hubError) {
        void apiRecordScriptInstall(script.slug || script.id);
      }

      onModelInstalled(script.manifest);
    } catch {
      // Shown from the store's outcome below, by whichever Hub view is open when it ends.
    }
  };

  const showOutcome = (name: string, error: string | null) => {
    if (error === null) {
      setInstallSuccessToast(`Model ${name} został pomyślnie zainstalowany!`);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) setInstallSuccessToast(null);
      }, 3500);
    } else {
      setInstallError(
        error.includes(CANCELLED)
          ? `Instalacja modelu ${name} została anulowana.`
          : `Nie udało się zainstalować modelu ${name}: ${error}`
      );
    }
  };

  useEffect(() => {
    if (!unseenOutcome) return;
    clearUnseenOutcome();
    showOutcome(unseenOutcome.name, unseenOutcome.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenOutcome]);

  useEffect(() => {
    if (!publishedScript) return;
    const script = publishedScript;
    onPublishedScriptHandled?.();
    if (script.status === "pending" || (script.standards ?? []).length > 0) setPublishNotice(script);
    if (script.status && script.status !== "published") {
      ownUnlistedRef.current = [script, ...ownUnlistedRef.current.filter((s) => s.slug !== script.slug)];
    }
    setScripts((prev) => [script, ...prev.filter((s) => s.slug !== script.slug)]);
    if (!installingId && !installedModelIds.includes(script.manifest.id)) {
      void handleInstall(script);
    }
    // Runs once per published model; the handlers are recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishedScript]);

  const displayName = (s: HubScript) =>
    s.manifest.family ? `${s.manifest.family.name} · ${s.manifest.family.variant}` : s.name;

  const installBar = (script: HubScript) => (
    <div className="flex items-center gap-2 w-full">
      <div
        className="relative flex-1 h-10 px-3 rounded-xl bg-secondary text-xs flex items-center min-w-0 overflow-hidden"
        {...(installPercent(installProgress) !== null && !cancelRequested
          ? {
              role: "progressbar",
              "aria-label": `Pobieranie ${script.name}`,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": installPercent(installProgress) ?? 0,
            }
          : {})}
      >
        {installPercent(installProgress) !== null && !cancelRequested && (
          <div
            aria-hidden="true"
            data-testid="install-progress-fill"
            className="absolute inset-y-0 left-0 bg-primary/60 transition-[width] duration-300"
            style={{ width: `${installPercent(installProgress)}%` }}
          />
        )}
        <span className="relative truncate font-medium" title={installProgress?.message}>
          {cancelRequested
            ? "Anulowanie…"
            : installProgress
              ? `${installProgress.step_index + 1}/${installProgress.total_steps}: ${installProgress.message}`
              : "Instalowanie..."}
        </span>
      </div>
      <Button
        variant="ghost"
        onClick={() => void handleCancelInstall()}
        disabled={cancelRequested}
        className="px-2"
        aria-label="Anuluj instalację"
      >
        Anuluj
      </Button>
    </div>
  );

  const renderEntry = (entry: Entry) => {
    const members = entryMembers(entry);
    const isFamily = entry.kind === "family";
    const lead = members[0];
    const key = isFamily ? `family:${entry.id}` : lead.id;
    const title = isFamily ? entry.name : lead.name;
    const installedMembers = members.filter(isModelInstalled);
    const installingMember = members.find((m) => m.manifest.id === installingId);
    const updatable = installedMembers.find((m) => updates[m.manifest.id]);
    const anyInstalled = installedMembers.length > 0;
    const adult = members.some((m) => m.is_adult || m.manifest.content_rating === "adult");
    const { recommended } = recommend(members, machine, allowOffload);
    const shown = isFamily ? recommended : lead;
    const sizes = members.map((m) => needs(m.manifest).vramGb);
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    const sizeRange =
      minSize === maxSize
        ? formatGb(minSize, lang)
        : `${formatGb(minSize, lang).replace(" GB", "")}–${formatGb(maxSize, lang)}`;
    const meta = [
      lead.author ? lead.author : null,
      isFamily ? `${variantsLabel(members.length, lang)}, ${sizeRange}` : null,
      !lead.is_curated ? "społeczność" : null,

      anyInstalled && !isFamily ? t("installedTag") : null,
    ].filter(Boolean);
    const reportable = currentUser && !hubError ? members.filter((m) => m.author !== currentUser.username) : [];
    const menuItems: { label: string; aria: string; onClick: () => void; danger?: boolean }[] = [
      ...installedMembers.map((m) => ({
        label: isFamily ? `${t("uninstall")} ${m.manifest.family?.variant ?? m.name}` : t("uninstall"),
        aria: `Odinstaluj ${m.name}`,
        onClick: () => setUninstallTarget(m),
        danger: true,
      })),
      ...(reportable.length > 0
        ? [{ label: "Zgłoś moderatorom", aria: `Zgłoś ${title}`, onClick: () => setReportTarget(isFamily ? { ...lead, name: title } : lead) }]
        : []),
    ];
    const menuOpen = menuFor === key;

    let action: React.ReactNode;
    if (installingMember) {
      action = installBar(installingMember);
    } else if (updatable) {
      action = (
        <button
          type="button"
          className={rowAction("primary")}
          disabled={installingId !== null}
          onClick={() => requestUpdate(updatable)}
          aria-label={`Aktualizuj ${updatable.name}`}
        >
          Aktualizuj
        </button>
      );
    } else if (isFamily) {
      action = (
        <button
          type="button"
          className={rowAction("outline")}
          onClick={() => setPickerFamily(entry.id)}
          aria-label={`${t("chooseVersion")}: ${entry.name}`}
        >
          {t("chooseVersion")}
        </button>
      );
    } else if (anyInstalled) {
      action = (
        <button
          type="button"
          className={rowAction("outline")}
          onClick={() => onOpenInWorkspace(lead.manifest.id)}
          disabled={uninstallingId === lead.manifest.id}
          aria-label={`${t("openModel")}: ${lead.name}`}
        >
          {uninstallingId === lead.manifest.id ? "Usuwanie…" : t("openModel")}
        </button>
      );
    } else {
      action = (
        <button type="button" className={rowAction("outline")} onClick={() => requestInstall(lead)} disabled={installingId !== null}>
          Zainstaluj
        </button>
      );
    }

    return (
      <li key={key} className="border-t border-border">
        <div className="grid grid-cols-[48px_minmax(0,1.2fr)_minmax(0,1.5fr)_188px_168px] items-center gap-[22px] py-[18px]">
          <span
            aria-hidden="true"
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-[14px]",
              anyInstalled ? "bg-primary text-primary-foreground" : "bg-soft text-ink"
            )}
          >
            {categoryIcon(lead.category, 24)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h3 className="text-lg font-bold tracking-[-0.01em]">{title}</h3>
              {adult && (
                <span className="text-xs font-extrabold text-destructive" title={t("settingsAdult")}>
                  {t("adultTag")}
                </span>
              )}
              {[...new Set(members.map((m) => m.status ?? "published"))]
                .filter((status) => status !== "published")
                .map((status) => (
                  <StatusBadge key={status} status={status} />
                ))}
            </div>
            <div className="mt-[3px] text-[13px] text-muted-foreground">{meta.join(" · ")}</div>
            {updatable && (
              <div className="mt-1 text-[13px] font-bold text-ink" data-testid="model-update">
                {updates[updatable.manifest.id].installed_version !== updates[updatable.manifest.id].available_version
                  ? `${t("newVersion")}: ${updates[updatable.manifest.id].installed_version} → ${updates[updatable.manifest.id].available_version}`
                  : "Autor zmienił pakiet tego modelu"}
              </div>
            )}
          </div>
          <div className="min-w-0 text-sm leading-normal text-muted-foreground">
            <p className="line-clamp-2">{isFamily ? shown.manifest.description || lead.description : lead.description}</p>
            {!hubError && !isFamily && (
              <div className="mt-1.5">
                <StarRating
                  name={lead.name}
                  average={lead.rating}
                  count={lead.rating_count}
                  mine={myRatings[lead.slug] ?? null}
                  onRate={
                    currentUser && lead.author !== currentUser.username && (lead.status ?? "published") === "published"
                      ? (stars) => void rate(lead, stars)
                      : undefined
                  }
                />
              </div>
            )}
          </div>
          <FitMeter
            manifest={shown.manifest}
            machine={machine}
            allowOffload={allowOffload}
            prefix={isFamily ? `${shown.manifest.family?.variant}:` : undefined}
          />
          <div className="relative flex items-center gap-1" data-row-menu>
            {action}
            {menuItems.length > 0 && (
              <>
                <button
                  type="button"
                  aria-label={fmt(t("moreOptions"), { x: title })}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuFor(menuOpen ? null : key)}
                  className="flex h-10 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <DotsIcon size={18} />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label={fmt(t("moreOptions"), { x: title })}
                    className="absolute right-0 top-full z-30 mt-1 min-w-[220px] rounded-2xl border border-border bg-card py-1.5 shadow-pop"
                  >
                    {menuItems.map((item) => (
                      <button
                        key={item.aria}
                        type="button"
                        role="menuitem"
                        aria-label={item.aria}
                        onClick={() => {
                          setMenuFor(null);
                          item.onClick();
                        }}
                        className={cn(
                          "h-10 w-full cursor-pointer px-4 text-left text-sm hover:bg-secondary",
                          item.danger && "text-destructive"
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {isFamily && installedMembers.length > 0 && !installingMember && (
          <div className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 pb-3.5 pl-[70px] text-[13px]">
            {installedMembers.map((m) => (
              <button
                key={m.manifest.id}
                type="button"
                onClick={() => onOpenInWorkspace(m.manifest.id)}
                className="cursor-pointer font-semibold underline underline-offset-2 hover:text-ink"
                aria-label={`${t("openModel")}: ${m.name}`}
              >
                {t("openModel")} {m.manifest.family?.variant ?? m.name}
              </button>
            ))}
          </div>
        )}
      </li>
    );
  };

  const heroInstalled = hero ? isModelInstalled(hero.script) : false;
  const heroNeed = hero ? needs(hero.script.manifest).vramGb : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {installSuccessToast && (
        <div role="status" className="bg-ok/15 border-b border-ok/30 text-foreground px-7 py-2.5 text-sm flex items-center justify-between">
          <span className="font-medium">{installSuccessToast}</span>
          <button type="button" onClick={() => setInstallSuccessToast(null)} className="text-sm hover:underline cursor-pointer">
            {t("close")}
          </button>
        </div>
      )}

      {publishNotice && (
        <div
          role="status"
          className={cn(
            "border-b px-7 py-2.5 text-sm flex items-start justify-between gap-4",
            publishNotice.status === "pending" ? "bg-warn/10 border-warn/30" : "bg-secondary/60 border-border"
          )}
        >
          <div className="space-y-1">
            <p className="font-medium">
              {publishNotice.status === "pending"
                ? `Model ${publishNotice.name} czeka na przegląd moderatora. Do tego czasu widzisz go tylko Ty (Profil → Moje modele).`
                : `Model ${publishNotice.name} jest opublikowany. Wskazówki, jak ulepszyć wpis:`}
            </p>
            <StandardsList issues={publishNotice.standards} />
          </div>
          <button type="button" onClick={() => setPublishNotice(null)} className="text-sm hover:underline shrink-0 cursor-pointer">
            {t("close")}
          </button>
        </div>
      )}

      {installError && (
        <div role="alert" className="bg-destructive/10 border-b border-destructive/30 text-destructive px-7 py-2.5 text-sm flex items-center justify-between gap-4">
          <span className="font-medium break-all">{installError}</span>
          <div className="flex items-center gap-3 shrink-0">
            {/gated|Hugging Face token|no access/i.test(installError) && (
              <button type="button" onClick={() => setShowTokenModal(true)} className="font-semibold hover:underline cursor-pointer">
                Dodaj token Hugging Face
              </button>
            )}
            <button type="button" onClick={() => setInstallError(null)} className="hover:underline cursor-pointer">
              {t("close")}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[clamp(1180px,62vw,1760px)] flex-col gap-[30px] px-12 pb-10 pt-8">
          <header className="flex flex-wrap items-end gap-6">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em]">{t("catalogTitle")}</h1>
              {hubError && (
                <p role="status" className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warn" />
                  <span>
                    {cachedAt !== null
                      ? lang === "en"
                        ? `Hub is unreachable, so this is the catalog saved ${formatCacheDate(cachedAt, lang)}.`
                        : `Hub jest niedostępny, więc pokazuję katalog zapisany ${formatCacheDate(cachedAt, lang)}.`
                      : lang === "en"
                        ? "Hub is unreachable, so this is the built-in catalog of official models."
                        : "Hub jest niedostępny, więc pokazuję wbudowany katalog oficjalnych modeli."}
                  </span>
                  <InfoTip text={`${lang === "en" ? "Reason" : "Powód"}: ${hubError}`} align="left" />
                  <button
                    type="button"
                    onClick={() => void loadScripts()}
                    disabled={isLoading}
                    className="cursor-pointer text-[13px] font-semibold text-foreground underline disabled:opacity-50"
                  >
                    {t("tryAgain")}
                  </button>
                </p>
              )}
            </div>
            <label className="flex h-11 w-[260px] items-center gap-2.5 border-b-2 border-border text-muted-foreground focus-within:border-foreground">
              <SearchIcon size={18} />
              <input
                type="text"
                value={searchQuery ?? ""}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("catSearchModels")}
                aria-label={t("searchModelsPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
            {_onOpenUploadModal && (
              <button
                type="button"
                onClick={_onOpenUploadModal}
                className="flex h-11 cursor-pointer items-center gap-2 px-1 text-sm font-semibold hover:text-ink"
              >
                <UploadIcon size={18} />
                {t("publishModel")}
              </button>
            )}
          </header>

          {hero && !isLoading && (
            <section
              aria-label={t("catalogHeroKicker")}
              className="flex flex-wrap items-center gap-x-12 gap-y-7 rounded-[30px] bg-primary px-10 py-[34px] text-primary-foreground"
            >
              <div className="flex min-w-[380px] flex-[1_1_380px] flex-col gap-3.5">
                <div className="text-[13px] font-bold uppercase tracking-[.05em]">{t("catalogHeroKicker")}</div>
                <h2 className="font-display text-[54px] font-extrabold leading-none tracking-[-0.03em]">{displayName(hero.script)}</h2>
                <p className="max-w-[460px] text-base leading-[1.55]">
                  {hero.script.manifest.description || hero.script.description}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-6">
                  {installingId === hero.script.manifest.id ? (
                    <span className="text-sm font-bold">Instalowanie…</span>
                  ) : heroInstalled ? (
                    <button
                      type="button"
                      onClick={() => onOpenInWorkspace(hero.script.manifest.id)}
                      className="h-[52px] cursor-pointer rounded-2xl bg-primary-foreground px-7 text-base font-extrabold text-primary"
                    >
                      {t("catalogHeroOpen")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => requestInstall(hero.script)}
                      disabled={installingId !== null}
                      aria-label={`${t("catalogHeroInstall")} ${displayName(hero.script)}`}
                      className="h-[52px] cursor-pointer rounded-2xl bg-primary-foreground px-7 text-base font-extrabold text-primary disabled:opacity-60"
                    >
                      {t("catalogHeroInstall")}
                    </button>
                  )}
                  {hero.siblings.length > 1 && hero.script.manifest.family && (
                    <button
                      type="button"
                      onClick={() => setPickerFamily(hero.script.manifest.family!.id)}
                      className="cursor-pointer text-sm font-bold underline underline-offset-2"
                    >
                      {t("catalogCompare")} ({hero.siblings.length})
                    </button>
                  )}
                </div>
              </div>
              <div className="flex min-w-[380px] max-w-[460px] flex-[1_1_380px] flex-col gap-2.5">
                {(() => {
                  const card = effectiveVram ?? 0;
                  const inCard = Math.min(heroNeed, card);
                  const spill = Math.max(0, heroNeed - card);
                  const pct = card > 0 ? Math.round((inCard / card) * 100) : 0;
                  return (
                    <>
                      <div className="flex justify-between text-[13px] font-bold">
                        <span>{t("catHeroYourCard")}</span>
                        <span className="font-mono">{formatGb(card, lang)}</span>
                      </div>
                      <div
                        role="img"
                        aria-label={`${t("catHeroYourCard")} ${formatGb(card, lang)}, ${fmt(t("catHeroModel"), { x: formatGb(heroNeed, lang) })}`}
                        className="flex h-[22px] overflow-hidden rounded-[11px] border-2 border-primary-foreground"
                      >
                        <div className="bg-primary-foreground" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between text-[13px]">
                        <span className="font-bold">{fmt(t("catHeroModel"), { x: formatGb(heroNeed, lang) })}</span>
                        <span>
                          {spill > 0
                            ? fmt(t("catHeroSpills"), { x: formatGb(spill, lang) })
                            : fmt(t("catHeroLeft"), { x: formatGb(Math.max(0, card - heroNeed), lang) })}
                        </span>
                      </div>
                      {ramGb !== undefined && (
                        <div className="mt-1.5 text-[13px]">{fmt(t("catHeroRam"), { x: formatGb(ramGb, lang) })}</div>
                      )}
                    </>
                  );
                })()}
              </div>
            </section>
          )}

          <div className="sticky top-0 z-[3] -mt-2 flex flex-wrap items-end gap-7 border-b border-border bg-background pt-2">
            <div role="tablist" aria-label="Kategorie modeli" className="flex gap-7">
              {CATEGORY_TABS.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedCategory === cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "-mb-px cursor-pointer border-b-[3px] pb-3 text-base",
                    selectedCategory === cat.id
                      ? "border-ink font-extrabold text-foreground"
                      : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                  )}
                >
                  {cat[lang]}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <label className="flex cursor-pointer items-center gap-2 pb-3 text-sm">
              <input
                type="checkbox"
                checked={onlyCurated}
                onChange={() => setOnlyCurated((v) => !v)}
                className="h-[18px] w-[18px] accent-[hsl(var(--ink))]"
              />
              {t("curatedOnly")}
            </label>
            <label className="flex items-center gap-2 pb-2.5 text-sm text-muted-foreground">
              {t("catSortLabel")}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as HubSortOption)}
                aria-label="Sortuj"
                className="h-9 cursor-pointer bg-transparent text-sm font-semibold text-foreground focus:outline-none"
              >
                <option value="default">{t("catSortDefault")}</option>
                <option value="name_asc">{t("catSortName")}</option>
                <option value="vram_asc">{t("catSortSizeAsc")}</option>
                <option value="vram_desc">{t("catSortSizeDesc")}</option>
                <option value="rating">{t("catSortRating")}</option>
              </select>
            </label>
          </div>

          {isLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Ładowanie katalogu modeli...</p>
          ) : entries.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold">Brak modeli spełniających kryteria</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Spróbuj zmienić frazę wyszukiwania lub zresetować filtry kategorii.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-[34px]" aria-label="Modele" role="list">
              {groups
                .filter((g) => g.id !== "none" || showUnfit)
                .map((g) => (
                  <section key={g.id} aria-label={g.title} role="listitem" className="flex flex-col">
                    <div className="mb-1.5 flex items-baseline gap-3">
                      <span aria-hidden="true" className={cn("relative -top-px h-2.5 w-2.5 shrink-0 rounded-full", g.dot)} />
                      <h2 className="font-display text-[22px] font-bold tracking-[-0.01em]">{g.title}</h2>
                      <span className="text-[13px] text-muted-foreground">{g.note}</span>
                    </div>
                    <ul>{g.entries.map(renderEntry)}</ul>
                  </section>
                ))}
              {unfitCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowUnfit((v) => !v)}
                  aria-expanded={showUnfit}
                  className="cursor-pointer self-start text-sm font-semibold text-muted-foreground underline hover:text-foreground"
                >
                  {showUnfit ? t("catHideUnfit") : `${t("catShowUnfit")} (${unfitCount})`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {pickerEntry && (
        <VersionPickerDialog
          familyName={pickerEntry.name}
          members={pickerEntry.members}
          machine={machine}
          allowOffload={allowOffload}
          installedIds={installedModelIds}
          busy={installingId !== null}
          onClose={() => setPickerFamily(null)}
          onOpen={(m) => {
            setPickerFamily(null);
            onOpenInWorkspace(m.manifest.id);
          }}
          onInstall={(m) => {
            setPickerFamily(null);
            requestInstall(m);
          }}
        />
      )}

      {confirmScript && (
        <CommunityInstallDialog
          script={confirmScript}
          onCancel={() => setConfirmScript(null)}
          onConfirm={() => void handleInstall(confirmScript)}
        />
      )}

      <HfTokenModal isOpen={showTokenModal} onClose={() => setShowTokenModal(false)} />

      {reportTarget && (
        <ReportScriptModal
          script={reportTarget}
          onClose={() => setReportTarget(null)}
          onReported={(message) => {
            setReportTarget(null);
            setInstallSuccessToast(message);
          }}
        />
      )}

      {uninstallTarget && (
        <Modal
          isOpen={true}
          onClose={() => setUninstallTarget(null)}
          title={`Odinstalować ${uninstallTarget.name}?`}
          variant="destructive"
          size="sm"
          aria-labelledby="uninstall-title"
        >
          <p className="m-0 text-[14.5px] leading-[1.6] text-muted-foreground">{t("confirmUninstallDesc")}</p>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
            <Button variant="outline" size="lg" onClick={() => setUninstallTarget(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" size="lg" onClick={() => void handleUninstall(uninstallTarget)}>
              {t("uninstall")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CommunityInstallDialog({
  script,
  onCancel,
  onConfirm,
}: {
  script: HubScript;
  onCancel: () => void;
  onConfirm: () => void;
  }) {
  const { packages, repos, args } = installSummary(script.manifest);
  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title={`Model społecznościowy: ${script.name}`}
      variant="warning"
      size="md"
      aria-labelledby="community-install-title"
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Ten pakiet nie został zweryfikowany przez LemonAI
          {script.author ? ` (autor: ${script.author})` : ""}. Instalowane są tylko pakiety z
          zatwierdzonej listy dla tego typu modelu, ale wagi pobierane są z repozytorium wskazanego
          przez autora. Instaluj tylko, jeśli ufasz źródłu.
        </p>
        <dl className="text-[11px] space-y-1.5 font-mono bg-secondary/40 rounded-lg p-3 border border-border max-h-48 overflow-y-auto">
          {repos.length > 0 && (
            <div>
              <dt className="text-muted-foreground">Pobierane z Hugging Face:</dt>
              <dd className="text-foreground break-all">{repos.join(", ")}</dd>
            </div>
          )}
          {packages.length > 0 && (
            <div>
              <dt className="text-muted-foreground">Pakiety Python:</dt>
              <dd className="text-foreground break-all">{packages.join(" ")}</dd>
            </div>
          )}
          {args.length > 0 && (
            <div>
              <dt className="text-muted-foreground">Argumenty serwera:</dt>
              <dd className="text-foreground break-all">{args.join(" ")}</dd>
            </div>
          )}
        </dl>
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onCancel}>
            Anuluj
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={onConfirm}>
            Zainstaluj mimo to
          </Button>
        </div>
      </div>
    </Modal>
  );
}
