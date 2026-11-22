import { useState, useCallback, useEffect } from "react";
import { PasswordResetForm } from "@/components/auth/PasswordResetForm";
import { apiLogin, apiRegister, apiVerify2FA, apiGetDemoAccounts, type HubUser, type DemoAccount } from "@/lib/hub-api";
import { DialogActions, DialogError, DialogField, DialogNote, DialogStatus } from "@/components/ui/dialog-parts";
import { dialogInput as fieldInput, linkButton, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: HubUser) => void;

  initialTab?: TabType;
}

type TabType = "login" | "register";

export function AuthModal({ isOpen, onClose, onAuthSuccess, initialTab = "login" }: AuthModalProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabType>(initialTab);
  useEffect(() => {
    if (isOpen) setTab(initialTab);
  }, [isOpen, initialTab]);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");

  const [twoFactorTicket, setTwoFactorTicket] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDev = Boolean(import.meta.env?.DEV || import.meta.env?.VITE_DEMO_ACCOUNTS === "true");
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  useEffect(() => {
    if (!isDev || !isOpen) return;

    let cancelled = false;
    apiGetDemoAccounts()
      .then((accs) => {
        if (!cancelled) {
          setDemoAccounts(accs ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDemoAccounts([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isDev, isOpen]);

  const resetForm = useCallback(() => {
    setResetMode(false);
    setResetDone(false);
    setErrorMsg(null);
    setLoginIdentifier("");
    setLoginPassword("");
    setRegisterUsername("");
    setRegisterEmail("");
    setRegisterPassword("");
    setTwoFactorTicket(null);
    setTwoFactorCode("");
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);

    if (!loginIdentifier.trim() || !loginPassword.trim()) {
      setErrorMsg("Podaj login/e-mail oraz hasło.");
      return;
    }

    try {
      setIsLoading(true);
      const res = await apiLogin(loginIdentifier.trim(), loginPassword);
      if ("two_factor_required" in res && res.two_factor_required && res.ticket) {
        setTwoFactorTicket(res.ticket);
      } else if ("user" in res && res.user) {
        resetForm();
        onAuthSuccess(res.user);
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Nieprawidłowy login lub hasło"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorTicket || !twoFactorCode.trim()) {
      setErrorMsg("Wprowadź kod uwierzytelniający lub kod ratunkowy.");
      return;
    }
    setErrorMsg(null);
    try {
      setIsLoading(true);
      const auth = await apiVerify2FA(twoFactorTicket, twoFactorCode.trim());
      resetForm();
      onAuthSuccess(auth.user);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Nieprawidłowy kod 2FA");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFillDemo = (login: string, pass: string) => {
    setErrorMsg(null);
    setLoginIdentifier(login);
    setLoginPassword(pass);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (
      !registerUsername.trim() ||
      !registerEmail.trim() ||
      !registerPassword.trim()
    ) {
      setErrorMsg("Wypełnij wszystkie pola formularza.");
      return;
    }

    if (registerPassword.length < 10) {
      setErrorMsg("Hasło musi mieć co najmniej 10 znaków.");
      return;
    }

    try {
      setIsLoading(true);
      const res = await apiRegister(
        registerUsername.trim(),
        registerEmail.trim(),
        registerPassword
      );
      resetForm();
      onAuthSuccess(res.user);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Błąd podczas rejestracji"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const pwdHint = "Co najmniej 10 znaków.";
  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={twoFactorTicket ? "Weryfikacja dwuetapowa (2FA)" : resetMode ? "Nie pamiętasz hasła?" : t("authModalTitle")}
      size="md"
      aria-labelledby="auth-modal-title"
    >
      <div className="flex flex-col gap-5">
        {resetMode && (
          <PasswordResetForm
            initialLogin={loginIdentifier}
            onBack={() => setResetMode(false)}
            onDone={(login) => {
              setResetMode(false);
              setResetDone(true);
              setTab("login");
              setLoginIdentifier(login);
              setLoginPassword("");
            }}
          />
        )}
        {!resetMode && !twoFactorTicket && (
          <div role="tablist" aria-label="Konto" className="flex gap-7 border-b border-border">
            {(["login", "register"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                  setErrorMsg(null);
                }}
                className={cn(
                  "h-11 -mb-px border-b-[3px] text-[15px] cursor-pointer",
                  tab === id
                    ? "border-primary text-foreground font-extrabold"
                    : "border-transparent text-muted-foreground font-semibold hover:text-foreground"
                )}
              >
                {id === "login" ? t("loginTab") : t("registerTab")}
              </button>
            ))}
          </div>
        )}

        {errorMsg && <DialogError>{errorMsg}</DialogError>}

        {resetMode ? null : twoFactorTicket ? (
          <form onSubmit={handleVerify2FASubmit} className="flex flex-col gap-4">
            <DialogNote>
              Wpisz 6-cyfrowy kod z aplikacji Google Authenticator / Authy lub jednorazowy kod zapasowy.
            </DialogNote>
            <DialogField label="Kod weryfikacyjny 2FA">
              <input
                id="two-factor-code"
                type="text"
                autoFocus
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                placeholder="np. 123456 lub ABCD-EFGH"
                className={cn(fieldInput, "font-mono")}
                disabled={isLoading}
              />
            </DialogField>
            <DialogActions>
              <button
                type="button"
                className={outlineButton}
                disabled={isLoading}
                onClick={() => {
                  setTwoFactorTicket(null);
                  setTwoFactorCode("");
                  setErrorMsg(null);
                }}
              >
                Wstecz
              </button>
              <button
                type="submit"
                className={primaryButton}
                disabled={isLoading || !twoFactorCode.trim()}
              >
                {isLoading ? t("processing") : "Potwierdź"}
              </button>
            </DialogActions>
          </form>
        ) : tab === "login" ? (
          <>
            <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
              <DialogField label={t("identifierLabel")}>
                <input
                  id="login-identifier"
                  type="text"
                  autoComplete="username"
                  value={loginIdentifier ?? ""}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="np. jan_kowalski lub jan@example.com"
                  className={fieldInput}
                  disabled={isLoading}
                />
              </DialogField>
              <DialogField label={t("passwordLabel")}>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword ?? ""}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className={fieldInput}
                  disabled={isLoading}
                />
              </DialogField>
              {resetDone && <DialogStatus>Hasło zostało zmienione. Zaloguj się nowym hasłem.</DialogStatus>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={cn(linkButton, "font-semibold")}
                  onClick={() => {
                    setErrorMsg(null);
                    setResetMode(true);
                  }}
                >
                  Nie pamiętasz hasła?
                </button>
              </div>
              <button type="submit" disabled={isLoading} className={cn(primaryButton, "w-full")}>
                {isLoading ? t("processing") : t("loginSubmit")}
              </button>
            </form>

            {isDev && demoAccounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-[1.5px] border-dashed border-border px-3.5 py-3">
                <span className="text-xs font-bold uppercase text-muted-foreground">Konta demo (autouzupełnianie)</span>
                {demoAccounts.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    title={`${acc.username} (${acc.role})`}
                    onClick={() => handleFillDemo(acc.username, acc.password)}
                    className={cn(linkButton, "text-[13px] font-semibold")}
                  >
                    {`Uzupełnij: ${acc.label || acc.username}`}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleRegisterSubmit} className="flex flex-col gap-4">
            <DialogField label={t("usernameLabel")}>
              <input
                id="reg-username"
                type="text"
                autoComplete="username"
                value={registerUsername ?? ""}
                onChange={(e) => setRegisterUsername(e.target.value)}
                placeholder="np. dev_adam"
                className={fieldInput}
                disabled={isLoading}
              />
            </DialogField>
            <DialogField label={t("emailLabel")}>
              <input
                id="reg-email"
                type="email"
                autoComplete="email"
                value={registerEmail ?? ""}
                onChange={(e) => setRegisterEmail(e.target.value)}
                placeholder="adam@example.com"
                className={fieldInput}
                disabled={isLoading}
              />
            </DialogField>
            <DialogField label={t("passwordLabel")} hint={pwdHint}>
              <input
                id="reg-password"
                type="password"
                autoComplete="new-password"
                value={registerPassword ?? ""}
                onChange={(e) => setRegisterPassword(e.target.value)}
                placeholder="Minimum 10 znaków"
                className={fieldInput}
                disabled={isLoading}
              />
            </DialogField>
            <button type="submit" disabled={isLoading} className={cn(primaryButton, "w-full")}>
              {isLoading ? t("processing") : t("registerSubmit")}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
