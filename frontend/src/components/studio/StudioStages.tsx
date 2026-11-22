import { useEffect, useMemo, useRef, useState } from "react";
import { apiHistoryList, apiHistoryRead, type HistoryEntry } from "@/lib/ipc";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LemonSlice, SearchIcon } from "@/components/shell/icons";
import { Lightbox } from "@/components/output/Lightbox";
import {
  JsonNodeItem,
  downloadImageAsFormat,
  extensionForAudioUrl,
  extensionForDataUrl,
  formatProgress,
  formatTime,
  getLogLevel,
  type InferenceMetrics,
  type LogLevel,
} from "@/components/output/ModelOutputViewer";

export type Progress = { current: number; total: number; unit: string } | null;

export function resultSummary(params: Record<string, unknown> | null | undefined, durationMs?: number): string {
  const parts: string[] = [];
  const p = params ?? {};
  if (p.aspect_ratio) parts.push(String(p.aspect_ratio));
  const steps = p.steps ?? p.num_inference_steps ?? p.inference_steps;
  if (typeof steps === "number") {
    const last = steps % 10;
    parts.push(`${steps} ${steps === 1 ? "krok" : last >= 2 && last <= 4 && !(steps % 100 >= 12 && steps % 100 <= 14) ? "kroki" : "kroków"}`);
  }
  if (typeof p.seed === "number" && p.seed >= 0) parts.push(`ziarno ${p.seed}`);
  if (typeof p.duration === "number") parts.push(`${p.duration} s`);
  if (durationMs !== undefined) parts.push(`${(durationMs / 1000).toFixed(1).replace(".", ",")} s`);
  return parts.join(" · ");
}

const stageCard = "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-border bg-card";

export function LogDrawer({ logs, className }: { logs: string[]; className?: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [logs.length]);
  return (
    <div
      role="log"
      aria-label="Dziennik"
      className={cn(
        "flex max-h-[130px] flex-col gap-1.5 overflow-auto border-t border-border px-6 py-3 font-mono text-xs text-muted-foreground",
        className
      )}
    >
      {logs.length === 0 ? <div>—</div> : logs.map((line, i) => <div key={i}>{line}</div>)}
      <div ref={end} />
    </div>
  );
}

export function EmptyStage({ kind }: { kind: "image" | "audio" | "json" | "text" }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 select-none flex-col items-center justify-center gap-4 p-8 text-center">
      <LemonSlice size={120} />
      <p className="font-display text-[28px] font-extrabold tracking-[-0.01em]">
        {kind === "audio" ? t("stageAudioEmptyTitle") : t("stageEmptyTitle")}
      </p>
      <p className="max-w-[380px] text-sm leading-[1.55] text-muted-foreground">
        {kind === "audio" ? t("stageAudioEmptyHint") : kind === "image" ? t("stageImageEmptyHint") : t("stageEmptyHint")}
      </p>
    </div>
  );
}

export function GeneratingStage({ progress }: { progress: Progress }) {
  const { t } = useI18n();
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.current / progress.total) * 100) : null;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[18px] p-8 text-center">
      <div
        aria-hidden="true"
        className="flex h-[300px] w-[300px] max-w-full items-center justify-center rounded-[18px] border border-dashed border-border bg-secondary"
      >
        <svg width="96" height="96" viewBox="0 0 120 120" className="animate-spin" style={{ animationDuration: "1.6s" }}>
          <circle cx="60" cy="60" r="54" fill="none" className="stroke-border" strokeWidth="8" />
          <path d="M60 6A54 54 0 0 1 114 60" fill="none" className="stroke-primary" strokeWidth="8" strokeLinecap="round" />
        </svg>
      </div>
      <div role="status" className="font-display text-2xl font-extrabold">
        {t("stageGenerating")}
        {progress && progress.total > 0 ? ` ${formatProgress(progress)}` : ""}
      </div>
      <div
        role="progressbar"
        aria-label="Postęp generowania"
        aria-valuemin={0}
        aria-valuemax={progress?.total ?? 100}
        aria-valuenow={progress?.current ?? 0}
        className="h-2 w-80 max-w-full overflow-hidden rounded bg-secondary"
      >
        <div
          className={cn("h-full bg-primary transition-[width] duration-300", pct === null && "w-1/3 animate-pulse")}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <div className="text-[13px] text-muted-foreground">{t("stageGeneratingNote")}</div>
    </div>
  );
}

