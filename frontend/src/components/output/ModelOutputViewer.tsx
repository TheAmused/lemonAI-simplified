import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Lightbox } from "@/components/output/Lightbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown, CodeBlock } from "@/components/output/Markdown";
import { useI18n } from "@/lib/i18n";
import { LemonSlice } from "@/components/shell/icons";

export interface InferenceMetrics {
  ttftMs?: number;
  tps?: number;
  totalTokens?: number;
  durationMs?: number;
}

export interface ModelOutputViewerProps {
  tokens?: string;
  images?: string[];

  audios?: string[];

  jsonValues?: unknown[];
  logs?: string[];
  isStreaming?: boolean;

  progress?: { current: number; total: number; unit: string } | null;
  onClearLogs?: () => void;
  className?: string;
  metrics?: InferenceMetrics | null;

  variant?: "panel" | "stage";

  logsOpen?: boolean;
}

interface ParsedTokenBlock {
  type: "text" | "code";
  language?: string;
  content: string;
}

function parseMarkdownCodeBlocks(raw: string): ParsedTokenBlock[] {
  const blocks: ParsedTokenBlock[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: "text",
        content: raw.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      type: "code",
      language: match[1] || "text",
      content: match[2],
    });
    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < raw.length) {
    const rest = raw.slice(lastIndex);
    const open = /^([\s\S]*?)```([a-zA-Z0-9_-]*)\n([\s\S]*)$/.exec(rest);
    if (open) {
      if (open[1]) blocks.push({ type: "text", content: open[1] });
      blocks.push({ type: "code", language: open[2] || "text", content: open[3] });
    } else {
      blocks.push({ type: "text", content: rest });
    }
  }

  return blocks;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export function extensionForDataUrl(dataUrl: string): string {
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1]?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS[mime] ?? "png";
}

export function extensionForAudioUrl(audioUrl: string): string {
  const mime = /^data:([^;,]+)/.exec(audioUrl)?.[1]?.toLowerCase() ?? "";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("flac")) return "flac";
  if (mime.includes("webm")) return "webm";
  return "wav";
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function formatProgress(p: { current: number; total: number; unit: string }): string {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const unit = p.unit === "step" ? " kroków" : p.unit ? ` ${p.unit}` : "";
  return `${n(p.current)}/${n(p.total)}${unit}`;
}

export type ExportImageFormat = "png" | "webp" | "jpeg";

export async function convertImageFormat(
  dataUri: string,
  targetFormat: ExportImageFormat
): Promise<string> {
  const currentExt = extensionForDataUrl(dataUri);
  if (
    (targetFormat === "png" && currentExt === "png") ||
    (targetFormat === "webp" && currentExt === "webp") ||
    (targetFormat === "jpeg" && (currentExt === "jpg" || currentExt === "jpeg"))
  ) {
    return dataUri;
  }

  if (typeof document === "undefined") {
    return dataUri;
  }

  const probeCanvas = document.createElement("canvas");
  if (!probeCanvas.getContext || !probeCanvas.getContext("2d")) {
    return dataUri;
  }

  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: string) => {
      if (!finished) {
        finished = true;
        resolve(result);
      }
    };

    const isTestEnv = typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || (process.env as Record<string, string>)?.VITEST === "true");
    const timeoutMs = isTestEnv ? 250 : 8000;
    const timer = setTimeout(() => finish(dataUri), timeoutMs);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement("canvas");
          const width = img.naturalWidth || img.width || 512;
          const height = img.naturalHeight || img.height || 512;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            finish(dataUri);
            return;
          }
          if (targetFormat === "jpeg") {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
          }
          ctx.drawImage(img, 0, 0, width, height);
          const mime =
            targetFormat === "jpeg"
              ? "image/jpeg"
              : targetFormat === "webp"
              ? "image/webp"
              : "image/png";
          const converted = canvas.toDataURL(mime, 0.92);
          finish(converted);
        } catch {
          finish(dataUri);
        }
      };

      img.onerror = () => {
        clearTimeout(timer);
        finish(dataUri);
      };

      img.src = dataUri;

      if (typeof window !== "undefined" && (img.complete || img.naturalWidth > 0)) {
        setTimeout(() => {
          img.onload?.(new Event("load"));
        }, 0);
      }
    } catch {
      clearTimeout(timer);
      finish(dataUri);
    }
  });
}

export async function downloadImageAsFormat(
  dataUri: string,
  index: number,
  format: ExportImageFormat = "png"
): Promise<void> {
  let convertedUri = dataUri;
  try {
    convertedUri = await convertImageFormat(dataUri, format);
  } catch {
    convertedUri = dataUri;
  }
  const link = document.createElement("a");
  link.href = convertedUri;
  const ext = format === "jpeg" ? "jpg" : format;
  link.download = `lemon-ai-output-${index + 1}.${ext}`;
  link.setAttribute("data-format", format);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export type LogLevel = "all" | "error" | "warn" | "info";

export function getLogLevel(log: string): "error" | "warn" | "info" {
  const upper = log.toUpperCase();
  if (
    upper.includes("[ERROR]") ||
    upper.includes("ERROR:") ||
    upper.includes("CUDA OUT OF MEMORY") ||
    upper.includes("OOM") ||
    upper.startsWith("ERROR")
  ) {
    return "error";
  }
  if (
    upper.includes("[WARN]") ||
    upper.includes("[WARNING]") ||
    upper.startsWith("WARN") ||
    upper.includes("WARNING:")
  ) {
    return "warn";
  }
  return "info";
}

export function AudioStudioPlayer({ src, index }: { src: string; index: number }) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [copied, setCopied] = useState(false);
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRateRef.current;
    }
  }, [src]);

  const ext = extensionForAudioUrl(src);
  const extBadge = `${ext.toUpperCase()} AUDIO`;

  const speeds = [0.5, 1, 1.25, 1.5, 2];

  const handleTogglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      try {
        const playPromise = el.play();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise.then(() => setIsPlaying(true)).catch(() => {});
        } else {
          setIsPlaying(true);
        }
      } catch {
        setIsPlaying(true);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const handleSetSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = src;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `audio-output-${timestamp}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyAudio = async () => {
    try {
      await navigator.clipboard.writeText(src);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore failure
    }
  };

  return (
    <div
      data-testid={`audio-player-${index}`}
      className="p-4 rounded-xl border border-border bg-card shadow-tactile-light dark:shadow-tactile space-y-3"
    >
      {/* Audio element (hidden, driven by studio controls) */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            setDuration(audioRef.current.duration || 0);
            audioRef.current.playbackRate = playbackRateRef.current;
          }
        }}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      {/* Header bar: Stream Title, Badges, and Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
            Audio Stream #{index + 1}
          </span>
          <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-primary/10 text-ink border border-primary/20">
            {extBadge}
          </span>
          {duration > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded border border-border">
              {formatTime(duration)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyAudio}
            className="h-7 px-2 text-[11px] font-mono"
            title={t("copyAudio")}
          >
            {copied ? (
              <span className="text-emerald-500 font-semibold">{t("audioCopied")}</span>
            ) : (
              <span>{t("copyAudio")}</span>
            )}
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleDownload}
            className="h-7 px-2.5 text-[11px] font-mono"
            title={t("downloadAudio")}
          >
            {t("downloadAudio")}
          </Button>
        </div>
      </div>

      {/* Main Track Controls */}
      <div className="flex items-center gap-3 bg-secondary/40 p-2.5 rounded-lg border border-border/60">
        <button
          type="button"
          onClick={handleTogglePlay}
          aria-label={isPlaying ? "Wstrzymaj" : "Odtwórz"}
          className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs hover:opacity-90 transition-opacity cursor-pointer shadow-xs shrink-0"
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <span className="font-mono text-xs text-muted-foreground tabular-nums shrink-0">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          aria-label="Pasek postępu audio"
          className="flex-1 accent-primary cursor-pointer h-1.5 bg-secondary rounded-lg"
        />
      </div>

      {/* Speed Controls Strip */}
      <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
        <span className="text-[11px] font-mono text-muted-foreground">
          {t("playbackSpeed")}:
        </span>
        <div className="flex items-center gap-1" role="group" aria-label={t("playbackSpeed")}>
          {speeds.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => handleSetSpeed(rate)}
              aria-label={`Prędkość ${rate}x`}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors border",
                playbackRate === rate
                  ? "bg-primary text-primary-foreground font-bold border-primary shadow-xs"
                  : "bg-secondary/60 text-muted-foreground border-border hover:text-foreground"
              )}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function hasSearchMatch(val: unknown, key: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (key.toLowerCase().includes(q)) return true;
  if (val === null || val === undefined) return String(val).toLowerCase().includes(q);
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return String(val).toLowerCase().includes(q);
  }
  if (Array.isArray(val)) {
    return val.some((item, idx) => hasSearchMatch(item, String(idx), q));
  }
  if (typeof val === "object") {
    return Object.entries(val as Record<string, unknown>).some(([k, v]) => hasSearchMatch(v, k, q));
  }
  return false;
}

