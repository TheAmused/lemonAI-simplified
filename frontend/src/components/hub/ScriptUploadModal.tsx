import { useState, useCallback, useEffect } from "react";
import {
  apiCheckStandards,
  apiUploadScript,
  type StandardIssue,
  type HubScript,
  type HubUser,
} from "@/lib/hub-api";
import { HfFilePicker } from "@/components/hub/HfFilePicker";
import { StandardsList } from "@/components/hub/ModerationBits";
import { DialogError, DialogField, DialogFooter, FileDrop } from "@/components/ui/dialog-parts";
import { dialogInput, dialogSelect, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import {
  buildManifest,
  DraftError,
  slugify,
  type RunnerKind,
} from "@/lib/manifest-builder";

export interface ScriptUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScriptUploaded: (script: HubScript) => void;
  currentUser: HubUser | null;
  onOpenAuth: () => void;
}

const CATEGORIES = [
  { value: "llm", label: "LLM / Tekst" },
  { value: "image", label: "Obraz (Diffusers)" },
  { value: "audio", label: "Audio / Mowa" },
  { value: "code", label: "Kod / Programowanie" },
  { value: "other", label: "Inne" },
] as const;

const RUNNERS: { value: RunnerKind; label: string }[] = [
  { value: "transformers", label: "Transformers (tekst / kod)" },
  { value: "gguf", label: "GGUF (llama.cpp)" },
  { value: "diffusers", label: "Diffusers (obraz)" },
  { value: "audio", label: "Audio (Whisper)" },
];

const DEFAULT_RUNNER: Record<string, RunnerKind> = {
  llm: "transformers",
  code: "transformers",
  image: "diffusers",
  audio: "audio",
  other: "transformers",
};