async function copyImage(dataUrl: string): Promise<void> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (Item && navigator.clipboard?.write) {
      await navigator.clipboard.write([new Item({ [blob.type]: blob })]);
      return;
    }
  } catch {
    /* fall through */
  }
  await navigator.clipboard?.writeText(dataUrl);
}

const textButton =
  "h-9 cursor-pointer border-0 bg-transparent px-1 text-[13px] font-semibold text-foreground disabled:opacity-50";

export function ImageStage({
  images,
  params,
  metrics,
  onOpenHistory,
}: {
  images: string[];
  params: Record<string, unknown> | null;
  metrics: InferenceMetrics | null;
  onOpenHistory?: () => void;
}) {
  const { t } = useI18n();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const meta = resultSummary(params, metrics?.durationMs);
  const last = images.length - 1;
  const shown = images.length > 1 ? images : [images[last]];
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center justify-center p-5">
        <div className={cn("flex h-full max-h-[440px] min-h-0 items-center justify-center gap-3", images.length > 1 && "w-full")}>
          {shown.map((src, i) => {
            const index = images.length > 1 ? i : last;
            return (
              <button
                key={index}
                type="button"
                onClick={() => setLightbox(index)}
                aria-label={`Pełny ekran / Podgląd — kadr #${index + 1}`}
                className="h-full min-h-0 min-w-0 cursor-zoom-in overflow-hidden rounded-[18px] border-0 bg-transparent p-0"
              >
                <img src={src} alt={images.length > 1 ? `Wygenerowany obraz #${index + 1}` : "Wygenerowany obraz"} className="block h-full max-h-[440px] w-auto max-w-full rounded-[18px] object-contain" />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-[22px] px-6 pb-[18px] text-[13px] text-muted-foreground">
        <span className="font-mono text-xs">{meta}</span>
        <span className="flex-1" />
        <button type="button" className={textButton} onClick={() => void downloadImageAsFormat(images[last], last, "png")}>
          {t("stageSaveAs")}
        </button>
        <button
          type="button"
          className={textButton}
          onClick={() =>
            void copyImage(images[last]).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? t("copied") : t("stageCopy")}
        </button>
        {onOpenHistory && (
          <button type="button" className={cn(textButton, "underline")} onClick={onOpenHistory}>
            {t("stageShowInHistory")}
          </button>
        )}
      </div>
      {lightbox !== null && (
        <Lightbox
          images={images}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          onDownload={(uri, i, format) => void downloadImageAsFormat(uri, i, format)}
          meta={meta}
        />
      )}
    </>
  );
}

const BARS = 72;

function pseudoPeaks(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += Math.max(1, Math.floor(seed.length / 64))) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < BARS; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) + i;
    const r = ((h >>> 0) % 1000) / 1000;
    out.push(0.15 + 0.85 * Math.abs(Math.sin(i / 5 + r * 2)) * (0.4 + 0.6 * r));
  }
  return out;
}

