import { useEffect, useRef, useState } from "react";
import { useTheme, type Theme } from "@/lib/theme";
import { useI18n, type Language } from "@/lib/i18n";
import { useAdultContent } from "@/lib/settings";
import {
  apiClearCivitaiToken,
  apiCivitaiTokenStatus,
  apiGetLogsFolder,
  apiGetMemoryMode,
  apiHfTokenStatus,
  apiModelsLocation,
  apiOpenLogsFolder,
  apiSetCivitaiToken,
  apiSetHfToken,
  apiSetMemoryMode,
  type HfTokenStatus,
  type MemoryMode,
} from "@/lib/ipc";
import type { HubUser } from "@/lib/hub-api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ModelsFolderModal } from "@/components/hub/ModelsFolderModal";
import { AiProvidersSection } from "@/components/settings/AiProvidersSection";
import { WebSearchSection } from "@/components/settings/WebSearchSection";
import {
  Field,
  SettingsSection,
  SwitchRow,
  fieldInput,
  linkButton,
  outlineButton,
} from "@/components/settings/parts";
import { cn } from "@/lib/utils";

export interface SettingsViewProps {
  currentUser: HubUser | null;
  onSignIn: () => void;
  onCreateAccount: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}

const TILES: Record<Theme, { bg: string; rail: string; bar: string }> = {
  lemon: { bg: "#F7F6EE", rail: "#16180B", bar: "#16180B" },
  dark: { bg: "#0F1108", rail: "#0A0B05", bar: "#F1F2E4" },
  light: { bg: "#FCFCF3", rail: "#FAFBE6", bar: "#1A1C0E" },
  system: { bg: "#CFCFC0", rail: "#16180B", bar: "#16180B" },
};

function ThemeTile({ theme }: { theme: Theme }) {
  const c = TILES[theme];
  return (
    <span className="box-border flex h-[88px] overflow-hidden rounded-[14px] border border-border" style={{ background: c.bg }}>
      <span className="w-[22%] shrink-0" style={{ background: c.rail }} />
      <span className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="h-[7px] w-[70%] rounded" style={{ background: c.bar }} />
        <span className="h-[7px] w-[45%] rounded opacity-50" style={{ background: c.bar }} />
        <span className="mt-auto h-3.5 w-1/2 rounded-[5px]" style={{ background: "#E8F53C" }} />
      </span>
    </span>
  );
}

