import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ModelPackageManifest, ModelState, UIInputDefinition } from "@/types/manifest";
import {
  apiChatCapabilities,
  apiChatContinue,
  apiChatCreate,
  apiChatDelete,
  apiChatGet,
  apiChatList,
  apiChatRename,
  apiChatRegenerate,
  apiChatSend,
  apiGetModelContextWindow,
  apiOpenLogsFolder,
  apiSetModelContextWindow,
  hasProjector,
  LEGACY_MAX_CONTEXT_WINDOW,
  MAX_CONTEXT_WINDOW,
  MAX_OUTPUT_TOKENS,
  MIN_CONTEXT_WINDOW,
  MIN_OUTPUT_TOKENS,
  parseArgCtxSize,
  saveTextFile,
  type ChatCapabilities,
  type ChatMessage,
  type ChatUsage,
  type Conversation,
  type ConversationInfo,
  type InferenceEvent,
  type ModelContextInfo,
  type WebSearchRecord,
} from "@/lib/ipc";
import { BUNDLED_MANIFESTS, expandVariants } from "@/lib/catalog";
import { Textarea } from "@/components/ui/textarea";
import { Markdown, CodeBlock } from "@/components/output/Markdown";
import { fmt, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ChatParamsPanel } from "./ChatParamsPanel";
import { estimateTokens, useInstructions } from "@/lib/instructions";
import { GlobeIcon, SlidersIcon } from "@/components/shell/icons";
import { conversationToMarkdown, exportFileName } from "@/lib/chat-export";

export interface ChatWorkspaceProps {
  model: ModelPackageManifest;
  status: ModelState;

  onEnsureRunning: () => Promise<boolean>;

  onBusyChange?: (busy: boolean) => void;
  onLog?: (message: string) => void;
  logs?: string[];

  header?: ReactNode;
}

export const PARAMS_OPEN_KEY = "lemonai-chat-params-open";

export const WEB_SEARCH_KEY = "lemonai-chat-web-search";

export const EXTENDED_MAX_TOKENS_KEY = "lemonai.chat.extendedMaxTokens";

export const AUTO_CONTINUE_KEY = "lemonai.chat.autoContinue";

export function chatSettingInputs(model: ModelPackageManifest): UIInputDefinition[] {
  const supported = new Set(["text", "textarea", "slider", "number", "switch", "select"]);
  return (model.ui.inputs ?? []).filter((i) => i.name !== "prompt" && supported.has(i.widget));
}

export function defaultChatSettings(model: ModelPackageManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const input of chatSettingInputs(model)) {
    if (input.default !== undefined && input.default !== null) out[input.name] = input.default;
    else if (input.widget === "switch") out[input.name] = false;
  }
  return out;
}

export function chatParams(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "" && key !== "system_prompt") continue;
    out[key] = value;
  }
  return out;
}

export function contextUse(usage: ChatUsage | null | undefined): { used: number; size: number; percent: number } | null {
  if (!usage || !usage.context_size) return null;
  const used = usage.prompt_tokens + usage.completion_tokens;
  return { used, size: usage.context_size, percent: Math.min(100, Math.round((used / usage.context_size) * 100)) };
}

export function formatTokens(n: number, lang: string = "en"): string {
  if (n < 1000) return String(n);
  const v = (n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "");
  return `${lang === "pl" ? v.replace(".", ",") : v}K`;
}