export function useWaveform(src: string): number[] {
  const [peaks, setPeaks] = useState<number[]>(() => pseudoPeaks(src));
  useEffect(() => {
    setPeaks(pseudoPeaks(src));
    let alive = true;
    void (async () => {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const buffer = await (await fetch(src)).arrayBuffer();
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(buffer);
        void ctx.close?.();
        const data = decoded.getChannelData(0);
        const block = Math.max(1, Math.floor(data.length / BARS));
        const raw: number[] = [];
        for (let i = 0; i < BARS; i++) {
          let max = 0;
          for (let j = 0; j < block; j += Math.max(1, Math.floor(block / 64))) max = Math.max(max, Math.abs(data[i * block + j] ?? 0));
          raw.push(max);
        }
        const top = Math.max(...raw, 0.0001);
        if (alive) setPeaks(raw.map((v) => 0.1 + 0.9 * (v / top)));
      } catch {
        /* keep the stand-in */
      }
    })();
    return () => {
      alive = false;
    };
  }, [src]);
  return peaks;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function AudioStage({
  src,
  params,
  onOpenHistory,
}: {
  src: string;
  params: Record<string, unknown> | null;
  onOpenHistory?: () => void;
}) {
  const { t } = useI18n();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [copied, setCopied] = useState(false);
  const peaks = useWaveform(src);
  const ext = extensionForAudioUrl(src);
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;

  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [src]);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate, src]);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    []
  );

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    try {
      const started = el.play();
      if (started && typeof started.then === "function") void started.then(() => setPlaying(true)).catch(() => undefined);
      else setPlaying(true);
    } catch {
      setPlaying(true);
    }
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || duration <= 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const next = Math.max(0, Math.min(1, (e.clientX - box.left) / (box.width || 1))) * duration;
    el.currentTime = next;
    setTime(next);
  };
  const download = () => {
    const link = document.createElement("a");
    link.href = src;
    link.download = `lemon-ai-audio-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const p = params ?? {};
  const meta = [
    typeof p.voice === "string" ? `głos ${p.voice}` : null,
    typeof p.speed === "number" ? `${String(p.speed).replace(".", ",")}×` : null,
    duration > 0 ? `${duration.toFixed(1).replace(".", ",")} s` : null,
    typeof p.seed === "number" && p.seed >= 0 ? `ziarno ${p.seed}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div data-testid="audio-player-0" className="flex flex-1 flex-col justify-center gap-5 px-10 py-8">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        className="hidden"
        onTimeUpdate={() => audio.current && setTime(audio.current.currentTime)}
        onLoadedMetadata={() => {
          if (!audio.current) return;
          setDuration(Number.isFinite(audio.current.duration) ? audio.current.duration : 0);
          audio.current.playbackRate = rate;
        }}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-bold uppercase tracking-[0.06em]">{ext.toUpperCase()} AUDIO</div>
        <div className="font-mono text-xs text-muted-foreground">{meta}</div>
      </div>
      <div>
        <svg
          role="img"
          aria-label={`Przebieg fali dźwiękowej, odtworzono ${Math.round(ratio * 100)} procent`}
          viewBox={`0 0 ${BARS * 8} 64`}
          preserveAspectRatio="none"
          className="block h-20 w-full"
        >
          {peaks.map((v, i) => {
            const h = Math.max(6, v * 56);
            return (
              <rect
                key={i}
                x={i * 8}
                y={(64 - h) / 2}
                width="4"
                height={h}
                rx="2"
                className={i / BARS < ratio ? "fill-ink" : "fill-border"}
              />
            );
          })}
        </svg>
        <div
          role="progressbar"
          aria-label="Pasek postępu audio"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          onClick={seek}
          className="mt-3 h-1 cursor-pointer overflow-hidden rounded-sm bg-border"
        >
          <div className="h-full bg-ink" style={{ width: `${ratio * 100}%` }} />
        </div>
        <div className="mt-2 flex justify-between font-mono text-xs text-muted-foreground">
          <span>{formatClock(time)}</span>
          <span>{formatClock(duration)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Wstrzymaj" : "Odtwórz"}
          className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d={playing ? "M7 5h4v14H7z M13 5h4v14h-4z" : "M7 4.5v15l12-7.5z"} />
          </svg>
        </button>
        <div role="group" aria-label="Prędkość odtwarzania" className="ml-3 flex items-center gap-1">
          {SPEEDS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rate === r}
              aria-label={`Prędkość ${r}x`}
              onClick={() => setRate(r)}
              className={cn(
                "h-9 cursor-pointer rounded-[10px] border-0 px-3 text-[13px] font-bold",
                rate === r ? "bg-primary/25 text-ink" : "bg-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {r}x
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={download}
          className="h-11 cursor-pointer rounded-xl border-2 border-foreground bg-transparent px-[18px] text-sm font-bold text-foreground"
        >
          Pobierz {ext.toUpperCase()}
        </button>
        <button
          type="button"
          className={textButton}
          onClick={() =>
            void navigator.clipboard?.writeText(src).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? t("copied") : t("stageCopy")}
        </button>
        {onOpenHistory && (
          <button type="button" className={cn(textButton, "underline")} onClick={onOpenHistory}>
            {t("stageShowInHistory")}
          </button>
        )}
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function JsonStage({
  values,
  tokens,
  metrics,
  logs,
  showLogs,
  isStreaming,
}: {
  values: unknown[];
  tokens: string;
  metrics: InferenceMetrics | null;
  logs: string[];
  showLogs: boolean;
  isStreaming: boolean;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<"json" | "text">("json");
  const [query, setQuery] = useState("");
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<LogLevel>("all");
  const data = values.length === 1 ? values[0] : values;
  const pretty = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const shownLogs = logs.filter((l) => filter === "all" || getLogLevel(l) === filter);

  const cards: [string, string][] = [];
  if (metrics?.ttftMs !== undefined) cards.push([t("ttft"), `${metrics.ttftMs} ms`]);
  if (metrics?.tps !== undefined) cards.push([t("speed"), `${metrics.tps.toFixed(1).replace(".", ",")} tok/s`]);
  if (metrics?.totalTokens) cards.push([t("tokens"), String(metrics.totalTokens)]);
  cards.push([t("stageMetricTime"), metrics?.durationMs !== undefined ? `${(metrics.durationMs / 1000).toFixed(2).replace(".", ",")} s` : isStreaming ? "…" : "—"]);

  const tab = (id: "json" | "text", label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={view === id}
      onClick={() => setView(id)}
      className={cn(
        "-mb-px h-[52px] cursor-pointer border-0 border-b-[3px] bg-transparent text-sm",
        view === id ? "border-primary font-extrabold text-foreground" : "border-transparent font-semibold text-muted-foreground"
      )}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="flex items-center gap-6 border-b border-border px-6">
        <div role="tablist" aria-label="Widok wyniku" className="flex gap-6">
          {tab("json", "JSON")}
          {tab("text", t("stageTabText"))}
        </div>
        <span className="flex-1" />
        <label className="flex h-10 w-60 items-center gap-2.5 border-b-2 border-border text-muted-foreground focus-within:border-foreground">
          <SearchIcon size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("stageSearchResult")}
            placeholder={t("stageSearchResult")}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="min-h-[200px] flex-1 select-text overflow-auto px-6 py-5">
        {view === "json" ? (
          <div role="tree" aria-label="Inspektor JSON" data-testid="json-inspector-0" className="font-mono text-[13px]">
            <JsonNodeItem
              value={data}
              path="root"
              defaultExpandState
              manualToggles={toggles}
              onToggle={(path) => setToggles((prev) => ({ ...prev, [path]: !(prev[path] ?? true) }))}
              searchQuery={query}
            />
            <pre className="hidden" aria-hidden="true" data-testid="raw-json-content">
              {pretty}
            </pre>
          </div>
        ) : (
          <div className="text-sm leading-[1.7]">
            {tokens.trim() && <p className="mb-3 whitespace-pre-wrap">{tokens}</p>}
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-secondary p-4 font-mono text-[13px]">{pretty}</pre>
          </div>
        )}
      </div>
      <div className="border-t border-border px-6 pb-6 pt-4">
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="text-[13px] font-bold tracking-[0.05em] text-muted-foreground">{t("stageTelemetry")}</h2>
          <div role="group" aria-label="Filtr dziennika" className="flex gap-1">
            {(
              [
                ["all", t("stageLogAll")],
                ["warn", t("stageLogWarn")],
                ["error", t("stageLogError")],
              ] as [LogLevel, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={cn(
                  "h-9 cursor-pointer rounded-[10px] border-0 px-3 text-[13px] font-bold",
                  filter === id ? "bg-primary/25 text-ink" : "bg-transparent text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }} data-testid="telemetry-bar">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-secondary px-3.5 py-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 font-mono text-xl">{value}</div>
            </div>
          ))}
        </div>
        {showLogs && (
          <div className="mt-3 max-h-[130px] overflow-auto font-mono text-xs text-muted-foreground">
            {shownLogs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function useRecent(modelId: string, kind: "image" | "audio", refresh: unknown): HistoryEntry[] {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void apiHistoryList(modelId, 0, kind === "image" ? 5 : 3)
        .then((page) => alive && setEntries(page.entries))
        .catch(() => undefined);
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [modelId, kind, refresh]);
  return entries;
}

function RecentThumb({ entry, active, onOpen }: { entry: HistoryEntry; active: boolean; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void apiHistoryRead(entry.id)
      .then((d) => alive && setSrc(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entry.id]);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Wynik z Historii: ${entry.model_name}`}
      className={cn(
        "h-[84px] w-[84px] shrink-0 cursor-pointer overflow-hidden rounded-[14px] border-2 bg-secondary p-0",
        active ? "border-ink" : "border-transparent"
      )}
    >
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
    </button>
  );
}

export function RecentImages({ entries, onOpenHistory }: { entries: HistoryEntry[]; onOpenHistory?: () => void }) {
  const { t } = useI18n();
  if (entries.length === 0) return null;
  return (
    <aside aria-label="Ostatnie wyniki" className="flex w-[84px] shrink-0 flex-col gap-2.5">
      <div className="text-xs font-bold tracking-[0.04em] text-muted-foreground">{t("stageRecent")}</div>
      {entries.map((entry, i) => (
        <RecentThumb key={entry.id} entry={entry} active={i === 0} onOpen={() => onOpenHistory?.()} />
      ))}
      <button type="button" onClick={onOpenHistory} className="mt-0.5 cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-foreground">
        {t("stageAllResults")}
      </button>
    </aside>
  );
}

export function RecentAudio({ entries, onOpenHistory }: { entries: HistoryEntry[]; onOpenHistory?: () => void }) {
  const { t } = useI18n();
  if (entries.length === 0) return null;
  const label = (e: HistoryEntry) => {
    const p = e.params ?? {};
    const text = [p.text, p.prompt, p.description].find((v): v is string => typeof v === "string" && v.trim() !== "");
    return text ? (text.length > 28 ? `${text.slice(0, 27)}…` : text) : e.model_name;
  };
  return (
    <aside aria-label="Ostatnie wyniki" className="flex w-[220px] shrink-0 flex-col gap-3">
      <div className="text-xs font-bold tracking-[0.04em] text-muted-foreground">{t("stageRecent")}</div>
      {entries.map((entry, i) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onOpenHistory?.()}
          className={cn(
            "flex cursor-pointer flex-col gap-2 rounded-2xl border-2 bg-card px-3.5 py-3 text-left",
            i === 0 ? "border-ink" : "border-transparent"
          )}
        >
          <svg aria-hidden="true" viewBox="0 0 120 20" preserveAspectRatio="none" className="h-5 w-full">
            <path d="M0 10 Q 10 2 20 10 T 40 10 T 60 10 T 80 10 T 100 10 T 120 10" fill="none" className="stroke-ink" strokeWidth="2" />
          </svg>
          <span className="truncate text-[13px] text-muted-foreground">{label(entry)}</span>
        </button>
      ))}
      <button type="button" onClick={onOpenHistory} className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-foreground">
        {t("stageAllResults")}
      </button>
    </aside>
  );
}

export { stageCard, extensionForDataUrl, formatTime };