function HighlightedText({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  if (!query || text.length > 2000) return <span className={className}>{text}</span>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-amber-400/40 text-amber-200 rounded px-0.5 font-bold">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
}

interface JsonNodeItemProps {
  nodeKey?: string;
  value: unknown;
  path: string;
  defaultExpandState: boolean;
  manualToggles: Record<string, boolean>;
  onToggle: (path: string) => void;
  searchQuery: string;
  level?: number;
}

export function JsonNodeItem({
  nodeKey,
  value,
  path,
  defaultExpandState,
  manualToggles,
  onToggle,
  searchQuery,
  level = 0,
}: JsonNodeItemProps) {
  if (searchQuery && !hasSearchMatch(value, nodeKey || "", searchQuery)) {
    return null;
  }

  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isExpandable = isObject || isArray;

  const searchAutoExpand = searchQuery.trim().length > 0;
  const isExpanded = manualToggles[path] ?? (searchAutoExpand ? true : defaultExpandState);

  if (isExpandable) {
    const entries = isArray
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    const count = entries.length;

    return (
      <div className="font-mono text-xs leading-relaxed">
        <div
          className="flex items-center gap-1.5 py-0.5 hover:bg-secondary/40 rounded px-1 -ml-1 cursor-pointer select-none group"
          onClick={() => onToggle(path)}
        >
          <span className="text-[10px] text-muted-foreground w-3 text-center shrink-0">
            {isExpanded ? "▼" : "▶"}
          </span>
          {nodeKey !== undefined && (
            <HighlightedText
              text={nodeKey}
              query={searchQuery}
              className="text-foreground font-semibold"
            />
          )}
          {nodeKey !== undefined && <span className="text-muted-foreground">:</span>}
          <span className="text-muted-foreground text-[11px]">
            {isArray ? `[ ${count} items ]` : `{ ${count} keys }`}
          </span>
        </div>

        {isExpanded && (
          <div className="border-l border-border/50 pl-3 ml-2 space-y-0.5 my-0.5">
            {entries.map(([k, v]) => (
              <JsonNodeItem
                key={k}
                nodeKey={k}
                value={v}
                path={`${path}.${k}`}
                defaultExpandState={defaultExpandState}
                manualToggles={manualToggles}
                onToggle={onToggle}
                searchQuery={searchQuery}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  let formattedValue: React.ReactNode;
  if (typeof value === "string") {
    formattedValue = (
      <HighlightedText
        text={`"${value}"`}
        query={searchQuery}
        className="text-ink break-all"
      />
    );
  } else if (typeof value === "number") {
    formattedValue = (
      <HighlightedText
        text={String(value)}
        query={searchQuery}
        className="text-foreground font-mono"
      />
    );
  } else if (typeof value === "boolean") {
    formattedValue = (
      <HighlightedText
        text={String(value)}
        query={searchQuery}
        className="text-ink font-bold"
      />
    );
  } else if (value === null) {
    formattedValue = <span className="text-zinc-500 italic font-mono">null</span>;
  } else {
    formattedValue = <span className="text-zinc-500 italic font-mono">{String(value)}</span>;
  }

  return (
    <div className="font-mono text-xs leading-relaxed flex items-baseline gap-1 py-0.5 px-1 -ml-1">
      {nodeKey !== undefined && (
        <>
          <HighlightedText
            text={nodeKey}
            query={searchQuery}
            className="text-foreground font-semibold shrink-0"
          />
          <span className="text-muted-foreground shrink-0">:</span>
        </>
      )}
      <span className="break-all">{formattedValue}</span>
    </div>
  );
}

export function JsonTreeInspector({ data, index }: { data: unknown; index: number }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [defaultExpandState, setDefaultExpandState] = useState(true);
  const [manualToggles, setManualToggles] = useState<Record<string, boolean>>({});

  const handleToggle = useCallback((path: string) => {
    setManualToggles((prev) => {
      const current = prev[path] ?? defaultExpandState;
      return { ...prev, [path]: !current };
    });
  }, [defaultExpandState]);

  const handleExpandAll = () => {
    setDefaultExpandState(true);
    setManualToggles({});
  };

  const handleCollapseAll = () => {
    setDefaultExpandState(false);
    setManualToggles({});
  };

  const formattedJson = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    }
  };

  const handleDownloadJson = () => {
    const jsonStr = formattedJson;
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    let url: string;
    let isObjectURL = false;
    if (typeof window.URL?.createObjectURL === "function") {
      try {
        url = window.URL.createObjectURL(blob);
        isObjectURL = true;
      } catch {
        url = "data:application/json;charset=utf-8," + encodeURIComponent(jsonStr);
      }
    } else {
      url = "data:application/json;charset=utf-8," + encodeURIComponent(jsonStr);
    }

    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `data-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (isObjectURL && typeof window.URL?.revokeObjectURL === "function") {
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    }
  };

  return (
    <div
      data-testid={`json-inspector-${index}`}
      className="rounded-xl border border-border bg-carbon-950 text-zinc-100 overflow-hidden shadow-tactile-light dark:shadow-tactile"
    >
      {/* JSON Inspector Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-carbon-900 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-ink">
            JSON Output #{index + 1}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleExpandAll}
              className="px-2 py-0.5 rounded text-[10px] font-mono bg-carbon-800 hover:bg-carbon-700 text-zinc-300 border border-border/40 transition-colors"
            >
              {t("expandAll")}
            </button>
            <button
              type="button"
              onClick={handleCollapseAll}
              className="px-2 py-0.5 rounded text-[10px] font-mono bg-carbon-800 hover:bg-carbon-700 text-zinc-300 border border-border/40 transition-colors"
            >
              {t("collapseAll")}
            </button>
          </div>
        </div>

        {/* Search and Action Buttons */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-[120px] max-w-[180px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchJson")}
              aria-label={t("searchJson")}
              className="w-full bg-carbon-950 border border-border/60 rounded px-2 py-0.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-primary transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300"
                aria-label="Wyczyść wyszukiwanie"
              >
                ✕
              </button>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyJson}
            className="h-6 px-2 text-[10px] font-mono"
            title={t("copyJson")}
          >
            {copied ? (
              <span className="text-emerald-400 font-semibold">{t("jsonCopied")}</span>
            ) : (
              <span>{t("copyJson")}</span>
            )}
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleDownloadJson}
            className="h-6 px-2 text-[10px] font-mono"
            title={t("downloadJson")}
          >
            {t("downloadJson")}
          </Button>
        </div>
      </div>

      {/* Structured Tree Body */}
      <div className="p-4 overflow-x-auto max-h-[420px] select-text">
        <JsonNodeItem
          value={data}
          path="root"
          defaultExpandState={defaultExpandState}
          manualToggles={manualToggles}
          onToggle={handleToggle}
          searchQuery={searchQuery}
        />
        {/* Hidden pre for accessibility & headless DOM parsers */}
        <pre className="hidden" aria-hidden="true" data-testid="raw-json-content">
          {formattedJson}
        </pre>
      </div>
    </div>
  );
}

export function ModelOutputViewer({
  tokens = "",
  images = [],
  audios = [],
  jsonValues = [],
  logs = [],
  isStreaming = false,
  progress = null,
  onClearLogs,
  className,
  metrics = null,
  variant = "panel",
  logsOpen,
}: ModelOutputViewerProps) {
  const { t } = useI18n();
  const isStage = variant === "stage";
  const [copied, setCopied] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [logFilter, setLogFilter] = useState<LogLevel>("all");
  const [logSearch, setLogSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const tokensEndRef = useRef<HTMLDivElement | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const hasContent =
    Boolean(tokens.trim()) || images.length > 0 || audios.length > 0 || jsonValues.length > 0;

  const hasMetrics = Boolean(
    metrics &&
      (metrics.ttftMs !== undefined ||
        metrics.tps !== undefined ||
        metrics.totalTokens !== undefined ||
        metrics.durationMs !== undefined)
  ) || (isStreaming && Boolean(tokens));

  const parsedBlocks = useMemo(
    () => parseMarkdownCodeBlocks(tokens),
    [tokens]
  );

  const logCounts = useMemo(() => {
    let error = 0;
    let warn = 0;
    let info = 0;
    for (const log of logs) {
      const lvl = getLogLevel(log);
      if (lvl === "error") error++;
      else if (lvl === "warn") warn++;
      else info++;
    }
    return { all: logs.length, error, warn, info };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const query = logSearch.trim().toLowerCase();
    return logs.filter((log) => {
      if (logFilter !== "all" && getLogLevel(log) !== logFilter) {
        return false;
      }
      if (query && !log.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [logs, logFilter, logSearch]);

  useEffect(() => {
    if (isStreaming && tokensEndRef.current?.scrollIntoView) {
      tokensEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [tokens, isStreaming]);

  useEffect(() => {
    if (autoScroll && filteredLogs.length > 0 && logsEndRef.current?.scrollIntoView) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [filteredLogs.length, autoScroll]);

  const handleCopy = async () => {
    if (!tokens) return;
    try {
      await navigator.clipboard.writeText(tokens);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCopyLogs = async () => {
    if (filteredLogs.length === 0) return;
    try {
      await navigator.clipboard.writeText(filteredLogs.join("\n"));
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleExportLogs = () => {
    if (filteredLogs.length === 0) return;
    const content = filteredLogs.join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    let url: string;
    let isObjectURL = false;
    if (typeof window.URL?.createObjectURL === "function") {
      try {
        url = window.URL.createObjectURL(blob);
        isObjectURL = true;
      } catch {
        url = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
      }
    } else {
      url = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
    }

    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `telemetry-logs-${timestamp}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (isObjectURL && typeof window.URL?.revokeObjectURL === "function") {
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    }
  };

  const handleDownloadImage = async (dataUri: string, index: number, format: ExportImageFormat = "png") => {
    await downloadImageAsFormat(dataUri, index, format);
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-card border border-border overflow-hidden",
        isStage ? "rounded-[22px]" : "rounded-xl",
        className
      )}
    >
      {/* Dynamic Progress Bar */}
      {isStreaming && progress && progress.total > 0 && (
        <div
          role="progressbar"
          aria-label="Postęp generowania"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.current}
          aria-valuetext={formatProgress(progress)}
          title={formatProgress(progress)}
          className="h-1.5 w-full bg-secondary/80 overflow-hidden relative"
        >
          <div
            className="h-full bg-gradient-to-r from-primary to-amber-400 transition-[width] duration-300 shadow-neon-lemon"
            style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
          />
        </div>
      )}

      {/* Studio Header Bar (the stage shows it only while there is something to say) */}
      {(!isStage || isStreaming || (hasContent && Boolean(tokens))) && (
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card/60 select-none">
        <div className="flex items-center space-x-2.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full transition-colors",
              isStreaming ? "bg-primary animate-pulse" : "bg-muted-foreground/30"
            )}
          />
          {!isStage && (
            <span className="text-sm font-semibold tracking-tight text-foreground w-32 shrink-0">
              {t("modelOutput")}
            </span>
          )}
          {isStreaming && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink font-medium ml-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
              {progress && progress.total > 0
                ? `Generowanie… ${formatProgress(progress)}`
                : t("generating")}
            </span>
          )}
        </div>

        {hasContent && tokens && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2.5 text-xs font-mono font-medium"
          >
            {copied ? (
              <span className="text-emerald-500 font-semibold">{t("copied")}</span>
            ) : (
              <span>{t("copy")}</span>
            )}
          </Button>
        )}
      </div>
      )}

      {/* Inference Telemetry Bar */}
      {hasMetrics && (
        <div
          data-testid="telemetry-bar"
          role="region"
          aria-label="Inference Telemetry"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5 border-b border-border text-xs select-none tabular-nums"
        >
          {/* Token figures mean nothing for an image or a sound: only the time is shown then. */}
          {(Boolean(tokens) || Boolean(metrics?.totalTokens)) && (
          <>
          {/* TTFT */}
          <div className="flex items-center gap-1.5" title="Time To First Token">
            <span className="text-muted-foreground">{t("ttft")}:</span>
            <span className="font-semibold text-foreground">
              {metrics?.ttftMs !== undefined ? `${metrics.ttftMs} ms` : isStreaming ? "..." : "—"}
            </span>
          </div>

          {/* Speed / TPS */}
          <div className="flex items-center gap-1.5" title="Tokens Per Second">
            <span className="text-muted-foreground">{t("speed")}:</span>
            <span className="font-semibold text-foreground">
              {metrics?.tps !== undefined ? `${metrics.tps.toFixed(1)} tok/s` : "—"}
            </span>
          </div>

          {/* Total Tokens */}
          <div className="flex items-center gap-1.5" title="Total Tokens">
            <span className="text-muted-foreground">{t("tokens")}:</span>
            <span className="font-semibold text-foreground">
              {metrics?.totalTokens !== undefined ? `${metrics.totalTokens} tokens` : "—"}
            </span>
          </div>

          </>
          )}

          {/* Elapsed Duration */}
          <div className="flex items-center gap-1.5" title="Duration">
            <span className="text-muted-foreground">{t("duration")}:</span>
            <span className="font-semibold text-foreground">
              {metrics?.durationMs !== undefined ? `${(metrics.durationMs / 1000).toFixed(2)} s` : "—"}
            </span>
          </div>
        </div>
      )}

      {/* Main Content Pane */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-[260px] select-text">
        {!hasContent ? (
          isStage ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-10 select-none">
              <LemonSlice size={120} />
              <p className="text-[22px] font-extrabold tracking-tight text-foreground">{t("stageEmptyTitle")}</p>
              <p className="text-sm text-muted-foreground max-w-[380px] leading-relaxed">{t("stageEmptyHint")}</p>
            </div>
          ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-16 text-muted-foreground select-none">
            <p className="text-sm font-medium text-foreground tracking-tight">
              {t("noOutput")}
            </p>
          </div>
          )
        ) : (
          <div className="space-y-4">
            {images.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {images.map((imgSrc, idx) => {
                  const extBadge = extensionForDataUrl(imgSrc).toUpperCase();
                  return (
                    <div
                      key={idx}
                      className="group relative rounded-xl overflow-hidden border border-border bg-card shadow-tactile-light dark:shadow-tactile p-1"
                    >
                      <div
                        className="rounded-lg overflow-hidden bg-black/20 cursor-pointer"
                        onClick={() => setLightboxIndex(idx)}
                        title="Kliknij, aby otworzyć pełny podgląd"
                      >
                        <img
                          src={imgSrc}
                          alt="Wygenerowany obraz"
                          className="w-full h-auto object-cover transform group-hover:scale-[1.02] transition-transform duration-300"
                        />
                      </div>
                      <div className="absolute inset-0 bg-background/85 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-foreground bg-secondary px-2 py-0.5 rounded border border-border">
                            {extBadge}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">
                            FRAME #{idx + 1}
                          </span>
                        </div>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setLightboxIndex(idx)}
                          className="font-mono text-xs"
                        >
                          Pełny ekran / Podgląd
                        </Button>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[10px] font-mono text-muted-foreground mr-1">Zapisz:</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownloadImage(imgSrc, idx, "png")}
                            className="font-mono text-[11px] h-6 px-1.5"
                            title="Pobierz PNG"
                          >
                            PNG
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownloadImage(imgSrc, idx, "webp")}
                            className="font-mono text-[11px] h-6 px-1.5"
                            title="Pobierz WebP"
                          >
                            WebP
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownloadImage(imgSrc, idx, "jpeg")}
                            className="font-mono text-[11px] h-6 px-1.5"
                            title="Pobierz JPEG"
                          >
                            JPEG
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {audios.length > 0 && (
              <div className="space-y-3">
                {audios.map((src, idx) => (
                  <AudioStudioPlayer key={idx} src={src} index={idx} />
                ))}
              </div>
            )}

            {jsonValues.map((value, idx) => (
              <JsonTreeInspector key={idx} data={value} index={idx} />
            ))}

            {tokens && (
              <div className="space-y-3 font-sans text-sm leading-relaxed text-foreground">
                {parsedBlocks.map((block, idx) => {
                  const isLast = idx === parsedBlocks.length - 1;
                  const activeStreaming = Boolean(isStreaming && isLast);
                  if (block.type === "code") {
                    return (
                      <CodeBlock
                        key={idx}
                        code={block.content}
                        language={block.language}
                        isStreaming={activeStreaming}
                      />
                    );
                  }
                  return (
                    <div key={idx} className="space-y-2">
                      <Markdown source={block.content} isStreaming={activeStreaming} />
                    </div>
                  );
                })}
                {isStreaming && (
                  <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse align-middle shadow-neon-lemon" />
                )}
                <div ref={tokensEndRef} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Image Lightbox */}
      {lightboxIndex !== null && images[lightboxIndex] && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDownload={(uri, i, format) => void handleDownloadImage(uri, i, format)}
        />
      )}

      {/* Telemetry Console (on the stage, opened from the Studio header's "Dziennik") */}
      <div className={cn("border-t border-border bg-card/40", isStage && !logsOpen && "hidden")}>
        <div className={cn("flex items-center justify-between px-4 py-2 text-xs", isStage && "hidden")}>
          <button
            type="button"
            onClick={() => setLogsExpanded(!logsExpanded)}
            className="flex items-center space-x-2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none cursor-pointer select-none"
            aria-label={t("telemetryConsole")}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                logs.length > 0 ? "bg-primary" : "bg-muted-foreground/40"
              )}
            />
            <span className="font-mono text-xs font-medium">
              {t("telemetryConsole")}
            </span>
            <span className="bg-secondary text-secondary-foreground font-mono px-1.5 py-0.2 rounded text-[10px] border border-border/60">
              {logs.length}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {logsExpanded ? "▼" : "▲"}
            </span>
          </button>

          {/* Action buttons on header */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAutoScroll((prev) => !prev)}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors border",
                autoScroll
                  ? "bg-primary/10 text-ink border-primary/30"
                  : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground"
              )}
              aria-pressed={autoScroll}
              title={autoScroll ? "Auto-scroll włączony" : "Auto-scroll wyłączony"}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  autoScroll ? "bg-primary animate-pulse" : "bg-muted-foreground/40"
                )}
              />
              <span>Auto-scroll</span>
            </button>

            {logs.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyLogs}
                  className="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                  title="Kopiuj odfiltrowane logi do schowka"
                >
                  {copiedLogs ? "Skopiowano!" : "Kopiuj logi"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportLogs}
                  className="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                  title="Eksportuj logi do pliku"
                >
                  Eksportuj logi
                </Button>
              </>
            )}

            {logs.length > 0 && onClearLogs && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearLogs}
                className="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
              >
                {t("clear")}
              </Button>
            )}
          </div>
        </div>

        {/* Expandable Drawer Body */}
        <div
          className={cn(
            "flex flex-col bg-carbon-950 text-zinc-300 select-text transition-all",
            logsExpanded || (isStage && logsOpen) ? "h-56 border-t border-border/40" : "hidden"
          )}
        >
          {/* Toolbar: Filter Tabs & Real-time Search */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/30 bg-carbon-900/60">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Filtry logów">
              <button
                type="button"
                role="tab"
                aria-selected={logFilter === "all"}
                onClick={() => setLogFilter("all")}
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] font-mono transition-colors",
                  logFilter === "all"
                    ? "bg-secondary text-foreground font-semibold border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Wszystkie ({logCounts.all})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={logFilter === "error"}
                onClick={() => setLogFilter("error")}
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] font-mono transition-colors",
                  logFilter === "error"
                    ? "bg-red-500/20 text-red-400 font-semibold border border-red-500/30"
                    : "text-muted-foreground hover:text-red-400"
                )}
              >
                Błędy ({logCounts.error})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={logFilter === "warn"}
                onClick={() => setLogFilter("warn")}
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] font-mono transition-colors",
                  logFilter === "warn"
                    ? "bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30"
                    : "text-muted-foreground hover:text-amber-400"
                )}
              >
                Ostrzeżenia ({logCounts.warn})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={logFilter === "info"}
                onClick={() => setLogFilter("info")}
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] font-mono transition-colors",
                  logFilter === "info"
                    ? "bg-sky-500/20 text-sky-400 font-semibold border border-sky-500/30"
                    : "text-muted-foreground hover:text-sky-400"
                )}
              >
                Informacje ({logCounts.info})
              </button>
            </div>

            {/* Real-time Search Input */}
            <div className="relative flex-1 min-w-[140px] max-w-xs">
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Szukaj w logach..."
                aria-label="Szukaj w logach"
                className="w-full bg-carbon-900 border border-border/60 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-primary/60 transition-colors"
              />
              {logSearch && (
                <button
                  type="button"
                  onClick={() => setLogSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300"
                  aria-label="Wyczyść wyszukiwanie"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Logs List Area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-[11px] leading-snug">
            {logs.length === 0 ? (
              <div className="text-zinc-600 italic font-mono text-[11px]">
                {t("idleLogs")}
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-zinc-500 italic font-mono text-[11px]">
                Brak logów pasujących do wybranego filtra lub zapytania.
              </div>
            ) : (
              filteredLogs.map((log, idx) => {
                const level = getLogLevel(log);
                return (
                  <div
                    key={idx}
                    className={cn(
                      "break-all flex items-start gap-2",
                      level === "error"
                        ? "text-red-400 font-semibold"
                        : level === "warn"
                        ? "text-amber-400"
                        : "text-zinc-300"
                    )}
                  >
                    <span className="text-zinc-600 select-none text-[10px]">›</span>
                    <span>{log}</span>
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
