import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { DialogError, DialogFooter } from "@/components/ui/dialog-parts";
import { linkButton, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { cn } from "@/lib/utils";
import { formatGb } from "@/components/comfyui/ComfyUIView";
import {
  apiAppRestart,
  apiModelsLocation,
  apiModelsSetLocation,
  pickFolder,
  type ModelsLocationInfo,
  type MoveProgress,
} from "@/lib/ipc";

function percent(p: MoveProgress | null): number | null {
  if (!p || typeof p.bytes_done !== "number" || typeof p.bytes_total !== "number" || p.bytes_total <= 0) return null;
  return Math.min(100, Math.floor((p.bytes_done * 100) / p.bytes_total));
}

export function ModelsFolderModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState<ModelsLocationInfo | null>(null);
  const [target, setTarget] = useState<{ picked: string | null; info: ModelsLocationInfo } | null>(null);
  const [moveExisting, setMoveExisting] = useState(true);
  const [moving, setMoving] = useState<MoveProgress | null>(null);
  const [done, setDone] = useState<ModelsLocationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCurrent(await apiModelsLocation(null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTarget(null);
    setDone(null);
    setError(null);
    void refresh();
  }, [isOpen, refresh]);

  const choose = async () => {
    setError(null);
    try {
      const picked = await pickFolder("Gdzie trzymać modele?");
      if (!picked) return;
      const info = await apiModelsLocation(picked);
      if (!info.writable) {
        setError(`LemonAI nie może zapisywać w folderze ${info.dir}.`);
        return;
      }
      setMoveExisting(true);
      setTarget({ picked, info });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const backToDefault = () => {
    if (!current) return;
    setMoveExisting(true);
    setTarget({
      picked: null,
      info: { ...current, dir: current.default_dir, is_default: true, models: 0, size_bytes: null, restart_required: false },
    });
  };

  const apply = async () => {
    if (!target) return;
    setError(null);
    setMoving({ message: "Przygotowywanie…" });
    try {
      const result = await apiModelsSetLocation(target.picked, moveExisting, setMoving);
      setDone(result);
      setTarget(null);
    } catch (err: unknown) {
      setError(`Nie udało się zmienić folderu: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMoving(null);
    }
  };

  const restart = async () => {
    try {
      await apiAppRestart();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pct = percent(moving);
  const willMove = moveExisting && target !== null && target.info.models === 0 && (current?.models ?? 0) > 0;
  const folderBox = "rounded-xl bg-secondary px-4 py-3 font-mono text-[13px] break-all";
  const caption = "mb-1.5 text-[13px] text-muted-foreground";

  return (
    <Modal isOpen={isOpen} onClose={moving ? () => {} : onClose} title="Folder modeli" size="md" aria-labelledby="models-folder-title">
      <div className="flex flex-col gap-4">
        {current && (
          <section aria-label="Obecny folder modeli">
            <div className={caption}>Obecny folder modeli</div>
            <p className={`m-0 ${folderBox}`} data-testid="models-dir">
              {current.dir}
            </p>
            <p className="m-0 mt-2 text-[13px] text-muted-foreground">
              Zainstalowane modele: {current.models} · zajmują {formatGb(current.size_bytes)} · wolne miejsce: {formatGb(current.free_bytes)}
            </p>
          </section>
        )}
        {current?.restart_required && !done && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-l-4 border-warn bg-background px-4 py-3 text-sm">
            <span>Nowy folder jest zapisany; LemonAI użyje go po ponownym uruchomieniu.</span>
            <button type="button" className={cn(outlineButton, "h-10 px-4 text-[13px]")} onClick={() => void restart()}>
              Uruchom ponownie
            </button>
          </div>
        )}

        {moving ? (
          <div
            className="relative flex h-10 items-center overflow-hidden rounded-xl bg-secondary px-4 text-sm"
            {...(pct !== null ? { role: "progressbar", "aria-label": "Przenoszenie modeli", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct } : {})}
          >
            {pct !== null && <div aria-hidden="true" className="absolute inset-y-0 left-0 bg-primary/40" style={{ width: `${pct}%` }} />}
            <span className="relative truncate">{moving.message}</span>
          </div>
        ) : done ? (
          <div role="status" className="rounded-xl border-l-4 border-ok bg-background px-4 py-3 text-sm leading-normal">
            Modele będą w folderze <span className="break-all font-mono">{done.dir}</span> ({done.models}). Uruchom LemonAI
            ponownie, aby z niego korzystać.
          </div>
        ) : target ? (
          <section aria-label="Nowy folder" className="flex flex-col gap-4">
            <div>
              <div className={caption}>Nowy folder</div>
              <p className={`m-0 ${folderBox}`}>{target.info.dir}</p>
              {target.info.free_bytes !== null && (
                <p className="m-0 mt-2 text-[13px] text-muted-foreground">Wolne: {formatGb(target.info.free_bytes)}</p>
              )}
            </div>
            {target.info.models > 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                W tym folderze są już modele zainstalowane przez LemonAI ({target.info.models}); zostaną użyte bez kopiowania.
              </p>
            ) : (current?.models ?? 0) > 0 ? (
              <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={moveExisting}
                  onChange={(e) => setMoveExisting(e.target.checked)}
                  className="h-[18px] w-[18px] accent-[hsl(var(--line))]"
                />
                <span>
                  Przenieś obecne modele ({formatGb(current?.size_bytes ?? null)}). Bez tego trzeba je zainstalować
                  ponownie.
                </span>
              </label>
            ) : null}
            <div role="status" className="rounded-xl border-l-4 border-warn bg-background px-4 py-3 text-sm leading-normal">
              Uruchomione modele zostaną zatrzymane. Po zmianie LemonAI uruchomi się ponownie.
            </div>
          </section>
        ) : null}

        {error && <DialogError>{error}</DialogError>}
      </div>

      {!moving && (
        <DialogFooter
          left={
            !done && current && !current.is_default && !(target && target.info.is_default) ? (
              <button type="button" className={cn(linkButton, "font-semibold")} onClick={backToDefault}>
                Wróć do folderu domyślnego
              </button>
            ) : undefined
          }
        >
          {done ? (
            <>
              <button type="button" className={outlineButton} onClick={onClose}>
                Zamknij
              </button>
              <button type="button" className={primaryButton} onClick={() => void restart()}>
                Uruchom ponownie teraz
              </button>
            </>
          ) : target ? (
            <>
              <button type="button" className={outlineButton} onClick={() => setTarget(null)}>
                Anuluj
              </button>
              <button type="button" className={primaryButton} onClick={() => void apply()}>
                {target.info.models > 0 ? "Użyj tego folderu" : willMove ? "Przenieś" : "Ustaw folder"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={outlineButton} onClick={onClose}>
                Zamknij
              </button>
              <button type="button" className={primaryButton} onClick={() => void choose()}>
                Zmień folder…
              </button>
            </>
          )}
        </DialogFooter>
      )}
    </Modal>
  );
}
