import { useState, useEffect, useCallback } from "react";
import {
  API_BASE_URL,
  apiGetMyScripts,
  apiDeleteScript,
  apiDisable2FA,
  apiChangePassword,
  apiUpdateProfile,
  apiRevokeAllSessions,
  apiDeleteAccount,
  type HubScript,
  type HubUser,
} from "@/lib/hub-api";
import { StandardsList, StatusBadge } from "@/components/hub/ModerationBits";
import { MessagesModal } from "@/components/hub/MessagesModal";
import { Modal } from "@/components/ui/modal";
import { DialogError, DialogField, DialogFooter, DialogNote } from "@/components/ui/dialog-parts";
import { dialogInput, fieldInput, fieldLabel, linkButton, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { ScriptEditModal } from "@/components/profile/ScriptEditModal";
import { TwoFactorSetupModal } from "@/components/profile/TwoFactorSetupModal";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Notice, Page, Section, UnderlineTabs } from "@/components/shell/Page";
import { LemonSlice, UploadIcon } from "@/components/shell/icons";

export interface UserProfileViewProps {
  currentUser: HubUser | null;
  onUserUpdated: (user: HubUser) => void;
  onLoggedOut: () => void;
  onOpenUploadModal: () => void;
}

type ProfileTab = "manifests" | "security" | "account";

