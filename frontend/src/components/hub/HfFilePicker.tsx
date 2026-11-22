import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { DialogFooter } from "@/components/ui/dialog-parts";
import { outlineButton, primaryButton } from "@/components/ui/form-styles";
import { apiHfRepoFiles, type HfRepoFile, type HfRepoInfo } from "@/lib/ipc";
import { assessRepo, type RepoAssessment, type RunnerKind } from "@/lib/manifest-builder";
import { cn } from "@/lib/utils";

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 1 : 2)} GB`;
}

export interface PickedFiles {

  file?: HfRepoFile;
  assessment: RepoAssessment;
}

export function HfFilePicker({
  repoId,
  runner,
  onPick,
  onClose,
}: {
  repoId: string;
  runner: RunnerKind;
  onPick: (picked: PickedFiles) => void;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<HfRepoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiHfRepoFiles(repoId)
      .then((data) => active && setInfo(data))
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      active = false;
    };
  }, [repoId]);

  const ggufs = info?.files.filter((f) => f.path.toLowerCase().endsWith(".gguf")) ?? [];
  const overview = info && runner !== "gguf" ? assessRepo(runner, info.files) : null;

  const issue = (level: "Uwaga" | "Błąd", text: string) => (
    <div key={text} className="flex gap-2.5 text-[13.5px] leading-normal">
      <span className={cn("shrink-0 font-extrabold", level === "Błąd" ? "text-destructive" : "text-warn")}>{level}</span>
      <span>{text}</span>
    </div>
  );
  const problems = overview?.problems ?? [];
  const showProblems = Boolean(info?.gated) || problems.length > 0;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Pliki w ${repoId}`} size="lg" aria-labelledby="hf-picker-title">
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="m-0 rounded-xl border-l-4 border-destructive bg-background px-4 py-3 text-sm">
            {error}
          </p>
        ) : !info ? (
          <p className="m-0 text-sm text-muted-foreground">Wczytywanie listy plików z Hugging Face…</p>
        ) : (
          <>
            {runner === "gguf" ? (
              ggufs.length === 0 ? (
                <p className="m-0 text-sm text-destructive">W tym repozytorium nie ma plików .gguf.</p>
              ) : (
                <>
                  <h2 className="m-0 text-[13px] font-bold tracking-[0.05em] text-muted-foreground">PLIKI GGUF</h2>
                  <ul className="m-0 max-h-80 list-none overflow-y-auto border-t border-border p-0" aria-label="Pliki GGUF">
                    {ggufs.map((file) => {
                      const nested = file.path.includes("/");
                      return (
                        <li key={file.path}>
                          <button
                            type="button"
                            disabled={nested}
                            onClick={() => onPick({ file, assessment: assessRepo("gguf", info.files, file.path) })}
                            className={cn(
                              "flex w-full items-center gap-3.5 border-0 border-b border-l-4 border-b-border border-l-transparent bg-transparent px-4 py-3.5 text-left text-foreground",
                              nested ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-l-primary hover:bg-background"
                            )}
                            aria-label={`Wybierz ${file.path}`}
                          >
                            <span className="min-w-0 flex-1 break-all font-mono text-[13px]">{file.path}</span>
                            <span className="shrink-0 text-[13px] text-muted-foreground">
                              {gb(file.size)}
                              {nested ? " · w podfolderze (nieobsługiwane)" : file.sha256 ? " · SHA-256 ✓" : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )
            ) : (
              overview && (
                <p className="m-0 text-sm leading-[1.55]">
                  Runner pobierze pliki .safetensors: <strong>{gb(overview.downloadBytes)}</strong> (plus konfigurację). Sugerowane
                  wymagania: VRAM {overview.suggestedVramGb} GB, RAM {overview.suggestedRamGb} GB.
                </p>
              )
            )}
            {showProblems && (
              <div className="flex flex-col gap-2" aria-label="Problemy z repozytorium">
                <h2 className="m-0 text-[13px] font-bold tracking-[0.05em] text-muted-foreground">PROBLEMY Z REPOZYTORIUM</h2>
                {info.gated &&
                  issue(
                    "Uwaga",
                    "To repozytorium ma ograniczony dostęp: użytkownicy muszą zaakceptować licencję na huggingface.co i dodać token HF."
                  )}
                {problems.map((p) => issue("Błąd", p))}
              </div>
            )}
          </>
        )}
        <DialogFooter>
          <button type="button" className={outlineButton} onClick={onClose}>
            Zamknij
          </button>
          {overview && (
            <button
              type="button"
              className={primaryButton}
              onClick={() => onPick({ assessment: overview })}
              disabled={overview.problems.length > 0}
            >
              Użyj sugerowanych wymagań
            </button>
          )}
        </DialogFooter>
      </div>
    </Modal>
  );
}
