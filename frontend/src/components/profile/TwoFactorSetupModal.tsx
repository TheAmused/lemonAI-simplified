import { useState, useEffect } from "react";
import { apiSetup2FA, apiEnable2FA, type TwoFactorSetupResponse } from "@/lib/hub-api";
import { DialogError, DialogField, DialogFooter, DialogNote } from "@/components/ui/dialog-parts";
import { dialogInput, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { saveTextFile } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";

export interface TwoFactorSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnabled: () => void;
}

export function TwoFactorSetupModal({
  isOpen,
  onClose,
  onEnabled,
}: TwoFactorSetupModalProps) {
  const [step, setStep] = useState<"qr" | "codes">("qr");
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [savedCodes, setSavedCodes] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSetupData(null);
      setPassword("");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setStep("qr");
    setSetupData(null);
    setVerifyCode("");
    setPassword("");
    setBackupCodes([]);
    setCopied(false);
    setSavedCodes(false);
    setErrorMsg(null);
    setIsLoading(true);

    apiSetup2FA()
      .then((res) => {
        if (!cancelled) {
          setSetupData(res);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Nie udało się rozpocząć konfiguracji 2FA");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleEnableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupData || !verifyCode.trim() || !password) return;

    setErrorMsg(null);
    try {
      setIsLoading(true);
      const res = await apiEnable2FA(verifyCode.trim(), password);
      setBackupCodes(res.backup_codes);
      setPassword("");
      setStep("codes");
      onEnabled();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Nieprawidłowy kod weryfikacyjny");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleDownloadBackupCodes = async () => {
    try {
      await saveTextFile("lemonai-kody-zapasowe", backupCodes.join("\n") + "\n", "txt");
    } catch {
      // ignore: the codes stay on screen
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={step === "qr" ? "Konfiguracja weryfikacji dwuetapowej (2FA)" : "Kody zapasowe (Recovery Codes)"}
      size="lg"
      aria-labelledby="two-factor-setup-modal-title"
    >
      {errorMsg && (
        <div className="mb-4">
          <DialogError>{errorMsg}</DialogError>
        </div>
      )}

      {step === "qr" ? (
        <form onSubmit={handleEnableSubmit}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-7">
              <div className="shrink-0 rounded-xl bg-white p-2">
                {setupData?.qr_code_svg ? (
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(setupData.qr_code_svg)}`}
                    alt="2FA QR Code"
                    className="h-44 w-44 object-contain"
                  />
                ) : (
                  <div className="flex h-44 w-44 items-center justify-center font-mono text-xs text-muted-foreground">
                    {isLoading ? "Generowanie kodu QR..." : "Brak danych QR"}
                  </div>
                )}
              </div>
              <div className="min-w-[220px] flex-1 space-y-3">
                <DialogNote className="text-sm text-foreground">
                  Zeskanuj kod QR w swojej aplikacji uwierzytelniającej (np. Google Authenticator, Authy, 1Password)
                  lub wprowadź klucz ręcznie.
                </DialogNote>
                {setupData?.secret && (
                  <div>
                    <div className="mb-1.5 text-xs text-muted-foreground">Tajny klucz tekstowy:</div>
                    <div className="flex items-center gap-2.5">
                      <code className="flex-1 select-all rounded-xl bg-secondary px-3.5 py-2.5 font-mono text-[13px] tracking-wider">
                        {setupData.secret}
                      </code>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(setupData.secret)}
                        className={cn(outlineButton, "h-10 px-4 text-[13px]")}
                      >
                        Kopiuj
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogField label="Aktualne hasło">
              <input
                id="verify-2fa-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={dialogInput}
                disabled={isLoading}
                required
              />
            </DialogField>
            <DialogField label="6-cyfrowy kod z aplikacji">
              <input
                id="verify-2fa-input"
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="123456"
                className={cn(dialogInput, "font-mono")}
                disabled={isLoading}
                required
              />
            </DialogField>
          </div>
          <DialogFooter>
            <button type="button" className={outlineButton} onClick={onClose} disabled={isLoading}>
              Anuluj
            </button>
            <button
              type="submit"
              className={primaryButton}
              disabled={isLoading || !verifyCode.trim() || !password}
            >
              {isLoading ? "Weryfikacja..." : "Weryfikuj i włącz 2FA"}
            </button>
          </DialogFooter>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div role="status" className="rounded-xl border-l-4 border-warn bg-background px-4 py-3 text-sm leading-normal">
            <strong>Zapisz te kody w bezpiecznym miejscu!</strong> Każdy kod może być użyty dokładnie raz, jeśli
            utracisz dostęp do aplikacji uwierzytelniającej.
          </div>

          <ul aria-label="Kody zapasowe" className="m-0 grid list-none grid-cols-2 gap-2.5 p-0">
            {backupCodes.map((code, idx) => (
              <li
                key={idx}
                className="select-all rounded-xl bg-secondary px-4 py-3 text-center font-mono text-sm font-semibold"
              >
                {code}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={handleCopyBackupCodes} className={cn(outlineButton, "h-11 px-4 text-[13px]")}>
              {copied ? "✓ Skopiowano kody" : "Kopiuj wszystkie"}
            </button>
            <button type="button" onClick={() => void handleDownloadBackupCodes()} className={cn(outlineButton, "h-11 px-4 text-[13px]")}>
              Pobierz .txt
            </button>
          </div>

          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={savedCodes}
              onChange={(e) => setSavedCodes(e.target.checked)}
              className="h-[18px] w-[18px] accent-[hsl(var(--line))]"
            />
            <span>Zapisałem kody w bezpiecznym miejscu</span>
          </label>

          <DialogFooter>
            <button type="button" onClick={onClose} disabled={!savedCodes} className={primaryButton}>
              Zakończ
            </button>
          </DialogFooter>
        </div>
      )}
    </Modal>
  );
}
