import { useState, useEffect } from "react";
import type { ModelPackageManifest } from "@/types/manifest";
import { apiUpdateScript, type HubScript } from "@/lib/hub-api";
import { DialogError, DialogField, DialogFooter, FileDrop } from "@/components/ui/dialog-parts";
import { dialogInput, dialogSelect, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";

export interface ScriptEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  script: HubScript | null;
  onScriptUpdated: (updated: HubScript) => void;
}

const CATEGORIES = [
  { value: "llm", label: "LLM / Tekst" },
  { value: "image", label: "Obraz (Diffusers)" },
  { value: "audio", label: "Audio / Mowa" },
  { value: "code", label: "Kod / Programowanie" },
  { value: "other", label: "Inne" },
] as const;

export function ScriptEditModal({
  isOpen,
  onClose,
  script,
  onScriptUpdated,
}: ScriptEditModalProps) {
  useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("llm");
  const [minVramGb, setMinVramGb] = useState("4");
  const [minRamGb, setMinRamGb] = useState("8");
  const [previewImageFile, setPreviewImageFile] = useState<File | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (script) {
      setName(script.name);
      setDescription(script.description);
      setCategory(script.category || "llm");
      setMinVramGb(String(script.min_vram_gb));
      setMinRamGb(String(script.min_ram_gb));
      setPreviewImageFile(null);
      setErrorMsg(null);
    }
  }, [script, isOpen]);

  if (!script) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (!trimmedName || !trimmedDesc) {
      setErrorMsg("Nazwa oraz opis manifestu są wymagane.");
      return;
    }

    const vramNum = parseFloat(minVramGb);
    const ramNum = parseFloat(minRamGb);

    if (isNaN(vramNum) || vramNum < 0 || isNaN(ramNum) || ramNum < 1) {
      setErrorMsg("Podaj poprawne wartości numeryczne dla wymagań sprzętowych.");
      return;
    }

    try {
      setIsSaving(true);
      const manifestData: Partial<ModelPackageManifest> & Record<string, unknown> = script.manifest ? { ...script.manifest } : { id: script.slug };
      manifestData.name = trimmedName;
      manifestData.description = trimmedDesc;
      manifestData.category = category;
      manifestData.hardware_requirements = {
        ...(manifestData.hardware_requirements || {}),
        min_vram_gb: vramNum,
        min_ram_gb: ramNum,
      };

      const metadata = JSON.stringify({
        name: trimmedName,
        description: trimmedDesc,
        category,
        hardware_requirements: {
          min_vram_gb: vramNum,
          min_ram_gb: ramNum,
        },
        manifest: manifestData,
      });

      const formData = new FormData();
      formData.append("metadata", metadata);
      if (previewImageFile) {
        formData.append("preview_image", previewImageFile);
      }

      const updated = await apiUpdateScript(script.slug, formData);
      onScriptUpdated(updated);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Nie udało się zaktualizować manifestu");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edytuj manifest: ${script.name}`}
      size="md"
      aria-labelledby="script-edit-modal-title"
    >
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4">
          {errorMsg && <DialogError>{errorMsg}</DialogError>}

          <DialogField label="Nazwa modelu">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={dialogInput}
              disabled={isSaving}
              required
            />
          </DialogField>

          <DialogField label="Kategoria">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={dialogSelect}
              disabled={isSaving}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </DialogField>

          <DialogField label="Opis modelu">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className={cn(dialogInput, "h-auto min-h-[96px] resize-y px-3.5 py-3 leading-normal")}
              disabled={isSaving}
              required
            />
          </DialogField>

          <div className="grid grid-cols-2 gap-4">
            <DialogField label="Min. VRAM (GB)">
              <input
                type="number"
                step="0.5"
                min="0"
                value={minVramGb}
                onChange={(e) => setMinVramGb(e.target.value)}
                className={cn(dialogInput, "font-mono")}
                disabled={isSaving}
              />
            </DialogField>
            <DialogField label="Min. RAM (GB)">
              <input
                type="number"
                step="1"
                min="1"
                value={minRamGb}
                onChange={(e) => setMinRamGb(e.target.value)}
                className={cn(dialogInput, "font-mono")}
                disabled={isSaving}
              />
            </DialogField>
          </div>

          <div>
            <div className="mb-1.5 text-[13px] font-bold">Nowy baner podglądu (opcjonalnie)</div>
            <FileDrop
              accept=".png,.jpg,.jpeg,.webp,.svg"
              file={previewImageFile}
              onFile={setPreviewImageFile}
              disabled={isSaving}
              ariaLabel="Nowy baner podglądu"
              hint="Wybierz plik PNG, JPG, WEBP lub SVG"
            />
          </div>
        </div>

        <DialogFooter>
          <button type="button" className={outlineButton} onClick={onClose} disabled={isSaving}>
            Anuluj
          </button>
          <button type="submit" disabled={isSaving} className={primaryButton}>
            {isSaving ? "Zapisywanie..." : "Zapisz zmiany"}
          </button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