export function groupConversations(items: ConversationInfo[], now: number = Date.now()) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const yesterday = today - 86_400_000;
  const groups: { key: string; label: "chatGroupToday" | "chatGroupYesterday" | "chatGroupEarlier"; items: ConversationInfo[] }[] = [
    { key: "today", label: "chatGroupToday", items: [] },
    { key: "yesterday", label: "chatGroupYesterday", items: [] },
    { key: "earlier", label: "chatGroupEarlier", items: [] },
  ];
  for (const item of items) {
    if (item.updated_at >= today) groups[0].items.push(item);
    else if (item.updated_at >= yesterday) groups[1].items.push(item);
    else groups[2].items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function MessageBody({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const parts = text.split(/```/);
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        const activeStreaming = Boolean(isStreaming && isLast);
        if (i % 2 === 1) {
          const newline = part.indexOf("\n");
          if (newline >= 0) {
            const firstLine = part.slice(0, newline).trim();
            const lang = firstLine || undefined;
            const code = part.slice(newline + 1);
            return <CodeBlock key={i} code={code.replace(/\n$/, "")} language={lang} isStreaming={activeStreaming} />;
          }
          const trimmed = part.trim();
          const isIdentifier = /^[a-zA-Z0-9_+.-]+$/.test(trimmed);
          const lang = isIdentifier ? trimmed : undefined;
          const code = isIdentifier ? "" : part;
          return <CodeBlock key={i} code={code.replace(/\n$/, "")} language={lang} isStreaming={activeStreaming} />;
        }
        return part.trim() ? <Markdown key={i} source={part.trim()} isStreaming={activeStreaming} /> : null;
      })}
    </div>
  );
}

interface StreamingTurn {
  user: string | null;
  continuingMessageId?: string | null;
  continuingStatus?: string | null;
  content: string;
  reasoning: string;
  webSearchStatus?: { stage: string; queries: string[] } | null;
  webSearch?: WebSearchRecord | null;
}

export interface MediaAttachment {
  id: string;
  name: string;
  type: "image" | "audio";
  dataUrl: string;
}

interface MultimodalPart {
  type: string;
  text?: string;
  image_url?: { url: string };
  input_audio?: { data: string; format: string };
  audio_url?: { url: string };
}

const SAFE_IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
const SAFE_AUDIO_DATA_URL_RE = /^data:audio\/(?:x-)?(wav|mp3|mpeg|ogg|mp4|webm|flac|m4a);base64,[A-Za-z0-9+/=]+$/i;

export function isSafeMediaDataUrl(url: string, kind: "image" | "audio"): boolean {
  if (typeof url !== "string") return false;
  return kind === "image" ? SAFE_IMAGE_DATA_URL_RE.test(url) : SAFE_AUDIO_DATA_URL_RE.test(url);
}

export function parseAudioDataUrl(dataUrl: string): { data: string; format: string } {
  const match = dataUrl.match(/^data:audio\/(?:x-)?([a-zA-Z0-9_-]+);base64,(.+)$/);
  if (match) {
    let format = match[1].toLowerCase();
    if (format === "mpeg") format = "mp3";
    return { format, data: match[2] };
  }
  const commaIdx = dataUrl.indexOf(",");
  const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return { format: "wav", data };
}

export function extractReasoning(content: string): { reasoning: string | null; content: string } {
  if (!content.includes("<think>") && !content.includes("<thought>")) {
    return { reasoning: null, content };
  }

  const thoughts: string[] = [];

  if (content.includes("```")) {
    const parts = content.split("```");
    const cleanedParts = parts.map((part, i) => {
      if (i % 2 === 1) {
        return part;
      }
      return part.replace(
        /<(think|thought)>([\s\S]*?)(?:<\/\1>|$)/g,
        (_, _tag, thoughtText) => {
          const trimmed = thoughtText.trim();
          if (trimmed) thoughts.push(trimmed);
          return "";
        }
      );
    });
    return {
      reasoning: thoughts.length > 0 ? thoughts.join("\n\n") : null,
      content: cleanedParts.join("```").trim(),
    };
  }

  const cleaned = content.replace(
    /<(think|thought)>([\s\S]*?)(?:<\/\1>|$)/g,
    (_, _tag, thoughtText) => {
      const trimmed = thoughtText.trim();
      if (trimmed) thoughts.push(trimmed);
      return "";
    }
  );

  return {
    reasoning: thoughts.length > 0 ? thoughts.join("\n\n") : null,
    content: cleaned.trim(),
  };
}

export function Bubble({
  message,
  labels,
  isStreaming = false,
  webSearchStatus = null,
  onContinue,
  onRetry,
  speed,
}: {
  message: ChatMessage;
  labels: Record<string, string>;
  isStreaming?: boolean;
  webSearchStatus?: { stage: string; queries: string[] } | null;
  onContinue?: () => void;

  onRetry?: () => void;

  speed?: number | null;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!lightboxUrl) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxUrl(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxUrl]);

  const isUser = message.role === "user";
  const truncLabel =
    message.truncation_reason === "context_window"
      ? labels.truncatedContext ?? labels.truncated
      : message.truncation_reason === "max_tokens"
        ? labels.truncatedMaxTokens ?? labels.truncated
        : labels.truncated;
  const flags = [
    message.interrupted ? labels.interrupted : null,
    message.truncated ? truncLabel : null,
    message.parts && message.parts > 1
      ? fmt(labels.partBadge ?? "part {n}", { n: message.parts })
      : null,
  ].filter(Boolean);

  let displayContent = message.content;
  let displayReasoning = message.reasoning ?? null;
  if (!isUser && (displayContent.includes("<think>") || displayContent.includes("<thought>"))) {
    const extracted = extractReasoning(displayContent);
    if (!displayReasoning) {
      displayReasoning = extracted.reasoning;
    } else if (extracted.reasoning) {
      displayReasoning = `${displayReasoning}\n\n${extracted.reasoning}`;
    }
    displayContent = extracted.content;
  }

  let multimodalParts: MultimodalPart[] | null = null;
  const contentTrimmed = displayContent.trim();
  const hasContent = Boolean(contentTrimmed && displayContent !== "…");
  if (isUser && contentTrimmed.startsWith("[") && contentTrimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(contentTrimmed);
      if (Array.isArray(parsed) && parsed.every((p) => p && typeof p === "object" && "type" in p)) {
        multimodalParts = parsed as MultimodalPart[];
      }
    } catch {
      // Not a JSON array
    }
  }

  const webSearchRecord = !isUser ? message.web_search ?? null : null;
  const safeWebSources = webSearchRecord
    ? webSearchRecord.sources.filter((s) => /^https?:\/\//i.test(s.url))
    : [];
  const searchStatusText = (() => {
    if (isUser || !webSearchStatus) return null;
    if (webSearchStatus.stage === "planning") {
      return labels.webSearchingPlanning ?? "Planning web search…";
    }
    if (webSearchStatus.stage === "reading") {
      return labels.webSearchingReading ?? "Reading web pages…";
    }
    if (webSearchStatus.queries.length > 0) {
      return fmt(labels.webSearchingQuery ?? "Searching the web: {q}", {
        q: webSearchStatus.queries.join(" · "),
      });
    }
    return labels.webSearchingReading ?? "Searching the web…";
  })();

  const copyableText = multimodalParts
    ? multimodalParts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!.trim())
        .filter(Boolean)
        .join("\n\n")
    : displayContent.trim();

  const handleCopyMessage = async () => {
    if (!copyableText || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(copyableText);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable in restricted contexts.
    }
  };

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")} data-role={message.role}>
      <div
        className={cn(
          "group/bubble min-w-0",
          isUser
            ? "max-w-[78%] rounded-[20px_20px_6px_20px] bg-primary px-[18px] py-3.5 text-primary-foreground"
            : "w-full text-[15px] leading-[1.7] text-foreground"
        )}
      >
        <span className="sr-only">{isUser ? labels.you : labels.model}</span>
        {searchStatusText && (
          <div
            data-testid="web-search-status"
            className="mb-2 flex items-center gap-2 rounded-md border border-border/70 bg-secondary/40 px-2.5 py-1.5 text-xs text-muted-foreground"
          >
            <GlobeIcon size={14} className="shrink-0 text-primary animate-pulse" />
            <span className="truncate">{searchStatusText}</span>
          </div>
        )}
        {webSearchRecord && (
          <details
            data-testid="web-search-sources"
            className="mb-2 rounded-md border border-border/70 bg-secondary/40 px-2.5 py-1.5 text-xs"
          >
            <summary className="cursor-pointer select-none font-medium text-foreground flex items-center gap-1.5">
              <GlobeIcon size={13} className="shrink-0 text-primary" />
              <span>
                {safeWebSources.length === 1
                  ? (labels.webSourceSingle ?? "Web source (1)")
                  : safeWebSources.length > 1
                    ? fmt(labels.webSources ?? "Web sources ({n})", { n: safeWebSources.length })
                    : (labels.webSearchUnavailable ?? "Web search unavailable")}
              </span>
            </summary>
            <div className="mt-2 space-y-2 text-muted-foreground">
              {webSearchRecord.queries.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-medium">{labels.webQueries ?? "Queries:"}</span>
                  {webSearchRecord.queries.map((q, qi) => (
                    <span
                      key={qi}
                      className="rounded bg-background/70 border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                    >
                      {q}
                    </span>
                  ))}
                </div>
              )}
              {webSearchRecord.warning && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{webSearchRecord.warning}</p>
              )}
              {safeWebSources.length > 0 && (
                <ol className="space-y-1.5">
                  {safeWebSources.map((src) => (
                    <li key={`${src.index}-${src.url}`} className="rounded border border-border/60 bg-background/60 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] text-muted-foreground">[{src.index}]</span>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-foreground underline underline-offset-2 hover:text-primary break-all"
                        >
                          {src.title || src.url}
                        </a>
                        {src.domain && (
                          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                            {src.domain}
                          </span>
                        )}
                        {src.page_fetched && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-foreground">
                            {labels.webPageRead ?? "page read"}
                          </span>
                        )}
                      </div>
                      {src.snippet && <p className="mt-1 text-[11px] leading-snug">{src.snippet}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </details>
        )}
        {displayReasoning && (
          <details
            open={isStreaming && !hasContent ? true : undefined}
            className="mb-2.5 rounded-xl bg-soft px-3.5 py-2 text-[13px] text-foreground"
          >
            <summary className="cursor-pointer select-none font-semibold">
              {labels.thinking}
              {isStreaming && !hasContent && (
                <span
                  data-testid="thinking-streaming-indicator"
                  className="inline-block w-1.5 h-1.5 ml-1.5 rounded-full bg-primary animate-pulse"
                  aria-hidden="true"
                />
              )}
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap">
              {displayReasoning}
              {isStreaming && !hasContent && (
                <span
                  data-testid="thinking-cursor"
                  className="inline-block w-1.5 h-3 ml-1 bg-primary animate-pulse align-middle"
                  aria-hidden="true"
                />
              )}
            </p>
          </details>
        )}
        {multimodalParts ? (
          <div className="space-y-2">
            {multimodalParts.map((part, i) => {
              if (part.type === "text" && part.text) {
                return isUser ? (
                  <p key={i} className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {part.text}
                  </p>
                ) : (
                  <MessageBody key={i} text={part.text} isStreaming={isStreaming} />
                );
              }
              if (part.type === "image_url" && part.image_url?.url && isSafeMediaDataUrl(part.image_url.url, "image")) {
                const safeImgUrl = part.image_url.url;
                return (
                  <div key={i} className="mt-1">
                    <img
                      src={safeImgUrl}
                      alt="Attachment"
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightboxUrl(safeImgUrl)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setLightboxUrl(safeImgUrl);
                        }
                      }}
                      className="max-h-48 rounded-md cursor-pointer border border-border object-contain hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                );
              }
              if (part.type === "input_audio" || part.type === "audio") {
                let src = "";
                if (part.input_audio?.data) {
                  src = part.input_audio.data.startsWith("data:")
                    ? part.input_audio.data
                    : `data:audio/${part.input_audio.format || "wav"};base64,${part.input_audio.data}`;
                } else if (part.audio_url?.url) {
                  src = part.audio_url.url;
                }
                if (src && isSafeMediaDataUrl(src, "audio")) {
                  return (
                    <div key={i}>
                      <audio controls src={src} aria-label="Audio attachment" className="mt-2 max-w-full" />
                    </div>
                  );
                }
              }
              return null;
            })}
            {!isUser && isStreaming && hasContent && (
              <span
                data-testid="streaming-indicator"
                className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse align-middle shadow-neon-lemon"
                aria-hidden="true"
              />
            )}
          </div>
        ) : contentTrimmed ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{displayContent}</p>
          ) : (
            <div className="relative">
              <MessageBody text={displayContent} isStreaming={isStreaming} />
              {isStreaming && hasContent && (
                <span
                  data-testid="streaming-indicator"
                  className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse align-middle shadow-neon-lemon"
                  aria-hidden="true"
                />
              )}
            </div>
          )
        ) : displayReasoning || searchStatusText || webSearchRecord ? null : (
          <p className="text-sm italic text-muted-foreground">{labels.noAnswer}</p>
        )}
        {!isUser && !isStreaming && copyableText && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            <button
              type="button"
              data-testid="chat-copy-message"
              aria-label={copied ? (labels.copied ?? "Copied") : (labels.copyMessage ?? "Copy")}
              onClick={() => void handleCopyMessage()}
              className={cn(
                "h-8 cursor-pointer rounded-lg px-2.5 text-[13px] font-semibold transition-colors hover:bg-secondary",
                copied ? "text-ink" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {copied ? (labels.copied ?? "Copied") : (labels.copyMessage ?? "Copy")}
            </button>
            {onRetry && (
              <button
                type="button"
                data-testid="chat-retry"
                onClick={onRetry}
                className="h-8 cursor-pointer rounded-lg px-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                ↻ {labels.retry ?? "Try again"}
              </button>
            )}
            {speed ? (
              <span className="ml-1 font-mono text-xs text-muted-foreground">
                {fmt(labels.speed ?? "{n} tok/s", { n: speed })}
              </span>
            ) : null}
          </div>
        )}
        {isUser && !isStreaming && copyableText && (
          <button
            type="button"
            data-testid="chat-copy-message"
            aria-label={copied ? (labels.copied ?? "Copied") : (labels.copyMessage ?? "Copy")}
            onClick={() => void handleCopyMessage()}
            className="sr-only"
          >
            {labels.copyMessage ?? "Copy"}
          </button>
        )}
        {(flags.length > 0 || onContinue) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {flags.length > 0 && (
              <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400">({flags.join("; ")})</p>
            )}
            {onContinue && (
              <button
                type="button"
                data-testid="chat-continue-button"
                onClick={onContinue}
                className="px-2 py-0.5 rounded-md border border-primary/40 bg-primary/10 text-[11px] font-medium text-foreground hover:bg-primary/20 cursor-pointer"
              >
                {labels.continueAction ?? "Continue"}
              </button>
            )}
          </div>
        )}

        {lightboxUrl && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
            onClick={() => setLightboxUrl(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setLightboxUrl(null);
              }
            }}
          >
            <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
              <img
                src={lightboxUrl}
                alt="Full preview"
                className="max-h-[85vh] max-w-full rounded-md object-contain shadow-pop"
              />
              <button
                type="button"
                aria-label="Close preview"
                onClick={() => setLightboxUrl(null)}
                className="absolute -top-3 -right-3 h-8 w-8 rounded-full bg-background border border-border flex items-center justify-center text-foreground hover:bg-secondary cursor-pointer shadow"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export interface MessageRowProps {
  message: ChatMessage;
  labels: Record<string, string>;
  isStreaming?: boolean;
  webSearchStatus?: { stage: string; queries: string[] } | null;
  onContinue?: () => void;
  onRetry?: () => void;
  speed?: number | null;
}

