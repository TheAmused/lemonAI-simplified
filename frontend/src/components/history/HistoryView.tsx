import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiHistoryDelete,
  apiHistoryList,
  apiHistoryRead,
  apiHistoryReveal,
  saveHistoryFile,
  type HistoryEntry,
  type HistoryPage,
} from "@/lib/ipc";
import { Notice } from "@/components/shell/Page";
import { AudioIcon, LemonSlice, SearchIcon } from "@/components/shell/icons";
import { cn } from "@/lib/utils";

const PAGE = 48;

const MONTHS_PL = [
  "stycznia",
  "lutego",
  "marca",
  "kwietnia",
  "maja",
  "czerwca",
  "lipca",
  "sierpnia",
  "września",
  "października",
  "listopada",
  "grudnia",
];

export function dayLabel(ms: number, now: number = Date.now()): string {
  const start = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = start(now);
  const day = start(ms);
  if (day === today) return "Dzisiaj";
  if (day === today - 86_400_000) return "Wczoraj";
  const d = new Date(ms);
  const base = `${d.getDate()} ${MONTHS_PL[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear()
    ? base
    : `${base} ${d.getFullYear()}`;
}

export function resultsLabel(n: number): string {
  if (n === 1) return "1 wynik";
  const last = n % 10;
  const tens = n % 100;
  return last >= 2 && last <= 4 && !(tens >= 12 && tens <= 14)
    ? `${n} wyniki`
    : `${n} wyników`;
}

function when(ms: number): string {
  return new Date(ms).toLocaleString("pl-PL");
}

export function descriptionOf(params: HistoryEntry["params"]): string {
  if (!params) return "";
  for (const key of ["prompt", "text", "description", "caption"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function paramsText(params: HistoryEntry["params"]): string {
  if (!params) return "";
  return Object.entries(params)
    .filter(
      ([, v]) =>
        v !== null && v !== undefined && v !== "" && typeof v !== "object",
    )
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

const LABELS: Record<string, string> = {
  aspect_ratio: "Kształt",
  dimensions: "Rozmiar",
  steps: "Kroki",
  num_inference_steps: "Kroki",
  inference_steps: "Kroki",
  seed: "Ziarno",
  guidance_scale: "Prowadzenie",
  cfg_scale: "Prowadzenie",
  negative_prompt: "Wykluczone",
  duration: "Czas trwania",
  duration_s: "Czas trwania",
};
const MONO = new Set([
  "steps",
  "num_inference_steps",
  "inference_steps",
  "seed",
  "guidance_scale",
  "cfg_scale",
  "duration",
  "duration_s",
]);

function useResult(id: string | null) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    if (!id) return;
    let active = true;
    void apiHistoryRead(id)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null));
    return () => {
      active = false;
    };
  }, [id]);
  return data;
}

function Thumb({
  entry,
  selected,
  onOpen,
}: {
  entry: HistoryEntry;
  selected: boolean;
  onOpen: () => void;
}) {
  const data = useResult(entry.kind === "image" ? entry.id : null);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      aria-label={`${entry.kind === "audio" ? "Nagranie" : "Obraz"}: ${entry.model_name}, ${when(entry.created_at)}`}
      className={cn(
        "mb-3.5 block w-full cursor-pointer overflow-hidden rounded-2xl bg-secondary text-left outline outline-[3px] outline-offset-2 transition-[outline-color]",
        selected
          ? "outline-foreground"
          : "outline-transparent hover:outline-primary",
      )}
      style={{ breakInside: "avoid" }}
    >
      {entry.kind === "image" ? (
        data ? (
          <img src={data} alt="" className="block h-auto w-full" />
        ) : (
          <span className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
            …
          </span>
        )
      ) : (
        <span className="flex aspect-square flex-col items-center justify-center gap-2 px-3 text-center">
          <AudioIcon size={34} className="text-muted-foreground" />
          <span className="line-clamp-2 text-[13px] font-bold">
            {entry.model_name}
          </span>
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {descriptionOf(entry.params) || "—"}
          </span>
        </span>
      )}
      {/* The line under the picture is for screen readers and tests: what it is and how it was made. */}
      <span className="sr-only">{paramsText(entry.params)}</span>
    </button>
  );
}

function DetailPanel({
  entry,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  onDelete,
  onUse,
  onError,
}: {
  entry: HistoryEntry;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDelete: () => void;
  onUse?: () => void;
  onError: (message: string) => void;
}) {
  const data = useResult(entry.id);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [entry.id]);
  const description = descriptionOf(entry.params);
  const rest = Object.entries(entry.params ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && v !== description,
  );
  const iconBtn =
    "flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-foreground hover:bg-secondary";
  const fail = (err: unknown) =>
    onError(err instanceof Error ? err.message : String(err));

  return (
    <aside
      aria-label="Szczegóły wyniku"
      className="flex w-[420px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-card px-7 py-6"
    >
      <div className="flex items-center gap-1">
        <div className="flex-1 text-[13px] font-bold text-muted-foreground">
          Wynik {index + 1} z {total}
        </div>
        <button
          type="button"
          aria-label="Poprzedni"
          onClick={onPrev}
          className={iconBtn}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Następny"
          onClick={onNext}
          className={iconBtn}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Zamknij"
          onClick={onClose}
          className={iconBtn}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="overflow-hidden rounded-[18px] bg-secondary">
        {data ? (
          entry.kind === "image" ? (
            <img
              src={data}
              alt={description || "Podgląd wyniku"}
              className="block h-auto w-full"
            />
          ) : (
            <div className="p-5">
              <audio controls src={data} className="w-full" />
            </div>
          )
        ) : (
          <p className="flex aspect-square items-center justify-center text-sm text-muted-foreground">
            Wczytywanie…
          </p>
        )}
      </div>

      {description && (
        <div>
          <div className="flex items-baseline justify-between">
            <div className="text-[13px] font-bold">Opis</div>
            <button
              type="button"
              className="cursor-pointer text-[13px] font-semibold underline"
              onClick={() => {
                void navigator.clipboard?.writeText(description).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Skopiowano" : "Kopiuj"}
            </button>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-[1.6]">
            {description}
          </p>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 border-y border-border py-4 text-sm">
        <dt className="text-muted-foreground">Model</dt>
        <dd className="text-right font-semibold">{entry.model_name}</dd>
        {rest.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{LABELS[key] ?? key}</dt>
            <dd
              className={cn(
                "break-words text-right font-semibold",
                MONO.has(key) && "font-mono",
              )}
            >
              {typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
            </dd>
          </div>
        ))}
        <dt className="text-muted-foreground">Utworzono</dt>
        <dd className="text-right font-semibold">{when(entry.created_at)}</dd>
      </dl>

      <div className="flex flex-col gap-2">
        {onUse && (
          <button
            type="button"
            onClick={onUse}
            className="h-[52px] cursor-pointer rounded-2xl bg-primary text-base font-extrabold text-primary-foreground"
          >
            Użyj tych ustawień
          </button>
        )}
        <div className="flex items-center justify-between pt-1.5">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void apiHistoryReveal(entry.id).catch(fail)}
              className="h-10 cursor-pointer px-1 text-sm font-semibold"
            >
              Pokaż w folderze
            </button>
            <button
              type="button"
              onClick={() => void saveHistoryFile(entry).catch(fail)}
              className="h-10 cursor-pointer px-1 text-sm font-semibold"
            >
              Zapisz jako…
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              confirmDelete ? onDelete() : setConfirmDelete(true)
            }
            onBlur={() => setConfirmDelete(false)}
            className="h-10 cursor-pointer px-1 text-sm font-semibold text-destructive"
          >
            {confirmDelete ? "Na pewno usunąć?" : "Usuń"}
          </button>
        </div>
      </div>
    </aside>
  );
}

export function HistoryView({
  models,
  onOpenStudio,
  onUseSettings,
}: {
  models: { id: string; name: string }[];

  onOpenStudio?: () => void;

  onUseSettings?: (entry: HistoryEntry) => void;
}) {
  const [modelId, setModelId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await apiHistoryList(modelId || null, 0, limit);
      if (mounted.current) setPage(data);
    } catch (err: unknown) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : String(err));
    }
  }, [modelId, limit]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const needle = query.trim().toLowerCase();
  const entries = useMemo(
    () =>
      (page?.entries ?? []).filter(
        (e) =>
          !needle ||
          paramsText(e.params).toLowerCase().includes(needle) ||
          e.model_name.toLowerCase().includes(needle),
      ),
    [page, needle],
  );
  const groups = useMemo(() => {
    const out: { label: string; items: HistoryEntry[] }[] = [];
    for (const entry of entries) {
      const label = dayLabel(entry.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(entry);
      else out.push({ label, items: [entry] });
    }
    return out;
  }, [entries]);

  const selectedIndex = selectedId
    ? entries.findIndex((e) => e.id === selectedId)
    : -1;
  const selected = selectedIndex >= 0 ? entries[selectedIndex] : null;
  const step = (delta: number) => {
    if (entries.length === 0) return;
    const next =
      (Math.max(selectedIndex, 0) + delta + entries.length) % entries.length;
    setSelectedId(entries[next].id);
  };

  const remove = async (entry: HistoryEntry) => {
    const next =
      entries[selectedIndex + 1] ?? entries[selectedIndex - 1] ?? null;
    setSelectedId(next && next.id !== entry.id ? next.id : null);
    try {
      await apiHistoryDelete([entry.id]);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const columns = selected ? "columns-3" : "columns-4";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-12 pb-10 pt-8">
        <header className="flex flex-wrap items-end gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em]">
              Historia
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Każdy wynik ze Studio, razem z ustawieniami. Pliki leżą na Twoim
              dysku.
            </p>
          </div>
          <label className="flex h-11 w-60 items-center gap-2.5 border-b-2 border-border text-muted-foreground focus-within:border-foreground">
            <SearchIcon size={18} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj w opisach"
              aria-label="Szukaj w opisach"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </header>

        <div className="-mt-2 flex items-center">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Model
            <select
              aria-label="Model"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setLimit(PAGE);
                setSelectedId(null);
              }}
              className="h-11 cursor-pointer border-0 border-b-2 border-border bg-transparent text-sm font-semibold text-foreground focus:outline-none"
            >
              <option value="">Wszystkie</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <Notice tone="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        )}

        {!page ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Wczytywanie…
          </p>
        ) : page.entries.length === 0 ? (
          <div className="mx-auto my-14 flex flex-col items-center gap-3.5 text-center">
            <LemonSlice size={96} />
            <p className="font-display text-[28px] font-extrabold">
              Tu pojawią się Twoje wyniki
            </p>
            <p className="max-w-[340px] text-sm leading-[1.55] text-muted-foreground">
              Obrazy i nagrania ze Studio zapisują się tutaj same.
            </p>
            {onOpenStudio && (
              <button
                type="button"
                onClick={onOpenStudio}
                className="mt-1 h-[52px] cursor-pointer rounded-2xl bg-primary px-7 text-base font-extrabold text-primary-foreground"
              >
                Przejdź do Studio
              </button>
            )}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Brak wyników pasujących do wyszukiwania.
          </p>
        ) : (
          <>
            <p className="sr-only" role="status">
              Wyników: {page.total}
            </p>
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <div className="mb-3.5 flex items-baseline gap-3">
                  <h2 className="font-display text-[22px] font-bold">
                    {group.label}
                  </h2>
                  <span className="text-[13px] text-muted-foreground">
                    {resultsLabel(group.items.length)}
                  </span>
                </div>
                <div className={cn(columns, "gap-3.5")}>
                  {group.items.map((entry) => (
                    <Thumb
                      key={entry.id}
                      entry={entry}
                      selected={entry.id === selectedId}
                      onOpen={() => setSelectedId(entry.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="font-mono text-xs" title="Folder z plikami">
                {page.dir}
              </span>
              {page.entries.length < page.total && (
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + PAGE)}
                  className="cursor-pointer font-semibold text-foreground underline"
                >
                  Pokaż starsze ({page.total - page.entries.length})
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {selected && (
        <DetailPanel
          entry={selected}
          index={selectedIndex}
          total={page?.total ?? entries.length}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setSelectedId(null)}
          onDelete={() => void remove(selected)}
          onUse={onUseSettings ? () => onUseSettings(selected) : undefined}
          onError={setError}
        />
      )}
    </div>
  );
}
