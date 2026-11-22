import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/hub-api";
import { apiAppUpdateCheck, apiAppUpdateInstall, type AppUpdateInfo, type UpdateProgress } from "@/lib/ipc";

const CHECK_DELAY_MS = 4000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function UpdateBanner({ checkDelayMs = CHECK_DELAY_MS }: { checkDelayMs?: number }) {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = () =>
      void apiAppUpdateCheck(API_BASE_URL)
        .then((result) => {
          if (active) setInfo(result);
        })
        .catch(() => {});
    const first = setTimeout(check, checkDelayMs);
    const every = setInterval(check, CHECK_EVERY_MS);
    return () => {
      active = false;
      clearTimeout(first);
      clearInterval(every);
    };
  }, [checkDelayMs]);

  if (!info?.available || dismissed) return null;
  const available = info.available;
  const pct = progress?.total ? Math.min(100, Math.floor((progress.downloaded * 100) / progress.total)) : null;

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await apiAppUpdateInstall(API_BASE_URL, setProgress);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  };

  return (
    <div role="status" className="flex shrink-0 items-center gap-[18px] border-b border-border bg-soft px-7 py-3 text-[13.5px]">
      <div className="min-w-0 flex-1">
        <div className="font-bold">
          {error
            ? `Aktualizacja nie powiodła się: ${error}`
            : `Dostępna nowa wersja LemonAI: ${available.version} (masz ${info.current_version}).`}
        </div>
        {available.notes && !installing && !error && <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-muted-foreground">{available.notes}</div>}
      </div>
      {installing ? (
        <div
          className="relative flex h-[30px] w-56 items-center overflow-hidden rounded-lg border border-border bg-card px-2.5"
          {...(pct !== null
            ? { role: "progressbar", "aria-label": "Pobieranie aktualizacji", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct }
            : {})}
        >
          {pct !== null && <div aria-hidden="true" className="absolute inset-y-0 left-0 bg-primary opacity-55" style={{ width: `${progress?.finished ? 100 : pct}%` }} />}
          <span className="relative font-semibold">{progress?.finished ? "Instalowanie…" : pct !== null ? `Pobieranie ${pct}%` : "Pobieranie…"}</span>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void install()}
            className="h-9 cursor-pointer rounded-[10px] border-0 bg-primary px-4 text-[13.5px] font-extrabold text-primary-foreground"
          >
            Zainstaluj i uruchom ponownie
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="h-9 cursor-pointer border-0 bg-transparent px-2.5 text-[13.5px] font-semibold text-foreground"
          >
            Później
          </button>
        </>
      )}
    </div>
  );
}