export const MessageRow = memo(function MessageRow({
  message,
  labels,
  isStreaming = false,
  webSearchStatus = null,
  onContinue,
  onRetry,
  speed,
}: MessageRowProps) {
  return (
    <Bubble
      message={message}
      labels={labels}
      isStreaming={isStreaming}
      webSearchStatus={webSearchStatus}
      onContinue={onContinue}
      onRetry={onRetry}
      speed={speed}
    />
  );
});

const CONTEXT_PRESETS = [4096, 8192, 16384, 32768, 65536, 131072, 262144];

function fallbackContextInfo(model: ModelPackageManifest): ModelContextInfo {
  const catalogMatch = expandVariants(BUNDLED_MANIFESTS.map((manifest) => ({ manifest }))).find(
    (m) => m.manifest.id === model.id
  )?.manifest;
  const cw = model.runtime.context_window ?? catalogMatch?.runtime.context_window;
  const ot = model.runtime.output_tokens ?? catalogMatch?.runtime.output_tokens;
  const recOrArg = cw?.recommended ?? parseArgCtxSize(model.runtime.arguments) ?? 8192;
  const rawMax = cw?.max_supported ?? Math.max(recOrArg, LEGACY_MAX_CONTEXT_WINDOW);
  const maxSupported = Math.max(
    MIN_CONTEXT_WINDOW,
    Math.min(MAX_CONTEXT_WINDOW, Math.round(rawMax))
  );
  const recommended = Math.max(
    MIN_CONTEXT_WINDOW,
    Math.min(maxSupported, Math.round(recOrArg))
  );
  const outputCap = Math.max(MIN_OUTPUT_TOKENS, Math.min(MAX_OUTPUT_TOKENS, maxSupported));
  const rawUiDefault = model.ui.inputs?.find((i) => i.name === "max_tokens")?.default;
  const uiDefault = typeof rawUiDefault === "number" && Number.isFinite(rawUiDefault) ? rawUiDefault : 2048;
  const outputMaxSupported = Math.max(
    MIN_OUTPUT_TOKENS,
    Math.min(outputCap, Math.round(ot?.max_supported ?? outputCap))
  );
  const outputRecommended = Math.max(
    MIN_OUTPUT_TOKENS,
    Math.min(outputMaxSupported, Math.round(ot?.recommended ?? uiDefault))
  );
  return {
    configured: recommended,
    recommended,
    max_supported: maxSupported,
    min_supported: MIN_CONTEXT_WINDOW,
    is_custom: false,
    active: null,
    restart_required: false,
    output_recommended: outputRecommended,
    output_max_supported: outputMaxSupported,
  };
}