function TokenField({
  id,
  label,
  tip,
  help,
  placeholder,
  status,
  onSave,
}: {
  id: string;
  label: string;
  tip?: string;
  help: string;
  placeholder: string;
  status: HfTokenStatus | null;
  onSave: (value: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      setValue("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={label} htmlFor={id} tip={tip} help={help}>
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) void run(value.trim());
        }}
      >
        <input
          id={id}
          aria-label={label}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={status?.set ? `••••${status.hint ? ` ${status.hint}` : ""}` : placeholder}
          className={cn(fieldInput, "font-mono")}
        />
        <button type="submit" disabled={busy || !value.trim()} className={outlineButton}>
          {t("save")}
        </button>
      </form>
      {status?.set && (
        <div className="flex items-center gap-3 text-[13px]">
          <span className="font-semibold text-ok">
            {t("settingsTokenSaved")} {status.hint ? `(${status.hint})` : ""}
          </span>
          <button type="button" disabled={busy} onClick={() => void run(null)} className={cn(linkButton, "text-[13px]")}>
            {t("settingsTokenRemove")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </Field>
  );
}

function formatFree(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined) return null;
  return `${Math.round(bytes / 1024 ** 3)} GB`;
}

export function SettingsView({ currentUser, onSignIn, onCreateAccount, onOpenProfile, onLogout }: SettingsViewProps) {
  const { t, lang, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const [adult, setAdult] = useAdultContent();
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [memoryMode, setMemoryMode] = useState<MemoryMode | null>(null);
  const [memorySaved, setMemorySaved] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [folder, setFolder] = useState<{ dir: string; free: string | null } | null>(null);
  const [logsDir, setLogsDir] = useState<string | null>(null);
  const [hf, setHf] = useState<HfTokenStatus | null>(null);
  const [civitai, setCivitai] = useState<HfTokenStatus | null>(null);
  const [showFolder, setShowFolder] = useState(false);
  const [active, setActive] = useState("wyglad");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void apiGetMemoryMode()
      .then((m) => alive && setMemoryMode(m))
      .catch(() => alive && setMemoryMode("auto"));
    void apiModelsLocation()
      .then((info) => alive && setFolder({ dir: info.dir, free: formatFree(info.free_bytes) }))
      .catch(() => {});
    void apiGetLogsFolder()
      .then((dir) => alive && setLogsDir(dir))
      .catch(() => {});
    void apiHfTokenStatus()
      .then((st) => alive && setHf(st))
      .catch(() => {});
    void apiCivitaiTokenStatus()
      .then((st) => alive && setCivitai(st))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const nav: { id: string; label: string }[] = [
    { id: "wyglad", label: t("settingsLook") },
    { id: "jezyk", label: t("settingsLanguage") },
    { id: "pamiec", label: t("settingsMemory") },
    { id: "dorosli", label: t("settingsNavAdult") },
    { id: "pliki", label: t("settingsNavFiles") },
    { id: "ai", label: t("settingsNavAi") },
    { id: "sieci", label: t("settingsNavWeb") },
    { id: "konto", label: t("settingsNavAccount") },
  ];

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top;
      let current = nav[0].id;
      for (const n of nav) {
        const el = document.getElementById(n.id);
        if (el && el.getBoundingClientRect().top - top <= 140) current = n.id;
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4 && root.scrollTop > 0) current = nav[nav.length - 1].id;
      setActive(current);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const saveCivitaiToken = async (value: string | null) => {
    if (value === null || !value.trim()) {
      await apiClearCivitaiToken();
      setCivitai({ set: false, hint: null });
    } else {
      setCivitai(await apiSetCivitaiToken(value.trim()));
    }
  };
  const saveHfToken = async (value: string | null) => {
    setHf(await apiSetHfToken(value));
  };

  const changeMemory = async (mode: MemoryMode) => {
    setMemoryError(null);
    const previous = memoryMode;
    setMemoryMode(mode);
    try {
      await apiSetMemoryMode(mode);
      setMemorySaved(true);
    } catch (err: unknown) {
      setMemoryMode(previous);
      setMemoryError(err instanceof Error ? err.message : String(err));
    }
  };

  const themes: { id: Theme; label: string }[] = [
    { id: "lemon", label: t("themeLemon") },
    { id: "dark", label: t("themeDark") },
    { id: "light", label: t("themeLight") },
    { id: "system", label: t("themeSystem") },
  ];
  const languages: { id: Language; label: string }[] = [
    { id: "pl", label: "Polski" },
    { id: "en", label: "English" },
  ];
  const memoryOptions: { id: MemoryMode; label: string; desc: string }[] = [
    { id: "auto", label: t("memoryAuto"), desc: t("memoryAutoDesc") },
    { id: "gpu_only", label: t("memoryGpuOnly"), desc: t("memoryGpuOnlyDesc") },
  ];

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[clamp(1060px,56vw,1500px)] flex-wrap content-start gap-14 px-12 pb-12 pt-8">
        <nav aria-label={t("settingsNavLabel")} className="sticky top-8 flex shrink-0 basis-[200px] flex-col gap-0.5 self-start pt-1.5">
          <h1 className="mb-[18px] font-display text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em]">{t("settingsTitle")}</h1>
          {nav.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              aria-current={active === n.id ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                goTo(n.id);
              }}
              className={cn(
                "-ml-[15px] flex h-10 items-center border-l-[3px] pl-3 text-[15px] no-underline",
                active === n.id ? "border-ink font-extrabold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground"
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 max-w-[clamp(720px,40vw,1000px)] flex-[1_1_560px] flex-col">
          <p className="mb-5 mt-3.5 text-sm leading-[1.55] text-muted-foreground">{t("settingsSubtitle")}</p>

          <SettingsSection id="wyglad" title={t("settingsLook")} hint={t("settingsLookHint")}>
            <div role="radiogroup" aria-label={t("settingsLook")} className="grid grid-cols-4 gap-3.5">
              {themes.map((option) => {
                const on = theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTheme(option.id)}
                    className="flex cursor-pointer flex-col gap-2.5 border-0 bg-transparent p-0 text-left"
                  >
                    <span className={cn("block rounded-[14px] outline outline-[3px] outline-offset-2", on ? "outline-ink" : "outline-transparent hover:outline-border")}>
                      <ThemeTile theme={option.id} />
                    </span>
                    <span className={cn("text-sm", on ? "font-extrabold" : "font-medium")}>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </SettingsSection>

          <section id="jezyk" aria-labelledby="jezyk-title" className="flex scroll-mt-8 flex-wrap items-center justify-between gap-6 border-t border-border py-7">
            <h2 id="jezyk-title" className="text-lg font-extrabold">
              {t("settingsLanguage")}
            </h2>
            <div role="radiogroup" aria-labelledby="jezyk-title" className="flex gap-7 text-[15px]">
              {languages.map((option) => (
                <label key={option.id} className={cn("flex cursor-pointer items-center gap-2.5", lang === option.id ? "font-bold" : "font-normal")}>
                  <input
                    type="radio"
                    name="language"
                    checked={lang === option.id}
                    onChange={() => setLanguage(option.id)}
                    className="h-5 w-5 accent-[hsl(var(--ink))]"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </section>

          <SettingsSection id="pamiec" title={t("settingsMemory")} hint={t("settingsMemoryHint")} className="gap-3.5">
            <div role="radiogroup" aria-label={t("settingsMemory")} className="flex flex-col">
              {memoryOptions.map((option) => {
                const on = memoryMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => void changeMemory(option.id)}
                    className="flex cursor-pointer items-start gap-4 border-0 border-t border-border bg-transparent py-4 text-left text-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2",
                        on ? "border-ink" : "border-muted-foreground"
                      )}
                    >
                      <span className={cn("h-2.5 w-2.5 rounded-full", on ? "bg-ink" : "bg-transparent")} />
                    </span>
                    <span>
                      <span className="block text-[15px] font-bold">{option.label}</span>
                      <span className="mt-[3px] block max-w-[520px] text-[13px] leading-[1.55] text-muted-foreground">{option.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {memorySaved && !memoryError && <p className="text-[13px] text-muted-foreground">{t("memoryAppliesNext")}</p>}
            {memoryError && (
              <p role="alert" className="text-sm text-destructive">
                {memoryError}
              </p>
            )}
          </SettingsSection>

          <section id="dorosli" aria-label={t("settingsAdultTitle")} className="scroll-mt-8 border-t border-border py-7">
            <SwitchRow
              checked={adult}
              onChange={(next) => (next ? setConfirmAdult(true) : setAdult(false))}
              title={t("settingsAdultTitle")}
              large
              tip={t("settingsAdultTip")}
              description={t("settingsAdultDesc")}
            />
          </section>

          <SettingsSection id="pliki" title={t("settingsFiles")} className="gap-5">
            <Field label={t("settingsFolderLabel")} help={folder?.free ? `${t("settingsFreeSpace")} ${folder.free}. ${t("settingsFreeSpaceTail")}` : undefined}>
              <div className="flex items-center gap-3">
                <code
                  className="flex h-12 min-w-0 flex-1 items-center truncate rounded-xl bg-secondary px-4 font-mono text-[13px]"
                  title={folder?.dir}
                >
                  {folder?.dir ?? "…"}
                </code>
                <button type="button" className={outlineButton} onClick={() => setShowFolder(true)}>
                  {t("settingsChange")}
                </button>
              </div>
            </Field>
            <TokenField
              id="hf"
              label={t("settingsHfLabel")}
              help={t("settingsHfHelp")}
              placeholder="hf_…"
              status={hf}
              onSave={saveHfToken}
            />
            <TokenField
              id="civ"
              label={t("settingsCivLabel")}
              tip={t("settingsCivTip")}
              help={t("settingsCivHelp")}
              placeholder={t("settingsCivPlaceholder")}
              status={civitai}
              onSave={saveCivitaiToken}
            />
            <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
              <div className="text-sm font-bold" title={logsDir ?? undefined}>
                {t("settingsLogs")}
              </div>
              <button type="button" data-testid="open-logs-folder-settings" className={linkButton} onClick={() => void apiOpenLogsFolder().catch(() => {})}>
                {t("openLogsFolder")}
              </button>
            </div>
          </SettingsSection>

          <AiProvidersSection />

          <WebSearchSection />

          <SettingsSection id="konto" title={t("settingsAccountTitle")}>
            {currentUser ? (
              <div className="flex flex-wrap items-center gap-4">
                <span aria-hidden="true" className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-primary text-lg font-extrabold text-primary-foreground">
                  {currentUser.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 grow">
                  <span className="block truncate text-base font-extrabold">{currentUser.username}</span>
                  <span className="block text-[13px] text-muted-foreground">{t("settingsSignedInHub")}</span>
                </span>
                <button type="button" onClick={onOpenProfile} className={linkButton}>
                  {t("settingsMyProfile")}
                </button>
                <button type="button" onClick={onLogout} className={outlineButton}>
                  {t("settingsSignOut")}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-6 rounded-3xl bg-primary px-8 py-8 text-primary-foreground">
                <p className="m-0 min-w-[240px] flex-1 font-display text-[22px] font-extrabold leading-[1.25]">{t("settingsAccountCta")}</p>
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="h-[52px] cursor-pointer rounded-2xl bg-primary-foreground px-6 text-[15px] font-extrabold text-primary hover:opacity-90"
                  >
                    {t("settingsSignInButton")}
                  </button>
                  <button type="button" onClick={onCreateAccount} className="cursor-pointer border-0 bg-transparent p-0 text-sm font-bold underline">
                    {t("createAccount")}
                  </button>
                </div>
              </div>
            )}
          </SettingsSection>
        </div>
      </div>

      <Modal isOpen={confirmAdult} onClose={() => setConfirmAdult(false)} title={t("adultConfirmTitle")} size="sm" aria-labelledby="adult-confirm-title">
        <p className="text-sm text-muted-foreground leading-relaxed">{t("adultConfirmBody")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmAdult(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => {
              setAdult(true);
              setConfirmAdult(false);
            }}
          >
            {t("adultConfirmYes")}
          </Button>
        </div>
      </Modal>
      <ModelsFolderModal
        isOpen={showFolder}
        onClose={() => {
          setShowFolder(false);
          void apiModelsLocation()
            .then((info) => setFolder({ dir: info.dir, free: formatFree(info.free_bytes) }))
            .catch(() => {});
        }}
      />
    </div>
  );
}