export function resolveSafeAvatarUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/api/uploads/images/")) {
    return `${API_BASE_URL}${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:") {
      return parsed.toString();
    }
    const base = new URL(API_BASE_URL);
    if (parsed.origin === base.origin && parsed.pathname.startsWith("/api/uploads/images/")) {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function UserProfileView({
  currentUser,
  onUserUpdated,
  onLoggedOut,
  onOpenUploadModal,
}: UserProfileViewProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<ProfileTab>("manifests");

  const [scripts, setScripts] = useState<HubScript[]>([]);
  const [isLoadingScripts, setIsLoadingScripts] = useState(true);
  const [editingScript, setEditingScript] = useState<HubScript | null>(null);
  const [messagesScript, setMessagesScript] = useState<HubScript | null>(null);
  const [notifyEmail, setNotifyEmail] = useState(currentUser?.notify_email !== false);
  const [scriptToDelete, setScriptToDelete] = useState<HubScript | null>(null);
  const [isDeletingScript, setIsDeletingScript] = useState(false);
  const [deleteScriptError, setDeleteScriptError] = useState<string | null>(null);

  const [is2FASetupOpen, setIs2FASetupOpen] = useState(false);
  const [isDisable2FAOpen, setIsDisable2FAOpen] = useState(false);
  const [disable2FAPassword, setDisable2FAPassword] = useState("");
  const [disable2FAError, setDisable2FAError] = useState<string | null>(null);
  const [isDisabling2FA, setIsDisabling2FA] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const [editUsername, setEditUsername] = useState(currentUser?.username || "");
  const [editEmail, setEditEmail] = useState(currentUser?.email || "");
  const [editAvatar, setEditAvatar] = useState(currentUser?.avatar_url || "");
  const [profileCurrentPassword, setProfileCurrentPassword] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [isRevokingSessions, setIsRevokingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const refreshScripts = useCallback(async () => {
    if (!currentUser) return;
    try {
      setIsLoadingScripts(true);
      const list = await apiGetMyScripts();
      setScripts(list);
    } catch {
      setScripts([]);
    } finally {
      setIsLoadingScripts(false);
    }
  }, [currentUser]);

  useEffect(() => {
    refreshScripts();
  }, [refreshScripts]);

  useEffect(() => {
    if (currentUser) {
      setEditUsername(currentUser.username);
      setEditEmail(currentUser.email);
      setEditAvatar(currentUser.avatar_url || "");
      setNotifyEmail(currentUser.notify_email !== false);
      setProfileCurrentPassword("");
    }
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <LemonSlice size={96} />
        <h2 className="text-[22px] font-extrabold tracking-tight">{t("loginRequired")}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Zaloguj się do LemonAI Hub, aby zarządzać swoim profilem, opublikowanymi skryptami oraz bezpieczeństwem konta.
        </p>
      </div>
    );
  }

  const handleDeleteScript = async () => {
    if (!scriptToDelete || isDeletingScript) return;
    setDeleteScriptError(null);
    try {
      setIsDeletingScript(true);
      await apiDeleteScript(scriptToDelete.slug);
      setScriptToDelete(null);
      await refreshScripts();
    } catch (err: unknown) {
      setDeleteScriptError(err instanceof Error ? err.message : "Błąd podczas usuwania skryptu");
    } finally {
      setIsDeletingScript(false);
    }
  };

  const handleDisable2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisabling2FA) return;
    setDisable2FAError(null);
    try {
      setIsDisabling2FA(true);
      await apiDisable2FA(disable2FAPassword);
      setIsDisable2FAOpen(false);
      setDisable2FAPassword("");
      onUserUpdated({ ...currentUser, two_factor_enabled: false });
    } catch (err: unknown) {
      setDisable2FAError(err instanceof Error ? err.message : "Błędne hasło");
    } finally {
      setIsDisabling2FA(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ text: "Nowe hasła nie są identyczne.", isError: true });
      return;
    }
    if (newPassword.length < 10) {
      setPasswordMsg({ text: "Nowe hasło musi mieć co najmniej 10 znaków.", isError: true });
      return;
    }

    try {
      setIsSavingPassword(true);
      const res = await apiChangePassword({ old_password: oldPassword, new_password: newPassword });
      setPasswordMsg({ text: res.message || "Hasło zostało zmienione pomyślnie.", isError: false });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onLoggedOut();
    } catch (err: unknown) {
      setPasswordMsg({ text: err instanceof Error ? err.message : "Błąd podczas zmiany hasła", isError: true });
    } finally {
      setIsSavingPassword(false);
    }
  };

  const emailChanged = editEmail.trim() !== currentUser.email;

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingProfile) return;
    setProfileMsg(null);

    if (emailChanged && !profileCurrentPassword) {
      setProfileMsg({ text: "Podaj obecne hasło, aby zmienić adres e-mail.", isError: true });
      return;
    }

    try {
      setIsSavingProfile(true);
      const payload: {
        username?: string;
        email?: string;
        avatar_url?: string;
        current_password?: string;
      } = {
        username: editUsername.trim(),
        email: editEmail.trim(),
        avatar_url: editAvatar.trim(),
      };
      if (emailChanged) {
        payload.current_password = profileCurrentPassword;
      }
      const updated = await apiUpdateProfile(payload);
      onUserUpdated(updated);
      setProfileCurrentPassword("");
      setProfileMsg({ text: "Profil został pomyślnie zaktualizowany.", isError: false });
    } catch (err: unknown) {
      setProfileMsg({ text: err instanceof Error ? err.message : "Błąd aktualizacji profilu", isError: true });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleRevokeAll = async () => {
    if (isRevokingSessions) return;
    setSessionsError(null);
    try {
      setIsRevokingSessions(true);
      await apiRevokeAllSessions();
      setConfirmRevokeAll(false);
      onLoggedOut();
    } catch (err: unknown) {
      setSessionsError(err instanceof Error ? err.message : "Błąd podczas wylogowywania sesji");
    } finally {
      setIsRevokingSessions(false);
    }
  };

  const handleDeleteAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDeletingAccount) return;
    setDeleteAccountError(null);
    try {
      setIsDeletingAccount(true);
      await apiDeleteAccount(deletePassword);
      setIsDeleteAccountOpen(false);
      onLoggedOut();
    } catch (err: unknown) {
      setDeleteAccountError(err instanceof Error ? err.message : "Błędne hasło");
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const safeAvatarUrl = resolveSafeAvatarUrl(currentUser.avatar_url);
  const initials = currentUser.username.slice(0, 1).toUpperCase();

  const roleText = currentUser.role === "admin" ? "Administrator" : currentUser.role === "moderator" ? "Moderator" : "Twórca";
  const message = (msg: { text: string; isError: boolean } | null) =>
    msg && <Notice tone={msg.isError ? "error" : "ok"}>{msg.text}</Notice>;
  const destructiveButton =
    "h-12 cursor-pointer rounded-[14px] border-0 bg-destructive px-6 text-sm font-extrabold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Page width={1100} className="gap-6">
        <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {safeAvatarUrl ? (
            <img src={safeAvatarUrl} alt={currentUser.username} className="h-[72px] w-[72px] shrink-0 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-primary font-display text-[32px] font-extrabold text-primary-foreground"
            >
              {initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em]">Profil</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
              <span>
                {currentUser.username} · {currentUser.email}
              </span>
              <span className="rounded-md border-[1.5px] border-ink px-2 py-0.5 text-[11.5px] font-bold text-ink">{roleText}</span>
              {currentUser.two_factor_enabled && <span>2FA włączone</span>}
            </div>
          </div>
          <button type="button" onClick={onLoggedOut} className={cn(linkButton, "font-semibold text-muted-foreground hover:text-destructive")}>
            {t("logout")}
          </button>
        </header>

        <UnderlineTabs<ProfileTab>
          accent
          label="Profil"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: "manifests", label: t("myManifestsTab"), count: scripts.length },
            { id: "security", label: t("security2faTab") },
            { id: "account", label: t("accountSettingsTab") },
          ]}
        />

        {/* TAB 1: MOJE MODELE */}
        {activeTab === "manifests" && (
          <section aria-label={t("myManifestsTab")} className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3">
              <p className="m-0 text-sm text-muted-foreground">Modele, które udostępniłeś społeczności LemonAI w Hubie.</p>
              <button type="button" onClick={onOpenUploadModal} className={cn(linkButton, "inline-flex items-center gap-2")}>
                <UploadIcon size={16} />
                Opublikuj model
              </button>
            </div>

            {isLoadingScripts ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Ładowanie Twoich modeli…</p>
            ) : scripts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <LemonSlice size={88} />
                <h3 className="m-0 font-display text-[22px] font-extrabold tracking-tight">Nic jeszcze nie opublikowałeś</h3>
                <p className="m-0 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Opisz model z Hugging Face, a inni zainstalują go w LemonAI jednym kliknięciem.
                </p>
                <button type="button" onClick={onOpenUploadModal} className={cn(primaryButton, "mt-1")}>
                  Opublikuj pierwszy model
                </button>
              </div>
            ) : (
              <ul className="m-0 list-none p-0">
                {scripts.map((script) => (
                  <li
                    key={script.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 gap-y-3 border-b border-border px-1 py-[22px] max-md:grid-cols-1"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h3 className="m-0 text-lg font-bold">{script.name}</h3>
                        <StatusBadge status={script.status} />
                      </div>
                      <p className="m-0 mt-1 text-[13px] text-muted-foreground">
                        {script.installs_count ?? script.downloads_count ?? 0} pobrań · {script.min_vram_gb} GB VRAM ·{" "}
                        {script.min_ram_gb} GB RAM
                      </p>
                      <p className="m-0 mt-1.5 max-w-[640px] text-sm leading-snug text-muted-foreground line-clamp-2">
                        {script.description}
                      </p>
                      {script.status === "rejected" && (
                        <p
                          className="m-0 mt-3 max-w-[640px] rounded-xl border-l-4 border-destructive bg-card px-4 py-3 text-sm"
                          data-testid="rejection-note"
                        >
                          Odrzucony przez moderatora{script.moderation_note ? `: ${script.moderation_note}` : "."} Popraw wpis
                          (Edytuj), aby wysłać go ponownie do przeglądu.
                        </p>
                      )}
                      {script.status === "pending" && (
                        <p className="m-0 mt-3 max-w-[640px] rounded-xl border-l-4 border-warn bg-card px-4 py-3 text-sm">
                          Czeka na przegląd moderatora; do tego czasu nie jest widoczny w katalogu.
                        </p>
                      )}
                      {(script.standards ?? []).length > 0 && (
                        <div className="mt-3 max-w-[640px]">
                          <StandardsList issues={script.standards} compact />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className={cn(outlineButton, "h-11")}
                        onClick={() => setMessagesScript(script)}
                        aria-label={`Wiadomości z moderacją: ${script.name}`}
                      >
                        Wiadomości
                      </button>
                      <button type="button" className={cn(outlineButton, "h-11")} onClick={() => setEditingScript(script)}>
                        {t("editManifest")}
                      </button>
                      <button
                        type="button"
                        className={cn(linkButton, "px-2 font-bold text-destructive")}
                        onClick={() => {
                          setDeleteScriptError(null);
                          setScriptToDelete(script);
                        }}
                      >
                        {t("deleteManifest")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* TAB 2: BEZPIECZEŃSTWO */}
        {activeTab === "security" && (
          <div className="pt-4">
            <Section
              id="profile-2fa"
              title="Weryfikacja dwuetapowa (2FA / TOTP)"
              hint="Przy logowaniu, oprócz hasła, potrzebny będzie kod z aplikacji uwierzytelniającej albo kod ratunkowy."
            >
              <p className="m-0 flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn("h-2.5 w-2.5 rounded-full", currentUser.two_factor_enabled ? "bg-ok" : "bg-muted-foreground/40")}
                />
                <span className="font-bold">
                  {currentUser.two_factor_enabled ? t("twoFactorEnabled") : t("twoFactorDisabled")}
                </span>
              </p>
              {currentUser.two_factor_enabled ? (
                <button
                  type="button"
                  className={cn(outlineButton, "self-start border-destructive text-destructive hover:bg-destructive/10")}
                  onClick={() => {
                    setDisable2FAError(null);
                    setDisable2FAPassword("");
                    setIsDisable2FAOpen(true);
                  }}
                >
                  {t("disable2fa")}
                </button>
              ) : (
                <button type="button" className={cn(outlineButton, "self-start")} onClick={() => setIs2FASetupOpen(true)}>
                  {t("enable2fa")}
                </button>
              )}
            </Section>

            <Section id="profile-password" title={t("changePassword")} hint="Co najmniej 10 znaków.">
              {message(passwordMsg)}
              <form onSubmit={handlePasswordSubmit} className="flex max-w-[520px] flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabel}>Obecne hasło</span>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className={fieldInput}
                    disabled={isSavingPassword}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabel}>Nowe hasło</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 10 znaków"
                    className={fieldInput}
                    disabled={isSavingPassword}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabel}>Powtórz nowe hasło</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={fieldInput}
                    disabled={isSavingPassword}
                    required
                  />
                </label>
                <button type="submit" className={cn(primaryButton, "self-start")} disabled={isSavingPassword || !oldPassword || !newPassword}>
                  {isSavingPassword ? "Aktualizowanie…" : "Zmień hasło"}
                </button>
              </form>
            </Section>

            <Section
              id="profile-sessions"
              title="Aktywne sesje"
              hint="Zgubiłeś urządzenie albo podejrzewasz obcy dostęp? Wyloguj wszystkie sesje naraz."
            >
              {sessionsError && <Notice tone="error">{sessionsError}</Notice>}
              {confirmRevokeAll ? (
                <div className="flex max-w-[520px] flex-col gap-4 rounded-xl border-l-4 border-destructive bg-card px-4 py-4 text-sm">
                  <p className="m-0 leading-relaxed">
                    Czy na pewno chcesz wylogować wszystkie aktywne sesje ze wszystkich urządzeń?
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={cn(outlineButton, "h-11")}
                      disabled={isRevokingSessions}
                      onClick={() => {
                        setConfirmRevokeAll(false);
                        setSessionsError(null);
                      }}
                    >
                      Anuluj
                    </button>
                    <button
                      type="button"
                      className={cn(destructiveButton, "h-11")}
                      disabled={isRevokingSessions}
                      onClick={() => void handleRevokeAll()}
                    >
                      {isRevokingSessions ? "Wylogowywanie…" : "Potwierdź wylogowanie"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={cn(outlineButton, "self-start")}
                  onClick={() => {
                    setSessionsError(null);
                    setConfirmRevokeAll(true);
                  }}
                >
                  {t("revokeAllSessions")}
                </button>
              )}
            </Section>
          </div>
        )}

        {/* TAB 3: KONTO */}
        {activeTab === "account" && (
          <div className="pt-4">
            <Section id="profile-data" title="Dane profilowe" hint="Nazwa wyświetlana, adres e-mail i awatar.">
              {message(profileMsg)}
              <form onSubmit={handleProfileSubmit} className="flex max-w-[520px] flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabel}>Nazwa użytkownika</span>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className={fieldInput}
                    disabled={isSavingProfile}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabel}>Adres e-mail</span>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className={fieldInput}
                    disabled={isSavingProfile}
                    required
                  />
                </label>
                {emailChanged && (
                  <label className="flex flex-col gap-1.5">
                    <span className={fieldLabel}>Obecne hasło (wymagane do zmiany e-maila)</span>
                    <input
                      type="password"
                      value={profileCurrentPassword}
                      onChange={(e) => setProfileCurrentPassword(e.target.value)}
                      className={fieldInput}
                      disabled={isSavingProfile}
                      required
                    />
                  </label>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="flex flex-col gap-1.5">
                    <span className={fieldLabel}>Adres obrazka awatara (opcjonalnie)</span>
                    <input
                      type="url"
                      value={editAvatar}
                      onChange={(e) => setEditAvatar(e.target.value)}
                      placeholder="https://..."
                      className={fieldInput}
                      disabled={isSavingProfile}
                    />
                  </label>
                  <span className="text-[12.5px] text-muted-foreground">Tylko HTTPS albo adresy z Hubu.</span>
                </div>
                <button
                  type="submit"
                  className={cn(primaryButton, "self-start")}
                  disabled={
                    isSavingProfile ||
                    !editUsername.trim() ||
                    !editEmail.trim() ||
                    (emailChanged && !profileCurrentPassword)
                  }
                >
                  {isSavingProfile ? "Zapisywanie…" : "Zapisz dane"}
                </button>
              </form>
            </Section>

            <Section id="profile-notify" title="Powiadomienia" hint="Powiadomienia w aplikacji (dzwonek) działają zawsze.">
              <label className="flex max-w-[520px] cursor-pointer items-start justify-between gap-6">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold">Wysyłaj mi e-mail</span>
                  <span className="text-sm leading-snug text-muted-foreground">
                    Wysyłaj mi e-mail o decyzjach moderatorów, ich odpowiedziach i rozpatrzonych zgłoszeniach.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-[hsl(var(--ink))]"
                  checked={notifyEmail}
                  onChange={async (e) => {
                    const value = e.target.checked;
                    setNotifyEmail(value);
                    try {
                      onUserUpdated(await apiUpdateProfile({ notify_email: value }));
                    } catch (err: unknown) {
                      setNotifyEmail(!value);
                      setProfileMsg({ text: err instanceof Error ? err.message : String(err), isError: true });
                    }
                  }}
                />
              </label>
            </Section>

            <section
              aria-labelledby="profile-danger"
              className="mt-2 flex flex-wrap items-center gap-x-10 gap-y-4 rounded-[20px] border border-destructive p-6"
            >
              <div className="basis-56 grow max-w-72">
                <h2 id="profile-danger" className="m-0 text-[17px] font-extrabold text-destructive">
                  Strefa niebezpieczna
                </h2>
                <p className="m-0 mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Usunięcie konta jest nieodwracalne: opublikowane modele i dane zostaną trwale skasowane.
                </p>
              </div>
              <button
                type="button"
                className={cn(outlineButton, "border-destructive text-destructive hover:bg-destructive/10")}
                onClick={() => {
                  setDeleteAccountError(null);
                  setDeletePassword("");
                  setIsDeleteAccountOpen(true);
                }}
              >
                Usuń trwale konto
              </button>
            </section>
          </div>
        )}
      </Page>

      {messagesScript && (
        <MessagesModal
          script={messagesScript}
          asModerator={false}
          onClose={() => setMessagesScript(null)}
          onStatusChange={() => void refreshScripts()}
        />
      )}

      {editingScript && (
        <ScriptEditModal
          isOpen={Boolean(editingScript)}
          onClose={() => setEditingScript(null)}
          script={editingScript}
          onScriptUpdated={() => {
            setEditingScript(null);
            refreshScripts();
          }}
        />
      )}

      {/* Delete script */}
      <Modal
        isOpen={Boolean(scriptToDelete)}
        onClose={() => {
          if (isDeletingScript) return;
          setScriptToDelete(null);
          setDeleteScriptError(null);
        }}
        title="Usunąć model z Hubu?"
        size="sm"
        aria-labelledby="delete-script-title"
      >
        {scriptToDelete && (
          <div className="flex flex-col gap-4">
            <DialogNote>
              Czy na pewno chcesz trwale usunąć <strong className="text-foreground">{scriptToDelete.name}</strong> ze
              społeczności LemonAI? Wpis i jego baner znikną z Hubu, a pobrania i oceny zostaną utracone.
            </DialogNote>
            {deleteScriptError && <DialogError>{deleteScriptError}</DialogError>}
            <DialogFooter>
              <button
                type="button"
                className={outlineButton}
                disabled={isDeletingScript}
                onClick={() => {
                  setScriptToDelete(null);
                  setDeleteScriptError(null);
                }}
              >
                Anuluj
              </button>
              <button type="button" className={destructiveButton} disabled={isDeletingScript} onClick={() => void handleDeleteScript()}>
                {isDeletingScript ? "Usuwanie…" : "Usuń"}
              </button>
            </DialogFooter>
          </div>
        )}
      </Modal>

      {/* 2FA Setup Modal */}
      <TwoFactorSetupModal
        isOpen={is2FASetupOpen}
        onClose={() => setIs2FASetupOpen(false)}
        onEnabled={() => {
          onUserUpdated({ ...currentUser, two_factor_enabled: true });
        }}
      />

      {/* Disable 2FA */}
      <Modal
        isOpen={isDisable2FAOpen}
        onClose={() => !isDisabling2FA && setIsDisable2FAOpen(false)}
        title="Wyłącz 2FA"
        size="sm"
        aria-labelledby="disable-2fa-title"
      >
        <form onSubmit={handleDisable2FASubmit} className="flex flex-col gap-4">
          <DialogNote>Wprowadź swoje obecne hasło, aby potwierdzić wyłączenie weryfikacji dwuetapowej.</DialogNote>
          <DialogField label="Hasło konta">
            <input
              type="password"
              value={disable2FAPassword}
              onChange={(e) => setDisable2FAPassword(e.target.value)}
              className={dialogInput}
              disabled={isDisabling2FA}
              required
              autoFocus
            />
          </DialogField>
          {disable2FAError && <DialogError>{disable2FAError}</DialogError>}
          <DialogFooter>
            <button type="button" className={outlineButton} disabled={isDisabling2FA} onClick={() => setIsDisable2FAOpen(false)}>
              Anuluj
            </button>
            <button type="submit" className={destructiveButton} disabled={isDisabling2FA}>
              {isDisabling2FA ? "Wyłączanie…" : "Wyłącz 2FA"}
            </button>
          </DialogFooter>
        </form>
      </Modal>

      {/* Delete account */}
      <Modal
        isOpen={isDeleteAccountOpen}
        onClose={() => !isDeletingAccount && setIsDeleteAccountOpen(false)}
        title="Trwałe usunięcie konta"
        size="sm"
        aria-labelledby="delete-account-title"
      >
        <form onSubmit={handleDeleteAccountSubmit} className="flex flex-col gap-4">
          <p role="status" className="m-0 rounded-xl border-l-4 border-destructive bg-background px-4 py-3 text-sm leading-[1.55]">
            Aby potwierdzić usunięcie konta, wprowadź swoje obecne hasło. Ta operacja jest nieodwracalna!
          </p>
          <DialogField label="Hasło konta">
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className={dialogInput}
              disabled={isDeletingAccount}
              required
              autoFocus
            />
          </DialogField>
          {deleteAccountError && <DialogError>{deleteAccountError}</DialogError>}
          <DialogFooter>
            <button type="button" className={outlineButton} disabled={isDeletingAccount} onClick={() => setIsDeleteAccountOpen(false)}>
              Anuluj
            </button>
            <button type="submit" className={destructiveButton} disabled={isDeletingAccount}>
              {isDeletingAccount ? "Usuwanie…" : "Usuń trwale konto"}
            </button>
          </DialogFooter>
        </form>
      </Modal>
    </div>
  );
}