function formatContextPreset(tokens: number): string {
  return tokens >= 1024 && tokens % 1024 === 0
    ? `${tokens / 1024}K`
    : tokens.toLocaleString("en-US");
}

function contextPresetValues(info: ModelContextInfo): number[] {
  const vals = new Set<number>();
  for (const preset of CONTEXT_PRESETS) {
    if (preset >= info.min_supported && preset <= info.max_supported) vals.add(preset);
  }
  if (info.recommended >= info.min_supported && info.recommended <= info.max_supported) {
    vals.add(info.recommended);
  }
  return [...vals].sort((a, b) => a - b);
}

export function ChatWorkspace({ model, status, onEnsureRunning, onBusyChange, onLog, logs = [], header }: ChatWorkspaceProps) {
  const { t, lang } = useI18n();
  const settingInputs = useMemo(() => chatSettingInputs(model), [model]);

  const hasSystemPrompt = useMemo(() => settingInputs.some((i) => i.name === "system_prompt"), [settingInputs]);
  const [settings, setSettings] = useState<Record<string, unknown>>(() => defaultChatSettings(model));

  const modelDefaultPrompt = useMemo(() => {
    const value = defaultChatSettings(model).system_prompt;
    return typeof value === "string" ? value : "";
  }, [model]);
  const instructions = useInstructions(modelDefaultPrompt);
  const instructionText = instructions.selected.text;

  const instructionsRef = useRef(instructions);
  instructionsRef.current = instructions;
  const tRef = useRef(t);
  tRef.current = t;

  const adoptPrompt = useCallback(
    (prompt: string | null) => {
      const text = prompt ?? "";
      const current = instructionsRef.current;
      const all = [...current.builtin, ...current.mine];
      if (current.selected.text === text) return;
      const match = all.find((i) => i.text === text);
      if (match) current.select(match.id);
      else current.create(tRef.current("instrFromChat"), text);
    },
    []
  );
  useEffect(() => {
    if (!hasSystemPrompt) return;
    setSettings((prev) => (prev.system_prompt === instructionText ? prev : { ...prev, system_prompt: instructionText }));
  }, [hasSystemPrompt, instructionText]);

  const [paramsOpen, setParamsOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PARAMS_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleParams = () =>
    setParamsOpen((open) => {
      try {
        localStorage.setItem(PARAMS_OPEN_KEY, open ? "0" : "1");
      } catch {
        // Storage unavailable: the choice lasts for this session only.
      }
      return !open;
    });
  const [webSearch, setWebSearch] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WEB_SEARCH_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleWebSearch = () =>
    setWebSearch((on) => {
      const next = !on;
      try {
        if (next) localStorage.setItem(WEB_SEARCH_KEY, "1");
        else localStorage.removeItem(WEB_SEARCH_KEY);
      } catch {
        // Storage unavailable: the choice lasts for this session only.
      }
      return next;
    });
  const [extendedMaxTokens, setExtendedMaxTokens] = useState<boolean>(() => {
    try {
      return localStorage.getItem(EXTENDED_MAX_TOKENS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleExtendedMaxTokens = (next: boolean) => {
    setExtendedMaxTokens(next);
    try {
      if (next) localStorage.setItem(EXTENDED_MAX_TOKENS_KEY, "1");
      else localStorage.removeItem(EXTENDED_MAX_TOKENS_KEY);
    } catch {
      // ignore storage errors
    }
  };
  const [autoContinue, setAutoContinue] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_CONTINUE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleAutoContinue = (next: boolean) => {
    setAutoContinue(next);
    try {
      if (next) localStorage.setItem(AUTO_CONTINUE_KEY, "1");
      else localStorage.removeItem(AUTO_CONTINUE_KEY);
    } catch {
      // ignore storage errors
    }
  };
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = promptInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = Math.min(320, Math.max(180, Math.floor(window.innerHeight * 0.35)));
    const nextHeight = Math.min(Math.max(el.scrollHeight, 52), maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  const [capabilities, setCapabilities] = useState<ChatCapabilities>(() => {
    const projector = hasProjector(model);
    return { vision: projector, audio: projector, confirmed: false };
  });
  const canAttach = capabilities.vision || capabilities.audio;
  const acceptTypes = [
    ...(capabilities.vision ? ["image/png", "image/jpeg", "image/webp"] : []),
    ...(capabilities.audio ? ["audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg"] : []),
  ].join(",");
  const isLlamaCpp = model.runtime.archetype === "llama_cpp_server";
  const initialCtxFallback = useMemo(() => fallbackContextInfo(model), [model]);
  const [contextInfo, setContextInfo] = useState<ModelContextInfo>(() => initialCtxFallback);
  const [ctxInput, setCtxInput] = useState<string>(() => String(initialCtxFallback.configured));
  const [isUpdatingCtx, setIsUpdatingCtx] = useState(false);
  const lastCtxModelIdRef = useRef(model.id);
  const lastCtxConfiguredRef = useRef(initialCtxFallback.configured);

  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingLast, setEditingLast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const turnStart = useRef<number | null>(null);
  const [speeds, setSpeeds] = useState<Record<string, number>>({});

  const recordSpeed = (updated: { messages: ChatMessage[] }) => {
    const t0 = turnStart.current;
    turnStart.current = null;
    const last = updated.messages[updated.messages.length - 1];
    if (t0 === null || !last || last.role !== "assistant") return;
    const seconds = (performance.now() - t0) / 1000;
    const tokens = estimateTokens(last.content);
    if (seconds < 0.3 || tokens < 4) return;
    setSpeeds((prev) => ({ ...prev, [last.id]: Math.round(tokens / seconds) }));
  };
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen]);
  const [showSummary, setShowSummary] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const refreshList = useCallback(async (): Promise<ConversationInfo[]> => {
    try {
      const list = await apiChatList(model.id);
      if (mounted.current) setConversations(list);
      return list;
    } catch (err: unknown) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }, [model.id]);

  const openReqIdRef = useRef(0);
  const open = useCallback(async (id: string) => {
    const reqId = ++openReqIdRef.current;
    try {
      const loaded = await apiChatGet(id);
      if (!mounted.current || reqId !== openReqIdRef.current) return;
      setConversation(loaded);
      setUsage(loaded.usage ?? null);
      if (hasSystemPrompt) {
        setSettings((prev) => ({ ...prev, system_prompt: loaded.system_prompt ?? "" }));
        adoptPrompt(loaded.system_prompt ?? null);
      }
      setError(null);
      setNotice(null);
      setShowSummary(false);
    } catch (err: unknown) {
      if (mounted.current && reqId === openReqIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [hasSystemPrompt, adoptPrompt]);

  useEffect(() => {
    let cancelled = false;
    void refreshList().then((list) => {
      if (!cancelled && list.length > 0) void open(list[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshList, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conversation?.messages.length, streaming?.content, streaming?.reasoning, streaming?.webSearchStatus?.stage, streaming?.webSearch]);

  useEffect(() => {
    if (lastCtxModelIdRef.current !== model.id) {
      lastCtxModelIdRef.current = model.id;
      lastCtxConfiguredRef.current = initialCtxFallback.configured;
      setContextInfo(initialCtxFallback);
      setCtxInput(String(initialCtxFallback.configured));
    }
    if (!isLlamaCpp) return;
    let activeFetch = true;
    void apiGetModelContextWindow(model.id)
      .then((info) => {
        if (!activeFetch || !mounted.current) return;
        setContextInfo(info);
        setCtxInput((prev) =>
          prev === String(lastCtxConfiguredRef.current) ? String(info.configured) : prev
        );
        lastCtxConfiguredRef.current = info.configured;
      })
      .catch(() => {
        // Keep manifest fallback when backend context status is unavailable.
      });
    return () => {
      activeFetch = false;
    };
  }, [model.id, initialCtxFallback, isLlamaCpp, status]);

  const startNew = () => {
    if (isSending) return;
    openReqIdRef.current += 1;
    setConversation(null);
    setUsage(null);
    setError(null);
    setNotice(null);
    setAttachments([]);
    if (hasSystemPrompt) {
      setSettings((prev) => ({ ...prev, system_prompt: instructionText }));
    }
  };

  useEffect(() => {
    const projector = hasProjector(model);
    setCapabilities({ vision: projector, audio: projector, confirmed: false });
  }, [model]);

  useEffect(() => {
    if (status !== "ready" && status !== "inferring") return;
    let cancelled = false;
    apiChatCapabilities(model.id)
      .then((caps) => {
        if (!cancelled && mounted.current) setCapabilities(caps);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [model.id, status]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      if (file.size > 20 * 1024 * 1024) {
        setError(`File "${file.name}" exceeds the maximum allowed size of 20 MB.`);
        return;
      }
      const ext = file.name.split(".").pop()?.toLowerCase();
      const isImage = file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext ?? "");
      const isAudio = file.type.startsWith("audio/") || ["wav", "mp3", "ogg", "m4a"].includes(ext ?? "");
      if (!isImage && !isAudio) return;
      if ((isImage && !capabilities.vision) || (isAudio && !capabilities.audio)) {
        setError(
          isImage
            ? `${model.name} does not accept images.`
            : `${model.name} does not accept audio.`
        );
        return;
      }
      const type: "image" | "audio" = isImage ? "image" : "audio";
      const reader = new FileReader();
      reader.onerror = () => {
        setError(`Failed to read file "${file.name}".`);
      };
      reader.onload = () => {
        const dataUrl = reader.result as string;
        if (dataUrl) {
          setAttachments((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              name: file.name,
              type,
              dataUrl,
            },
          ]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const handleEvent = (event: InferenceEvent) => {
    if (!mounted.current) return;
    switch (event.kind) {
      case "token":
        if (turnStart.current === null) turnStart.current = performance.now();
        setStreaming((prev) => (prev ? { ...prev, content: prev.content + event.text } : prev));
        break;
      case "reasoning":
        setStreaming((prev) => (prev ? { ...prev, reasoning: prev.reasoning + event.text } : prev));
        break;
      case "web_searching":
        setStreaming((prev) =>
          prev
            ? {
                ...prev,
                webSearchStatus: { stage: event.stage, queries: event.queries ?? [] },
              }
            : prev
        );
        break;
      case "web_search_results":
        setStreaming((prev) =>
          prev
            ? {
                ...prev,
                webSearchStatus: null,
                webSearch: {
                  queries: event.queries,
                  sources: event.sources,
                  warning: event.warning ?? null,
                },
              }
            : prev
        );
        break;
      case "usage":
        if (event.context_size) {
          setUsage({
            prompt_tokens: event.prompt_tokens,
            completion_tokens: event.completion_tokens,
            context_size: event.context_size,
          });
        }
        break;
      case "compacting":
        setNotice(t("chatCompacting"));
        break;
      case "compacted":
        setNotice(t("chatCompacted"));
        onLog?.(`[INFO] ${t("chatCompacted")} (${event.messages})`);
        break;
      case "continuing": {
        const msg = fmt(t("chatContinuingPart"), { part: event.part, max: event.max_parts });
        setStreaming((prev) => (prev ? { ...prev, continuingStatus: msg } : prev));
        onLog?.(`[INFO] ${msg}`);
        break;
      }
      case "log":
        onLog?.(event.message);
        break;
      case "error":
        setError(event.message);
        break;
      default:
        break;
    }
  };

  const buildTurnParams = () => ({
    ...chatParams(settings),
    ...(webSearch ? { web_search: true } : {}),
    ...(extendedMaxTokens ? { extended_max_tokens: true } : {}),
    ...(autoContinue ? { auto_continue: true } : {}),
  });

  const regenerate = async (edited: string | null) => {
    if (!conversation || isSending) return;
    const lastUser = [...conversation.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setIsSending(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const active = conversation;
    try {
      if (status !== "ready" && status !== "inferring") {
        setIsStarting(true);
        const running = await onEnsureRunning();
        if (mounted.current) setIsStarting(false);
        if (!running) return;
      }

      const cut = active.messages.lastIndexOf(lastUser);
      setConversation({ ...active, messages: active.messages.slice(0, cut) });
      turnStart.current = null;
      setStreaming({ user: edited ?? lastUser.content, content: "", reasoning: "", webSearchStatus: null, webSearch: null });
      onBusyChange?.(true);
      const updated = await apiChatRegenerate(model.id, active.id, edited, buildTurnParams(), {
        onEvent: handleEvent,
        signal: controller.signal,
      });
      if (!mounted.current) return;
      setConversation(updated);
      recordSpeed(updated);
      if (updated.usage) setUsage(updated.usage);
    } catch (err: unknown) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onLog?.(`[ERROR] ${message}`);
      if (edited !== null) {
        setDraft(edited);
        setEditingLast(true);
      }
      try {
        setConversation(await apiChatGet(active.id));
      } catch {
        setConversation(active);
      }
    } finally {
      if (mounted.current) {
        setStreaming(null);
        setIsSending(false);
        setIsStarting(false);
        void refreshList();
      }
      abortRef.current = null;
      onBusyChange?.(false);
    }
  };

  const exportMarkdown = async (target: "file" | "clipboard") => {
    if (!conversation) return;
    const markdown = conversationToMarkdown(conversation, model.name);
    try {
      if (target === "clipboard") {
        await navigator.clipboard.writeText(markdown);
        setNotice("Skopiowano rozmowę jako Markdown.");
      } else if (await saveTextFile(exportFileName(conversation), markdown, "md")) {
        setNotice("Zapisano rozmowę jako Markdown.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const lastUserMessage = conversation ? [...conversation.messages].reverse().find((m) => m.role === "user") : undefined;
  const lastIsMedia = Boolean(lastUserMessage?.content.trim().startsWith("[{"));

  const send = async () => {
    if (editingLast && conversation) {
      const edited = draft.trim();
      if (!edited || isSending) return;
      setEditingLast(false);
      setDraft("");
      await regenerate(edited);
      return;
    }
    const text = draft.trim();
    if ((!text && attachments.length === 0) || isSending) return;
    setIsSending(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let active = conversation;
    const createdFresh = !active;
    const prevMessageCount = active ? active.messages.length : 0;
    const prevDraft = draft;
    const prevAttachments = attachments;
    try {
      if (status !== "ready" && status !== "inferring") {
        setIsStarting(true);
        const running = await onEnsureRunning();
        if (mounted.current) setIsStarting(false);
        if (!running) return;
      }
      if (!active) {
        const prompt = typeof settings.system_prompt === "string" ? settings.system_prompt : null;
        active = await apiChatCreate(model.id, prompt);
        if (!mounted.current) return;
        setConversation(active);
      }

      let messageToSend = text;
      if (attachments.length > 0) {
        const parts: Array<Record<string, unknown>> = [];
        if (text) {
          parts.push({ type: "text", text });
        }
        for (const att of attachments) {
          if (att.type === "image") {
            parts.push({
              type: "image_url",
              image_url: { url: att.dataUrl },
            });
          } else if (att.type === "audio") {
            const { data, format } = parseAudioDataUrl(att.dataUrl);
            parts.push({
              type: "input_audio",
              input_audio: { data, format },
            });
          }
        }
        messageToSend = JSON.stringify(parts);
      }

      setDraft("");
      setAttachments([]);
      turnStart.current = null;
      setStreaming({ user: messageToSend, content: "", reasoning: "", webSearchStatus: null, webSearch: null });
      onBusyChange?.(true);
      const updated = await apiChatSend(model.id, active.id, messageToSend, buildTurnParams(), {
        onEvent: handleEvent,
        signal: controller.signal,
      });
      if (!mounted.current) return;
      setConversation(updated);
      recordSpeed(updated);
      if (updated.usage) setUsage(updated.usage);
    } catch (err: unknown) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onLog?.(`[ERROR] ${message}`);

      if (active) {
        try {
          const refreshed = await apiChatGet(active.id);
          if (!mounted.current) return;
          if (refreshed.messages.length <= prevMessageCount) {
            setDraft(prevDraft);
            setAttachments(prevAttachments);
          }
          if (createdFresh && refreshed.messages.length === 0) {
            await apiChatDelete(active.id).catch(() => undefined);
            if (!mounted.current) return;
            setConversations((prev) => prev.filter((c) => c.id !== active!.id));
            setConversation(null);
          } else {
            setConversation(refreshed);
          }
        } catch {
          if (createdFresh && prevMessageCount === 0) {
            setDraft(prevDraft);
            setAttachments(prevAttachments);
            await apiChatDelete(active.id).catch(() => undefined);
            if (!mounted.current) return;
            setConversations((prev) => prev.filter((c) => c.id !== active!.id));
            setConversation(null);
          }
        }
      }
    } finally {
      if (mounted.current) {
        setStreaming(null);
        setIsSending(false);
        setIsStarting(false);
        void refreshList();
      }
      abortRef.current = null;
      onBusyChange?.(false);
    }
  };

  const continueAnswer = async () => {
    if (!conversation || isSending) return;
    const last = conversation.messages.at(-1);
    if (!last || last.role !== "assistant") return;
    setIsSending(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const active = conversation;
    try {
      if (status !== "ready" && status !== "inferring") {
        setIsStarting(true);
        const running = await onEnsureRunning();
        if (mounted.current) setIsStarting(false);
        if (!running) return;
      }
      setStreaming({
        user: null,
        continuingMessageId: last.id,
        content: "",
        reasoning: "",
        webSearchStatus: null,
        webSearch: null,
      });
      onBusyChange?.(true);
      const updated = await apiChatContinue(model.id, active.id, buildTurnParams(), {
        onEvent: handleEvent,
        signal: controller.signal,
      });
      if (!mounted.current) return;
      setConversation(updated);
      recordSpeed(updated);
      if (updated.usage) setUsage(updated.usage);
    } catch (err: unknown) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onLog?.(`[ERROR] ${message}`);
      try {
        setConversation(await apiChatGet(active.id));
      } catch {
        // keep current thread view
      }
    } finally {
      if (mounted.current) {
        setStreaming(null);
        setIsSending(false);
        setIsStarting(false);
        void refreshList();
      }
      abortRef.current = null;
      onBusyChange?.(false);
    }
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    try {
      await apiChatDelete(id);
      if (conversation?.id === id) startNew();
      await refreshList();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const rename = async (id: string, title: string) => {
    setRenaming(null);
    if (!title.trim()) return;
    try {
      const info = await apiChatRename(id, title);
      setConversation((prev) => (prev && prev.id === id ? { ...prev, title: info.title } : prev));
      await refreshList();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const rawCtxParsed = ctxInput.trim() === "" ? Number.NaN : Number(ctxInput);
  const parsedCtx =
    Number.isInteger(rawCtxParsed) &&
    rawCtxParsed >= contextInfo.min_supported &&
    rawCtxParsed <= contextInfo.max_supported
      ? rawCtxParsed
      : null;
  const ctxPresets = useMemo(() => contextPresetValues(contextInfo), [contextInfo]);

  const ctxStops = useMemo(() => {
    const values = new Set<number>(ctxPresets);
    values.add(contextInfo.configured);
    return [...values]
      .sort((a, b) => a - b)
      .map((value) => ({ value, label: formatContextPreset(value) }));
  }, [ctxPresets, contextInfo.configured]);

  const applyContextWindow = async () => {
    if (parsedCtx === null || isSending || isUpdatingCtx) return;
    const shouldRestart = status === "ready";
    setIsUpdatingCtx(true);
    setError(null);
    setNotice(null);
    if (shouldRestart) onBusyChange?.(true);
    try {
      const updated = await apiSetModelContextWindow(model.id, parsedCtx, shouldRestart);
      if (!mounted.current) return;
      setContextInfo(updated);
      setCtxInput(String(updated.configured));
      lastCtxConfiguredRef.current = updated.configured;
      if (updated.active != null) {
        setUsage((prev) => (prev ? { ...prev, context_size: updated.active! } : prev));
      }
      const msg = updated.restart_required ? t("chatContextRestartNeeded") : t("chatContextUpdated");
      setNotice(msg);
      onLog?.(`[INFO] ${msg} (${updated.configured.toLocaleString("en-US")} tokens)`);
    } catch (err: unknown) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onLog?.(`[ERROR] ${message}`);
      try {
        const fresh = await apiGetModelContextWindow(model.id);
        if (mounted.current) setContextInfo(fresh);
      } catch {
        // Keep previous context info on transient lookup failure.
      }
    } finally {
      if (mounted.current) setIsUpdatingCtx(false);
      if (shouldRestart) onBusyChange?.(false);
    }
  };

  const applyContextRef = useRef(applyContextWindow);
  applyContextRef.current = applyContextWindow;
  useEffect(() => {
    if (!isLlamaCpp || parsedCtx === null || parsedCtx === contextInfo.configured || isSending || isUpdatingCtx) return;
    const timer = window.setTimeout(() => void applyContextRef.current(), 700);
    return () => window.clearTimeout(timer);
  }, [isLlamaCpp, parsedCtx, contextInfo.configured, isSending, isUpdatingCtx]);

  const meter = contextUse(usage);
  const summary = conversation?.summary ?? null;
  const covered = summary ? Math.min(summary.covers, conversation?.messages.length ?? 0) : 0;
  const labels = useMemo(
    () => ({
      you: t("chatYou"),
      model: model.name,
      thinking: t("chatThinking"),
      interrupted: t("chatInterrupted"),
      truncated: t("chatTruncated"),
      truncatedMaxTokens: t("chatTruncatedMaxTokens"),
      truncatedContext: t("chatTruncatedContext"),
      continueAction: t("chatContinue"),
      partBadge: t("chatPartBadge"),
      copyMessage: t("copy"),
      retry: t("chatRetry"),
      speed: t("chatSpeed"),
      copied: t("copied"),
      noAnswer: t("chatNoAnswer"),
      webSearchingPlanning: t("chatWebSearchingPlanning"),
      webSearchingQuery: t("chatWebSearchingQuery"),
      webSearchingReading: t("chatWebSearchingReading"),
      webSources: t("chatWebSources"),
      webSourceSingle: t("chatWebSourceSingle"),
      webSearchUnavailable: t("chatWebSearchUnavailable"),
      webQueries: t("chatWebQueries"),
      webPageRead: t("chatWebPageRead"),
    }),
    [t, model.name]
  );
  const messages = conversation?.messages ?? [];

  return (
    <div className="flex flex-1 overflow-hidden" data-testid="chat-workspace">
      {/* Conversations */}
      <section
        aria-label={t("chatConversations")}
        className="flex w-[248px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border pb-[18px] pl-6 pr-4 pt-6"
      >
        <button
          type="button"
          onClick={startNew}
          disabled={isSending}
          className="mb-3.5 h-11 shrink-0 cursor-pointer rounded-xl bg-foreground text-sm font-bold text-background transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50"
        >
          {t("chatNew")}
        </button>
        {conversations.length === 0 && (
          <p className="px-2.5 py-3 text-[13px] text-muted-foreground">{t("chatNoConversations")}</p>
        )}
        {groupConversations(conversations).map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            <div className="px-2.5 py-1.5 text-xs font-bold tracking-[.04em] text-muted-foreground">
              {t(group.label)}
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const selected = item.id === conversation?.id;
                const title = item.title || t("chatUntitled");
                return (
                  <li key={item.id} className="group relative">
                    {renaming === item.id ? (
                      <input
                        aria-label={t("chatRename")}
                        autoFocus
                        defaultValue={item.title}
                        className="h-10 w-full rounded-[10px] border border-input bg-card px-2.5 text-sm"
                        onBlur={(e) => void rename(item.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void rename(item.id, e.currentTarget.value);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        disabled={isSending}
                        onClick={() => void open(item.id)}
                        onDoubleClick={() => setRenaming(item.id)}
                        title={title}
                        className={cn(
                          "block w-full cursor-pointer truncate rounded-[10px] px-2.5 py-2.5 pr-14 text-left text-sm transition-colors disabled:cursor-default",
                          selected ? "bg-soft font-bold text-foreground" : "font-medium text-foreground hover:bg-secondary"
                        )}
                      >
                        {title}
                      </button>
                    )}
                    {renaming !== item.id && (
                      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label={`${t("chatRename")}: ${title}`}
                          title={t("chatRename")}
                          disabled={isSending}
                          onClick={() => setRenaming(item.id)}
                          className="h-6 w-6 cursor-pointer rounded text-[11px] text-muted-foreground hover:bg-card hover:text-foreground"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          aria-label={`${confirmDelete === item.id ? t("chatDeleteConfirm") : t("chatDelete")}: ${title}`}
                          title={t("chatDelete")}
                          disabled={isSending}
                          onClick={() => (confirmDelete === item.id ? void remove(item.id) : setConfirmDelete(item.id))}
                          onBlur={() => setConfirmDelete(null)}
                          className={cn(
                            "h-6 cursor-pointer rounded px-1.5 text-[11px]",
                            confirmDelete === item.id
                              ? "bg-destructive text-destructive-foreground"
                              : "text-muted-foreground hover:bg-card hover:text-destructive"
                          )}
                        >
                          {confirmDelete === item.id ? t("chatDeleteConfirm") : "✕"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {/* Thread */}
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="px-8">
          <header className="mx-auto flex w-full max-w-[clamp(720px,62%,1100px)] items-start gap-4 pb-3.5 pt-6">
            <div className="min-w-0 flex-1">
              {header ?? (
                <h2 className="truncate text-[34px] font-extrabold leading-[1.1] tracking-[-0.02em]">
                  {conversation?.title || model.ui.title || model.name}
                </h2>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {conversation && conversation.messages.length > 0 && !isSending && (
                <div ref={moreRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                    aria-label={t("chatMoreActions")}
                    onClick={() => setMoreOpen((v) => !v)}
                    className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
                  >
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </button>
                  {moreOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-popover py-1.5 shadow-pop"
                    >
                      {lastUserMessage && !lastIsMedia && (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex h-10 w-full cursor-pointer items-center px-4 text-left text-sm hover:bg-secondary"
                          onClick={() => {
                            setMoreOpen(false);
                            setEditingLast(true);
                            setDraft(lastUserMessage.content);
                            promptInputRef.current?.focus();
                          }}
                        >
                          ✎ {t("chatEditQuestion")}
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className="flex h-10 w-full cursor-pointer items-center px-4 text-left text-sm hover:bg-secondary"
                        onClick={() => {
                          setMoreOpen(false);
                          void regenerate(null);
                        }}
                      >
                        ↻ {t("chatRetry")}
                      </button>
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        role="menuitem"
                        className="flex h-10 w-full cursor-pointer items-center px-4 text-left text-sm hover:bg-secondary"
                        onClick={() => {
                          setMoreOpen(false);
                          void exportMarkdown("file");
                        }}
                      >
                        ⤓ {t("chatExportMd")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex h-10 w-full cursor-pointer items-center px-4 text-left text-sm hover:bg-secondary"
                        onClick={() => {
                          setMoreOpen(false);
                          void exportMarkdown("clipboard");
                        }}
                      >
                        {t("chatCopyConversation")}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={toggleParams}
                aria-pressed={paramsOpen}
                className={cn(
                  "flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold text-foreground",
                  paramsOpen && "bg-soft"
                )}
              >
                <SlidersIcon size={18} />
                {t("paramsToggle")}
              </button>
            </div>
          </header>
        </div>

        <div className="flex-1 overflow-y-auto px-8" role="log" aria-live="polite" aria-label={t("chatMessageLabel")}>
          <div className="mx-auto flex min-h-full w-full max-w-[clamp(720px,62%,1100px)] flex-col gap-7 pb-2 pt-3">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <p className="text-sm font-semibold text-foreground">{t("chatEmptyTitle")}</p>
              <p className="mt-1.5 max-w-md text-xs text-muted-foreground">{t("chatEmptyHint")}</p>
            </div>
          )}
          {messages.map((message, index) => {
            const isContinuingThis = streaming?.continuingMessageId === message.id;
            const sep =
              isContinuingThis &&
              streaming.content &&
              message.content &&
              !/\s$/.test(message.content) &&
              !/^[\s,.;:!?\])]/.test(streaming.content)
                ? " "
                : "";
            const displayMessage: ChatMessage = isContinuingThis
              ? {
                  ...message,
                  content: streaming.content ? `${message.content}${sep}${streaming.content}` : message.content,
                  reasoning: streaming.reasoning
                    ? [message.reasoning, streaming.reasoning].filter(Boolean).join("\n\n")
                    : message.reasoning,
                  truncated: false,
                }
              : message;
            const canContinue =
              index === messages.length - 1 &&
              message.role === "assistant" &&
              Boolean(message.truncated) &&
              !isSending;
            const isLastAnswer = index === messages.length - 1 && message.role === "assistant";
            return (
              <div key={message.id} className="space-y-7">
                {summary && index === covered && covered > 0 && (
                  <div className="rounded-md border border-dashed border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>↑ {t("chatSummaryMarker")}</span>
                      <button
                        type="button"
                        className="underline underline-offset-2 cursor-pointer hover:text-foreground"
                        aria-expanded={showSummary}
                        onClick={() => setShowSummary((v) => !v)}
                      >
                        {t("chatSummaryShow")}
                      </button>
                    </div>
                    {showSummary && <p className="mt-2 whitespace-pre-wrap text-foreground">{summary.text}</p>}
                    {summary.lossy && <p className="mt-1 text-amber-600 dark:text-amber-400">{t("chatSummaryLossy")}</p>}
                  </div>
                )}
                <MessageRow
                  message={displayMessage}
                  labels={labels}
                  isStreaming={isContinuingThis}
                  onContinue={canContinue ? () => void continueAnswer() : undefined}
                  onRetry={isLastAnswer && !isSending ? () => void regenerate(null) : undefined}
                  speed={speeds[message.id] ?? null}
                />
              </div>
            );
          })}
          {streaming && !streaming.continuingMessageId && (
            <>
              {streaming.user !== null && (
                <MessageRow
                  message={{ id: "pending-user", role: "user", content: streaming.user, created_at: 0 }}
                  labels={labels}
                  isStreaming={false}
                />
              )}
              {(streaming.content || streaming.reasoning || streaming.webSearchStatus || streaming.webSearch) && (
                <MessageRow
                  message={{
                    id: "pending-assistant",
                    role: "assistant",
                    content: streaming.content || (streaming.webSearchStatus ? "" : "…"),
                    reasoning: streaming.reasoning || null,
                    web_search: streaming.webSearch ?? null,
                    created_at: 0,
                  }}
                  labels={labels}
                  isStreaming={true}
                  webSearchStatus={streaming.webSearchStatus ?? null}
                />
              )}
            </>
          )}
          {isStarting && <p className="text-xs text-muted-foreground animate-pulse">{t("chatStarting")}</p>}
          {streaming?.continuingStatus && (
            <p role="status" className="text-xs text-muted-foreground animate-pulse">
              {streaming.continuingStatus}
            </p>
          )}
          {notice && (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <div ref={endRef} />
          </div>
        </div>

        {/* Attachment preview strip */}
        {attachments.length > 0 && (
          <div
            className="mx-auto flex w-full max-w-[clamp(720px,62%,1100px)] flex-wrap gap-2 px-1 pb-2"
            data-testid="attachments-preview"
          >
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative flex items-center gap-2 rounded-md border border-border bg-card p-1.5 pr-7 max-w-xs text-xs"
              >
                {att.type === "image" ? (
                  <img src={att.dataUrl} alt={att.name} className="h-10 w-10 object-cover rounded" />
                ) : (
                  <div className="h-10 w-10 flex items-center justify-center bg-secondary rounded text-base">
                    🎵
                  </div>
                )}
                <span className="truncate max-w-[120px] font-mono text-[11px]" title={att.name}>
                  {att.name}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${att.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-secondary text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="px-8 pb-5 pt-2">
          <form
            className="relative mx-auto w-full max-w-[clamp(720px,62%,1100px)] rounded-[22px] border border-border bg-card px-[18px] pb-3 pt-3.5 shadow-[0_6px_24px_-12px_rgba(22,24,11,.18)]"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {editingLast && (
              <div className="mb-2 flex items-center gap-2 text-[12px] text-warn">
                {t("chatEditingLast")}
                <button
                  type="button"
                  className="cursor-pointer underline"
                  onClick={() => {
                    setEditingLast(false);
                    setDraft("");
                  }}
                >
                  {t("chatEditingCancel")}
                </button>
              </div>
            )}
            <Textarea
              ref={promptInputRef}
              aria-label={t("chatMessageLabel")}
              value={draft}
              placeholder={t("chatPlaceholder")}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="max-h-[240px] min-h-[44px] w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-[1.6] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="mt-2.5 flex items-center gap-2">
              {canAttach && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    tabIndex={-1}
                    className="hidden"
                    accept={acceptTypes}
                    multiple
                    onChange={handleFileSelect}
                  />
                  <button
                    type="button"
                    aria-label="Attach media"
                    title={capabilities.vision && capabilities.audio ? "Attach an image or audio" : capabilities.vision ? "Attach an image" : "Attach audio"}
                    disabled={isSending}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-secondary hover:text-foreground disabled:cursor-default disabled:opacity-40"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                </>
              )}
              <button
                type="button"
                data-testid="web-search-toggle"
                aria-pressed={webSearch}
                aria-label={t("chatWebSearch")}
                title={t("chatWebSearchHint")}
                disabled={isSending}
                onClick={toggleWebSearch}
                className={cn(
                  "inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors disabled:cursor-default disabled:opacity-40",
                  webSearch
                    ? "border-transparent bg-soft text-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <GlobeIcon size={16} />
                <span>{t("chatWebSearch")}</span>
              </button>
              <div className="flex-1" />
              {meter && (
                <div
                  role="progressbar"
                  aria-label={t("chatContext")}
                  aria-valuemin={0}
                  aria-valuemax={meter.size}
                  aria-valuenow={meter.used}
                  aria-valuetext={`${formatTokens(meter.used, lang)} / ${formatTokens(meter.size, lang)}`}
                  className="flex items-center gap-2.5"
                >
                  <div className="h-1.5 w-[84px] overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full", meter.percent >= 90 ? "bg-destructive" : meter.percent >= 75 ? "bg-warn" : "bg-ink")}
                      style={{ width: `${meter.percent}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatTokens(meter.used, lang)} / {formatTokens(meter.size, lang)}
                  </span>
                </div>
              )}
              {isSending ? (
                <button
                  type="button"
                  aria-label={t("chatStop")}
                  title={t("chatStop")}
                  onClick={() => abortRef.current?.abort()}
                  className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="5" y="5" width="14" height="14" rx="2.5" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label={t("chatSend")}
                  title={t("chatSend")}
                  disabled={!draft.trim() && attachments.length === 0}
                  className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:cursor-default disabled:opacity-40"
                >
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              )}
            </div>
          </form>
        </div>
      </section>

      {/* Parameters: every control applies on its own */}
      {paramsOpen && (
        <ChatParamsPanel
          settingInputs={settingInputs}
          settings={settings}
          onSetting={(name, value) => setSettings((prev) => ({ ...prev, [name]: value }))}
          disabled={isSending}
          instructions={hasSystemPrompt ? instructions : null}
          isLlamaCpp={isLlamaCpp}
          contextInfo={contextInfo}
          ctxStops={ctxStops}
          ctxValue={parsedCtx ?? contextInfo.configured}
          onCtxChange={(value) => setCtxInput(String(value))}
          restarting={isUpdatingCtx && status === "ready"}
          ctxBusy={isUpdatingCtx}
          extendedMaxTokens={extendedMaxTokens}
          onExtendedMaxTokens={toggleExtendedMaxTokens}
          autoContinue={autoContinue}
          onAutoContinue={toggleAutoContinue}
          logs={logs}
          onOpenLogsFolder={() => void apiOpenLogsFolder().catch(() => {})}
        />
      )}
    </div>
  );
}
