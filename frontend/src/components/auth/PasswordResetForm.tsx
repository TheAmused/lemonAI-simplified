import { useState } from "react";
import { DialogError, DialogField, DialogNote } from "@/components/ui/dialog-parts";
import { cn } from "@/lib/utils";
import { dialogInput as fieldInput, linkButton, primaryButton } from "@/components/ui/form-styles";
import { HubApiError, apiConfirmPasswordReset, apiRequestPasswordReset } from "@/lib/hub-api";

const inputClass = fieldInput;

export function PasswordResetForm({
  initialLogin,
  onDone,
  onBack,
}: {
  initialLogin: string;
  onDone: (login: string) => void;
  onBack: () => void;
}) {
  const [login, setLogin] = useState(initialLogin);
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiRequestPasswordReset(login.trim());
      setInfo("Jeśli takie konto istnieje, wysłaliśmy kod na jego adres e-mail. Sprawdź też folder spam.");
      setStep("confirm");
    } catch (err: unknown) {
      if (err instanceof HubApiError && err.code === "mail_not_configured") {
        setInfo("Ten Hub nie wysyła e-maili. Poproś administratora o kod resetu i wpisz go poniżej.");
        setStep("confirm");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError("Hasła się różnią.");
      return;
    }
    setBusy(true);
    try {
      await apiConfirmPasswordReset(login.trim(), code.trim(), password);
      onDone(login.trim());
    } catch (err: unknown) {
      setError(
        err instanceof HubApiError && err.code === "invalid_reset_code"
          ? "Kod jest błędny albo wygasł. Poproś o nowy."
          : err instanceof Error
            ? err.message
            : String(err)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {step === "request" ? (
        <form onSubmit={requestCode} className="flex flex-col gap-4">
          <DialogNote>Podaj nazwę użytkownika lub e-mail konta. Wyślemy kod do ustawienia nowego hasła.</DialogNote>
          <DialogField label="Nazwa użytkownika lub e-mail">
            <input className={inputClass} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
          </DialogField>
          <button type="submit" className={cn(primaryButton, "w-full")} disabled={busy || !login.trim()}>
            {busy ? "Wysyłanie…" : "Wyślij kod"}
          </button>
          <button type="button" className={cn(linkButton, "self-start font-semibold")} onClick={() => setStep("confirm")}>
            Mam już kod
          </button>
        </form>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          {info && <DialogNote>{info}</DialogNote>}
          <DialogField label="Nazwa użytkownika lub e-mail">
            <input className={inputClass} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
          </DialogField>
          <DialogField label="Kod">
            <input
              className={cn(inputClass, "font-mono uppercase tracking-[.14em]")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCD-2345"
              autoComplete="one-time-code"
            />
          </DialogField>
          <DialogField label="Nowe hasło (co najmniej 10 znaków)">
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </DialogField>
          <DialogField label="Powtórz nowe hasło">
            <input className={inputClass} type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </DialogField>
          <button
            type="submit"
            className={cn(primaryButton, "w-full")}
            disabled={busy || !login.trim() || !code.trim() || password.length < 10}
          >
            {busy ? "Zapisywanie…" : "Ustaw nowe hasło"}
          </button>
          <button type="button" className={cn(linkButton, "self-start font-semibold")} onClick={() => setStep("request")}>
            Wyślij nowy kod
          </button>
        </form>
      )}
      {error && <DialogError>{error}</DialogError>}
      <button type="button" className={cn(linkButton, "self-start font-semibold no-underline text-muted-foreground")} onClick={onBack}>
        ← Wróć do logowania
      </button>
    </div>
  );
}
