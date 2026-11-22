import { useEffect, useState } from "react";
import { DialogError, DialogField, DialogFooter, DialogNote } from "@/components/ui/dialog-parts";
import { dialogInput, linkButton, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { apiHfTokenStatus, apiSetHfToken, type HfTokenStatus } from "@/lib/ipc";

export interface HfTokenModalProps {
  isOpen: boolean;
  onClose: () => void;

  onSaved?: (status: HfTokenStatus) => void;
}

export function HfTokenModal({ isOpen, onClose, onSaved }: HfTokenModalProps) {
  const [status, setStatus] = useState<HfTokenStatus | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setToken("");
    setError(null);
    apiHfTokenStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [isOpen]);

  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const next = await apiSetHfToken(value);
      setStatus(next);
      setToken("");
      onSaved?.(next);
      if (value) onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Token Hugging Face" size="md" aria-labelledby="hf-token-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) void save(token);
        }}
      >
        <div className="flex flex-col gap-[18px]">
          <DialogNote className="leading-[1.6]">
            Niektóre modele (np. FLUX.1 [schnell]) są na Hugging Face udostępniane dopiero po zaakceptowaniu
            licencji. Zaakceptuj ją na stronie modelu, a tutaj wklej swój token (uprawnienie „Read”).
          </DialogNote>
          <div className="flex items-center gap-3 rounded-xl bg-background px-4 py-3 text-sm">
            <span
              aria-hidden="true"
              className={cn("h-[9px] w-[9px] rounded-full", status?.set ? "bg-ok" : "bg-muted-foreground/50")}
            />
            {status?.set ? (
              <span>
                Zapisany token: <span className="font-mono">{status.hint}</span>
              </span>
            ) : (
              "Brak zapisanego tokenu."
            )}
          </div>
          <DialogField label="Nowy token" hint="Szyfrowany lokalnie tylko na tym komputerze.">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="hf_…"
              className={cn(dialogInput, "font-mono")}
            />
          </DialogField>
          {error && <DialogError>{error}</DialogError>}
        </div>
        <DialogFooter
          left={
            <button
              type="button"
              disabled={busy || !status?.set}
              onClick={() => void save(null)}
              className={cn(linkButton, "font-semibold text-destructive disabled:no-underline disabled:opacity-40")}
            >
              Usuń token
            </button>
          }
        >
          <button type="button" className={outlineButton} onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !token.trim()}>
            Zapisz
          </button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