export function ScriptUploadModal({
  isOpen,
  onClose,
  onScriptUploaded,
  currentUser,
  onOpenAuth,
}: ScriptUploadModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState<string>("llm");
  const [description, setDescription] = useState("");
  const [runner, setRunner] = useState<RunnerKind>("transformers");
  const [repoId, setRepoId] = useState("");
  const [filename, setFilename] = useState("");
  const [sha256, setSha256] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [pickNote, setPickNote] = useState<string | null>(null);

  const [minVramGb, setMinVramGb] = useState("4");
  const [minRamGb, setMinRamGb] = useState("8");
  const [recommendedCtxSize, setRecommendedCtxSize] = useState("8192");
  const [maxSupportedCtxSize, setMaxSupportedCtxSize] = useState("32768");
  const [recommendedOutputTokens, setRecommendedOutputTokens] = useState("4096");
  const [maxSupportedOutputTokens, setMaxSupportedOutputTokens] = useState("32768");

  const [previewImageFile, setPreviewImageFile] = useState<File | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [standards, setStandards] = useState<StandardIssue[]>([]);
  const [reviewNeeded, setReviewNeeded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    const isLlm = runner === "gguf" || runner === "transformers";
    const optInt = (raw: string) => (raw.trim() === "" ? undefined : Number(raw));
    let manifest;
    try {
      manifest = buildManifest({
        name,
        slug,
        description,
        category,
        runner,
        repoId,
        filename,
        sha256,
        minVramGb: minVramGb.trim() === "" ? Number.NaN : Number(minVramGb),
        minRamGb: minRamGb.trim() === "" ? Number.NaN : Number(minRamGb),
        ...(isLlm
          ? {
              recommendedCtxSize: optInt(recommendedCtxSize),
              maxSupportedCtxSize: optInt(maxSupportedCtxSize),
              recommendedOutputTokens: optInt(recommendedOutputTokens),
              maxSupportedOutputTokens: optInt(maxSupportedOutputTokens),
            }
          : {}),
      });
    } catch {
      setStandards([]);
      setReviewNeeded(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      apiCheckStandards({
        name: manifest.name,
        description: manifest.description ?? "",
        manifest,
        has_preview_image: previewImageFile !== null,
      })
        .then((res) => {
          if (cancelled) return;
          setStandards(res.standards);
          setReviewNeeded(res.will_need_review);
        })
        .catch(() => {
          if (cancelled) return;
          setStandards([]);
          setReviewNeeded(null);
        });
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    isOpen,
    currentUser,
    name,
    slug,
    description,
    category,
    runner,
    repoId,
    filename,
    sha256,
    minVramGb,
    minRamGb,
    recommendedCtxSize,
    maxSupportedCtxSize,
    recommendedOutputTokens,
    maxSupportedOutputTokens,
    previewImageFile,
  ]);

  const resetForm = useCallback(() => {
    setName("");
    setSlug("");
    setCategory("llm");
    setDescription("");
    setRunner("transformers");
    setRepoId("");
    setFilename("");
    setSha256("");
    setPickNote(null);
    setMinVramGb("4");
    setMinRamGb("8");
    setRecommendedCtxSize("8192");
    setMaxSupportedCtxSize("32768");
    setRecommendedOutputTokens("4096");
    setMaxSupportedOutputTokens("32768");
    setPreviewImageFile(null);
    setStandards([]);
    setReviewNeeded(null);
    setErrorMsg(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (previewImageFile) {
      const lowerImg = previewImageFile.name.toLowerCase();
      const allowed = [".png", ".jpg", ".jpeg", ".webp", ".svg"];
      if (!allowed.some((ext) => lowerImg.endsWith(ext))) {
        setErrorMsg(`Dozwolone formaty miniatury: ${allowed.join(", ")}`);
        return;
      }
    }

    const isLlmRunner = runner === "gguf" || runner === "transformers";
    const parseOptionalInt = (raw: string) => {
      const trimmed = raw.trim();
      return trimmed === "" ? undefined : Number(trimmed);
    };

    let manifest;
    try {
      manifest = buildManifest({
        name,
        slug,
        description,
        category,
        runner,
        repoId,
        filename,
        sha256,
        minVramGb: minVramGb.trim() === "" ? Number.NaN : Number(minVramGb),
        minRamGb: minRamGb.trim() === "" ? Number.NaN : Number(minRamGb),
        ...(isLlmRunner
          ? {
              recommendedCtxSize: parseOptionalInt(recommendedCtxSize),
              maxSupportedCtxSize: parseOptionalInt(maxSupportedCtxSize),
              recommendedOutputTokens: parseOptionalInt(recommendedOutputTokens),
              maxSupportedOutputTokens: parseOptionalInt(maxSupportedOutputTokens),
            }
          : {}),
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof DraftError ? err.message : String(err));
      return;
    }

    const metadata = {
      name: manifest.name,
      slug: manifest.id,
      description: manifest.description,
      category,
      manifest,
    };

    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    if (previewImageFile) {
      formData.append("preview_image", previewImageFile);
    }

    try {
      setIsUploading(true);
      const uploaded = await apiUploadScript(formData);
      onScriptUploaded(uploaded);
      handleClose();
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Błąd podczas przesyłania skryptu"
      );
    } finally {
      setIsUploading(false);
    }
  };

  const isLlmRunner = runner === "gguf" || runner === "transformers";
  const numField = cn(dialogInput, "font-mono");

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("uploadModalTitle")}
      description={currentUser ? t("uploadModalDesc") : undefined}
      size="xl"
      aria-labelledby="upload-modal-title"
    >
      {!currentUser ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <p className="m-0 text-sm font-semibold text-foreground">{t("loginRequired")}</p>
          <button
            type="button"
            onClick={() => {
              handleClose();
              onOpenAuth();
            }}
            className={cn(primaryButton, "mt-2")}
          >
            {t("loginToUpload")}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-5">
            {errorMsg && <DialogError>{errorMsg}</DialogError>}

            <p className="m-0 rounded-xl bg-background px-4 py-3 text-sm leading-normal text-muted-foreground">
              Hub nie przyjmuje własnych skryptów: model uruchamia jeden z wbudowanych runnerów, a wagi są
              pobierane z Hugging Face (tylko <code className="font-mono">.safetensors</code> i{" "}
              <code className="font-mono">.gguf</code>).
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <DialogField label="Nazwa modelu *">
                <input
                  id="model-name"
                  type="text"
                  required
                  value={name ?? ""}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Mistral 7B Polish Assistant"
                  className={dialogInput}
                  disabled={isUploading}
                />
              </DialogField>
              <DialogField
                label="Identyfikator (slug, opcjonalny)"
                hint={
                  (slug.trim() || name.trim()) && (
                    <span className="font-mono">id: {slugify(slug.trim() || name) || "(zostanie wygenerowany)"}</span>
                  )
                }
              >
                <input
                  id="model-slug"
                  type="text"
                  value={slug ?? ""}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="mistral-7b-polish"
                  className={numField}
                  disabled={isUploading}
                />
              </DialogField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <DialogField label="Kategoria">
                <select
                  id="model-category"
                  value={category ?? "llm"}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setRunner(DEFAULT_RUNNER[e.target.value] ?? "transformers");
                  }}
                  className={dialogSelect}
                  disabled={isUploading}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </DialogField>
              <DialogField label="Typ runnera">
                <select
                  id="model-runner"
                  value={runner}
                  onChange={(e) => {
                    const next = e.target.value as RunnerKind;
                    setRunner(next);
                    if (next === "gguf" && maxSupportedCtxSize === "32768") {
                      setMaxSupportedCtxSize("131072");
                    } else if (next === "transformers" && maxSupportedCtxSize === "131072") {
                      setMaxSupportedCtxSize("32768");
                    }
                    if (next === "gguf" && maxSupportedOutputTokens === "32768") {
                      setMaxSupportedOutputTokens("131072");
                    } else if (next === "transformers" && maxSupportedOutputTokens === "131072") {
                      setMaxSupportedOutputTokens("32768");
                    }
                  }}
                  className={dialogSelect}
                  disabled={isUploading}
                >
                  {RUNNERS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </DialogField>
            </div>

            <div>
              <label htmlFor="model-repo" className="mb-1.5 block text-[13px] font-bold">
                Repozytorium Hugging Face *
              </label>
              <div className="flex items-center gap-2.5">
                <input
                  id="model-repo"
                  type="text"
                  value={repoId}
                  onChange={(e) => {
                    setRepoId(e.target.value);
                    setSha256("");
                    setPickNote(null);
                  }}
                  placeholder="owner/model-name"
                  className={cn(numField, "flex-1")}
                  disabled={isUploading}
                />
                <button
                  type="button"
                  className={cn(outlineButton, "shrink-0")}
                  disabled={isUploading || !repoId.trim()}
                  onClick={() => setShowPicker(true)}
                >
                  Sprawdź pliki…
                </button>
              </div>
              {runner !== "gguf" && pickNote && (
                <p className="m-0 mt-1.5 text-[12.5px] font-semibold text-ok" data-testid="pick-note">
                  {pickNote}
                </p>
              )}
            </div>

            {runner === "gguf" && (
              <div>
                <label htmlFor="model-filename" className="mb-1.5 block text-[13px] font-bold">
                  Plik GGUF w repozytorium *
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    id="model-filename"
                    type="text"
                    value={filename}
                    onChange={(e) => {
                      setFilename(e.target.value);
                      setSha256("");
                    }}
                    placeholder="model-Q4_K_M.gguf"
                    className={cn(numField, "flex-1")}
                    disabled={isUploading}
                  />
                  <button
                    type="button"
                    className={cn(outlineButton, "shrink-0")}
                    disabled={isUploading || !repoId.trim()}
                    onClick={() => setShowPicker(true)}
                  >
                    Wybierz plik…
                  </button>
                </div>
                {pickNote && (
                  <p className="m-0 mt-1.5 text-[12.5px] font-semibold text-ok" data-testid="pick-note">
                    {pickNote}
                  </p>
                )}
              </div>
            )}

            {showPicker && (
              <HfFilePicker
                repoId={repoId.trim()}
                runner={runner}
                onClose={() => setShowPicker(false)}
                onPick={({ file, assessment }) => {
                  setShowPicker(false);
                  if (file) {
                    setFilename(file.path);
                    setSha256(file.sha256 ?? "");
                  }
                  if (assessment.suggestedVramGb > 0) {
                    setMinVramGb(String(assessment.suggestedVramGb));
                    setMinRamGb(String(assessment.suggestedRamGb));
                  }
                  setPickNote(
                    `Pobieranie: ${(assessment.downloadBytes / 1e9).toFixed(2)} GB` +
                      (file?.sha256 ? " · suma SHA-256 dodana do manifestu" : file ? " · plik bez sumy SHA-256 w repozytorium" : "") +
                      ` · wymagania ustawione na VRAM ${assessment.suggestedVramGb} GB / RAM ${assessment.suggestedRamGb} GB (możesz je zmienić).`
                  );
                }}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <DialogField label="Min VRAM (GB)">
                <input
                  id="min-vram"
                  type="number"
                  step="0.5"
                  min="0"
                  value={minVramGb}
                  onChange={(e) => setMinVramGb(e.target.value)}
                  className={numField}
                  disabled={isUploading}
                />
              </DialogField>
              <DialogField label="Min RAM (GB)">
                <input
                  id="min-ram"
                  type="number"
                  step="0.5"
                  min="1"
                  value={minRamGb}
                  onChange={(e) => setMinRamGb(e.target.value)}
                  className={numField}
                  disabled={isUploading}
                />
              </DialogField>
            </div>

            {isLlmRunner && (
              <div className="grid grid-cols-2 gap-4">
                <DialogField label="Zalecane okno kontekstu">
                  <input
                    id="ctx-recommended"
                    type="number"
                    min="256"
                    max="2097152"
                    step="1"
                    value={recommendedCtxSize}
                    onChange={(e) => setRecommendedCtxSize(e.target.value)}
                    placeholder="8192"
                    className={numField}
                    disabled={isUploading}
                  />
                </DialogField>
                <DialogField label="Maks. obsługiwane okno kontekstu">
                  <input
                    id="ctx-max-supported"
                    type="number"
                    min="256"
                    max="2097152"
                    step="1"
                    value={maxSupportedCtxSize}
                    onChange={(e) => setMaxSupportedCtxSize(e.target.value)}
                    placeholder="32768"
                    className={numField}
                    disabled={isUploading}
                  />
                </DialogField>
                <DialogField label="Zalecany limit wyjścia">
                  <input
                    id="out-recommended"
                    type="number"
                    min="64"
                    max="2097152"
                    step="1"
                    value={recommendedOutputTokens}
                    onChange={(e) => setRecommendedOutputTokens(e.target.value)}
                    placeholder="2048"
                    className={numField}
                    disabled={isUploading}
                  />
                </DialogField>
                <DialogField label="Maks. obsługiwane wyjście">
                  <input
                    id="out-max-supported"
                    type="number"
                    min="64"
                    max="2097152"
                    step="1"
                    value={maxSupportedOutputTokens}
                    onChange={(e) => setMaxSupportedOutputTokens(e.target.value)}
                    placeholder="8192"
                    className={numField}
                    disabled={isUploading}
                  />
                </DialogField>
              </div>
            )}

            <DialogField label="Opis modelu i zastosowanie *" hint="Co najmniej 40 znaków.">
              <textarea
                id="model-description"
                rows={3}
                required
                value={description ?? ""}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Krótki opis możliwości, architektury i wymaganych zależności..."
                className={cn(dialogInput, "h-auto min-h-[96px] resize-y px-3.5 py-3 leading-normal")}
                disabled={isUploading}
              />
            </DialogField>

            <div>
              <div className="mb-1.5 text-[13px] font-bold">Baner / podgląd (opcjonalny)</div>
              <FileDrop
                accept=".png,.jpg,.jpeg,.webp,.svg"
                file={previewImageFile}
                onFile={setPreviewImageFile}
                disabled={isUploading}
                ariaLabel="Baner / podgląd"
                hint={
                  <>
                    Przeciągnij obraz tutaj lub <span className="font-bold text-foreground underline">wybierz plik</span>
                    <br />
                    PNG, JPG, WEBP lub SVG
                  </>
                }
              />
            </div>

            {standards.length > 0 && <StandardsList issues={standards} />}
          </div>

          <DialogFooter
            left={
              reviewNeeded !== null && (
                <span className="text-[13px] text-muted-foreground">
                  {reviewNeeded ? t("uploadReviewNote") : t("uploadPublishNow")}
                </span>
              )
            }
          >
            <button type="button" className={outlineButton} onClick={handleClose} disabled={isUploading}>
              {t("cancel")}
            </button>
            <button type="submit" className={primaryButton} disabled={isUploading}>
              {isUploading ? t("processing") : t("uploadSubmit")}
            </button>
          </DialogFooter>
        </form>
      )}
    </Modal>
  );
}
