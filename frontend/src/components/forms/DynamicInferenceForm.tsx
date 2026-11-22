import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isUploadedFile } from "@/types/manifest";
import type {
  UIInputDefinition,
  UISection,
  UIWidgetType,
  UIInputOption,
  UICondition,
  UIOptionValue,
  UIFormPreset,
  UploadedFile,
} from "@/types/manifest";

export type UIInput = UIInputDefinition;
export type { UISection, UIWidgetType, UIInputOption, UICondition, UIFormPreset };

export interface DynamicFormProps {
  schema: {
    title: string;
    description?: string;
    columns?: 1 | 2;
    sections?: UISection[];
    inputs?: UIInput[];
    presets?: UIFormPreset[];
  };
  onExecute?: (data: Record<string, unknown>, signal: AbortSignal) => Promise<void>;

  presetValues?: Record<string, unknown> | null;
  presetKey?: number;
  isExecuting?: boolean;

  submitLabel?: string;

  variant?: "card" | "panel" | "composer" | "form";

  inlineLabels?: boolean;

  mode?: "execute" | "preview";
}

export function isAspectRatioOptions(options: { value: unknown }[]): boolean {
  return options.length > 1 && options.length <= 8 && options.every((o) => /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(String(o.value)));
}

export function ratioFrame(value: string, max = 26): { width: number; height: number } {
  const [w, h] = value.split(":").map(Number);
  if (!w || !h) return { width: max, height: max };
  return w >= h ? { width: max, height: Math.max(8, Math.round((max * h) / w)) } : { width: Math.max(8, Math.round((max * w) / h)), height: max };
}

function orderForComposer(inputs: UIInput[]): UIInput[] {
  const rank = (i: UIInput) =>
    i.widget === "textarea" || i.widget === "text" ? 0 : i.widget === "select" ? 1 : i.widget === "slider" ? 2 : 3;
  return inputs
    .map((input, index) => ({ input, index }))
    .sort((a, b) => rank(a.input) - rank(b.input) || a.index - b.index)
    .map((x) => x.input);
}

function Wrap({ when, className, children }: { when: boolean; className?: string; children: React.ReactNode }) {
  return when ? <div className={className}>{children}</div> : <>{children}</>;
}

const QUALITY_SLIDERS = new Set(["steps", "num_inference_steps", "inference_steps", "sampling_steps"]);

export function evaluateCondition(
  condition: UICondition | undefined,
  values: Record<string, unknown>
): boolean {
  if (!condition) return true;
  const watchedValue = values?.[condition.field];
  if (condition.equals !== undefined && watchedValue !== condition.equals) {
    return false;
  }
  if (condition.not_equals !== undefined && watchedValue === condition.not_equals) {
    return false;
  }
  if (
    condition.in !== undefined &&
    (!Array.isArray(condition.in) || !condition.in.includes(watchedValue))
  ) {
    return false;
  }
  return true;
}

export function isInputRequired(input: UIInput): boolean {
  return (
    input.required === true ||
    ((input.widget === "file_upload" || input.widget === "select") &&
      input.required !== false)
  );
}

export function getSectionInputNames(section?: UISection | null): string[] {
  if (!section) return [];
  const names = new Set<string>();
  if (section.input_names) {
    section.input_names.forEach((n) => names.add(n));
  }
  if (section.inputs) {
    section.inputs.forEach((i) => names.add(i.name));
  }
  return Array.from(names);
}

function getGridColClass(gridCols?: 1 | 2 | 3, columns?: 1 | 2): string {
  if (columns === 1) return "col-span-1";
  if (gridCols === 1) return "col-span-1 md:col-span-2";
  if (gridCols === 2) return "col-span-1 md:col-span-4";
  if (gridCols === 3) return "col-span-1 md:col-span-6";
  return columns === 2 ? "col-span-1 md:col-span-3" : "col-span-1 md:col-span-6";
}

function normalizeOptions(
  options?: UIInputOption[]
): { label: string; value: UIOptionValue }[] {
  if (!options) return [];
  return options.map((opt) =>
    typeof opt === "string" ? { label: opt, value: opt } : opt
  );
}

interface JsonEditorFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function JsonEditorField({
  id,
  name,
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: JsonEditorFieldProps) {
  const [formatStatus, setFormatStatus] = useState<"valid" | "invalid" | null>(() => {
    if (!value || !value.trim()) return null;
    try {
      JSON.parse(value);
      return "valid";
    } catch {
      return "invalid";
    }
  });

  const checkValidity = (text: string) => {
    if (!text.trim()) {
      setFormatStatus(null);
      return;
    }
    try {
      JSON.parse(text);
      setFormatStatus("valid");
    } catch {
      setFormatStatus("invalid");
    }
  };

  const handlePrettify = () => {
    try {
      const parsed = JSON.parse(value || "{}");
      const prettified = JSON.stringify(parsed, null, 2);
      onChange(prettified);
      setFormatStatus("valid");
    } catch {
      setFormatStatus("invalid");
    }
  };

  return (
    <div className="flex flex-col space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {formatStatus === "valid" && (
            <span className="text-emerald-500 font-medium">Poprawny JSON</span>
          )}
          {formatStatus === "invalid" && (
            <span className="text-destructive font-medium">Błąd składni JSON</span>
          )}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2"
          disabled={disabled}
          onClick={handlePrettify}
        >
          Formatuj JSON
        </Button>
      </div>
      <Textarea
        id={id}
        name={name}
        rows={4}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          checkValidity(e.target.value);
        }}
        placeholder={placeholder ?? "{\n  \"key\": \"value\"\n}"}
        aria-label={label}
        className="font-mono text-xs"
      />
    </div>
  );
}

interface TagsInputFieldProps {
  id: string;
  name: string;
  label: string;
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

function TagsInputField({
  id,
  name,
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: TagsInputFieldProps) {
  const [inputVal, setInputVal] = useState("");
  const tags = Array.isArray(value) ? value : [];

  const handleAdd = () => {
    const trimmed = inputVal.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
      setInputVal("");
    }
  };

  const handleRemove = (tagToRemove: string) => {
    onChange(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="flex flex-col space-y-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid={`${id}-tags-list`}>
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              <span>{tag}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => handleRemove(tag)}
                aria-label={`Usuń ${tag}`}
                className="text-[10px] font-medium text-muted-foreground hover:text-foreground focus:outline-none"
              >
                Usuń
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center space-x-2">
        <input
          id={id}
          name={name}
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Wpisz tag i kliknij Dodaj..."}
          aria-label={label}
          disabled={disabled}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !inputVal.trim()}
          onClick={handleAdd}
        >
          Dodaj
        </Button>
      </div>
    </div>
  );
}

export const MAX_SEED = 2147483647;
const DIM_MIN = 256;
const DIM_MAX = 2048;
const DIM_STEP = 64;

interface DimensionPreset {
  label: string;
  ratio: string;
  width: number;
  height: number;
  value: string;
}

const DEFAULT_DIMENSION_PRESETS: readonly DimensionPreset[] = [
  { label: "1024×1024 (1:1)", ratio: "1:1", width: 1024, height: 1024, value: "1024x1024" },
  { label: "896×1152 (3:4)", ratio: "3:4", width: 896, height: 1152, value: "896x1152" },
  { label: "1152×896 (4:3)", ratio: "4:3", width: 1152, height: 896, value: "1152x896" },
  { label: "768×1344 (9:16)", ratio: "9:16", width: 768, height: 1344, value: "768x1344" },
  { label: "1344×768 (16:9)", ratio: "16:9", width: 1344, height: 768, value: "1344x768" },
];

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function snapDimension(
  value: number,
  min = DIM_MIN,
  max = DIM_MAX,
  step = DIM_STEP
): number {
  if (!Number.isFinite(value)) return 1024;
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = Math.round(clamped / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export function parseDimensions(value: unknown): { width: number; height: number } {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (match) {
      return { width: Number(match[1]), height: Number(match[2]) };
    }
  } else if (typeof value === "object" && value !== null) {
    const obj = value as { width?: unknown; height?: unknown };
    const w = Number(obj.width);
    const h = Number(obj.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h };
    }
  }
  return { width: 1024, height: 1024 };
}

function resolveDimensionPresets(
  options?: { label: string; value: UIOptionValue }[]
): DimensionPreset[] {
  if (!options || options.length === 0) {
    return [...DEFAULT_DIMENSION_PRESETS];
  }
  const parsed: DimensionPreset[] = [];
  for (const opt of options) {
    const rawVal = String(opt.value);
    const match = rawVal.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const d = gcd(width, height);
    const ratio = `${width / d}:${height / d}`;
    const value = `${width}x${height}`;
    parsed.push({
      label: opt.label === rawVal ? `${width}×${height} (${ratio})` : opt.label,
      ratio,
      width,
      height,
      value,
    });
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_DIMENSION_PRESETS];
}

export function isQuickChipActive(text: string, chip: string): boolean {
  const target = chip.trim();
  if (!target || !text.trim()) return false;
  return text
    .split(",")
    .map((part) => part.trim())
    .includes(target);
}

export function toggleQuickChip(text: string, chip: string): string {
  const target = chip.trim();
  if (!target) return text;
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.includes(target)) {
    return parts.filter((part) => part !== target).join(", ");
  }
  return [...parts, target].join(", ");
}

export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

function inferMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) {
    return ext === "jpg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`;
  }
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(ext)) {
    return ext === "mp3" ? "audio/mpeg" : `audio/${ext}`;
  }
  if (["mp4", "webm", "mov", "mkv"].includes(ext)) {
    return ext === "mov" ? "video/quicktime" : `video/${ext}`;
  }
  return "application/octet-stream";
}

interface QuickChipsBarProps {
  chips: string[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

function QuickChipsBar({ chips, value, onChange, disabled }: QuickChipsBarProps) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {chips.map((chip) => {
        const active = isQuickChipActive(value, chip);
        return (
          <button
            key={chip}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(toggleQuickChip(value, chip))}
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
              active
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground hover:border-foreground/30"
            )}
          >
            {chip}
          </button>
        );
      })}
    </div>
  );
}

interface SeedFieldProps {
  id: string;
  name: string;
  label: string;
  value: unknown;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  onChange: (val: number | string) => void;
  onBlur: () => void;

  compact?: boolean;

  tall?: boolean;
}

function SeedField({
  id,
  name,
  label,
  value,
  min = -1,
  max = MAX_SEED,
  placeholder,
  disabled,
  onChange,
  onBlur,
  compact = false,
  tall = false,
}: SeedFieldProps) {
  const numericVal =
    value === "" || value === null || value === undefined ? null : Number(value);
  const isRandom = numericVal === null || Number.isNaN(numericVal) || numericVal === -1;
  const lastLockedRef = useRef<number | null>(
    !isRandom && numericVal !== null && numericVal >= 0 ? numericVal : null
  );

  useEffect(() => {
    if (!isRandom && numericVal !== null && numericVal >= 0) {
      lastLockedRef.current = numericVal;
    }
  }, [isRandom, numericVal]);

  const generateRandomSeed = () => {
    const upper = Math.min(max, MAX_SEED);
    const lower = Math.max(0, min);
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
  };

  const handleRandomize = () => {
    const next = generateRandomSeed();
    lastLockedRef.current = next;
    onChange(next);
  };

  const handleToggleLock = () => {
    if (isRandom) {
      const next = lastLockedRef.current ?? generateRandomSeed();
      lastLockedRef.current = next;
      onChange(next);
    } else {
      onChange(-1);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        name={name}
        type="number"
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        value={value !== undefined && value !== null ? (value as number | string) : ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder ?? "-1 (losowy)"}
        aria-label={label}
        className={cn(
          "flex font-mono rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "h-11 w-24 rounded-[10px]" : tall ? "h-[46px] w-full rounded-xl" : "h-9 w-full"
        )}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={handleRandomize}
        aria-label={`Losuj ziarno (${label})`}
        title="Losuj ziarno"
        className={cn("shrink-0 gap-1.5", compact ? "h-11 w-11 rounded-[10px] px-0" : tall ? "h-[46px] w-[46px] rounded-xl px-0" : "h-9 px-2.5")}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="18" height="18" x="3" y="3" rx="3" />
          <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
          <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
          <circle cx="8.5" cy="15.5" r="1" fill="currentColor" />
          <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
        </svg>
        {!compact && !tall && <span className="text-xs">Losuj</span>}
      </Button>
      {!compact && !tall && <Button
        type="button"
        variant={isRandom ? "secondary" : "outline"}
        size="sm"
        disabled={disabled}
        aria-pressed={isRandom}
        aria-label={isRandom ? `Zablokuj ziarno (${label})` : `Losowy (-1) (${label})`}
        title={isRandom ? "Ziarno losowe (-1) — kliknij aby zablokować" : "Ziarno zablokowane — kliknij aby ustawić losowe (-1)"}
        onClick={handleToggleLock}
        className={cn(
          "h-9 px-2.5 shrink-0 text-xs font-mono",
          isRandom && "border border-primary/50"
        )}
      >
        {isRandom ? "Losowy (-1)" : "Zablokuj"}
      </Button>}
    </div>
  );
}

interface DimensionsFieldProps {
  id: string;
  label: string;
  value: unknown;
  options?: { label: string; value: UIOptionValue }[];
  disabled?: boolean;
  onChange: (val: string) => void;
}

function DimensionsField({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: DimensionsFieldProps) {
  const presets = useMemo(() => resolveDimensionPresets(options), [options]);
  const { width, height } = parseDimensions(value);
  const currentStr = `${width}x${height}`;

  const handleWidthChange = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const snapped = snapDimension(parsed);
    onChange(`${snapped}x${height}`);
  };

  const handleHeightChange = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const snapped = snapDimension(parsed);
    onChange(`${width}x${snapped}`);
  };

  const handleSwap = () => {
    onChange(`${height}x${width}`);
  };

  return (
    <div className="space-y-3">
      <div
        id={id}
        role="radiogroup"
        aria-label={label}
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${Math.min(presets.length, 5)}, minmax(0, 1fr))`,
        }}
      >
        {presets.map((preset) => {
          const selected = currentStr === preset.value;
          const frame = ratioFrame(preset.ratio, 22);
          return (
            <button
              key={preset.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.label}
              disabled={disabled}
              onClick={() => onChange(preset.value)}
              className={cn(
                "rounded-xl border-2 px-2 py-2.5 flex flex-col items-center justify-center gap-1.5 text-xs font-bold cursor-pointer transition-colors disabled:opacity-50",
                selected
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              <span
                aria-hidden="true"
                className="rounded-[3px] border-2 border-current"
                style={{ width: frame.width, height: frame.height }}
              />
              <span className="font-mono text-[11px] leading-tight">
                {preset.width}×{preset.height}
              </span>
              <span className="text-[10px] font-normal opacity-80">
                ({preset.ratio})
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label
            htmlFor={`${id}-width`}
            className="text-xs text-muted-foreground font-medium"
          >
            Szerokość (px)
          </label>
          <input
            id={`${id}-width`}
            type="number"
            min={DIM_MIN}
            max={DIM_MAX}
            step={DIM_STEP}
            disabled={disabled}
            value={width}
            onChange={(e) => handleWidthChange(e.target.value)}
            aria-label={`${label} szerokość`}
            className="flex h-9 w-full font-mono rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={handleSwap}
          aria-label={`Zamień szerokość z wysokością (${label})`}
          title="Zamień W↔H"
          className="h-9 px-2.5 shrink-0 font-mono text-xs"
        >
          W↔H
        </Button>
        <div className="flex-1 space-y-1">
          <label
            htmlFor={`${id}-height`}
            className="text-xs text-muted-foreground font-medium"
          >
            Wysokość (px)
          </label>
          <input
            id={`${id}-height`}
            type="number"
            min={DIM_MIN}
            max={DIM_MAX}
            step={DIM_STEP}
            disabled={disabled}
            value={height}
            onChange={(e) => handleHeightChange(e.target.value)}
            aria-label={`${label} wysokość`}
            className="flex h-9 w-full font-mono rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}

const MESSAGES = {
  required: "Pole jest wymagane",
  select: "Wymagany wybór opcji",
  file: "Wymagany plik wejściowy",
  checkbox: "Wymagany co najmniej jeden wybór",
  tags: "Wymagany co najmniej jeden tag",
  json: "Niepoprawny format JSON",
  number: "Wartość musi być liczbą",
} as const;

export const MAX_UPLOAD_BYTES = 48 * 1024 * 1024;

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function requiredMessage(widget: UIWidgetType): string {
  switch (widget) {
    case "select":
    case "radio_group":
      return MESSAGES.select;
    case "file_upload":
      return MESSAGES.file;
    case "checkbox_group":
      return MESSAGES.checkbox;
    case "tags_input":
      return MESSAGES.tags;
    default:
      return MESSAGES.required;
  }
}

function isValidJsonText(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return true;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function toNumberOrUndefined(value: unknown): unknown {
  if (value === "" || value === null) return undefined;
  if (typeof value === "string") return Number(value.trim());
  return value;
}

function numberSchema(input: UIInputDefinition, required: boolean): z.ZodTypeAny {
  let n = z.number({
    required_error: MESSAGES.required,
    invalid_type_error: MESSAGES.number,
  });
  if (input.min !== undefined) {
    n = n.min(input.min, `Wartość musi być większa lub równa ${input.min}`);
  }
  if (input.max !== undefined) {
    n = n.max(input.max, `Wartość musi być mniejsza lub równa ${input.max}`);
  }
  return z.preprocess(toNumberOrUndefined, required ? n : n.optional());
}

function seedSchema(input: UIInputDefinition, required: boolean): z.ZodTypeAny {
  const min = input.min ?? -1;
  const max = input.max ?? MAX_SEED;
  const n = z
    .number({
      required_error: MESSAGES.required,
      invalid_type_error: MESSAGES.number,
    })
    .int("Ziarno musi być liczbą całkowitą")
    .min(min, `Wartość musi być większa lub równa ${min}`)
    .max(max, `Wartość musi być mniejsza lub równa ${max}`);
  return z.preprocess(toNumberOrUndefined, required ? n : n.optional());
}

const DIMENSIONS_REGEX = /^\d+x\d+$/i;

function fieldSchema(input: UIInputDefinition): z.ZodTypeAny {

  if (input.depends_on) return z.unknown();

  const required = isInputRequired(input);
  switch (input.widget) {
    case "slider":

      return numberSchema(input, input.required !== false);
    case "number":

      return numberSchema(input, required);
    case "seed":
      return seedSchema(input, required);
    case "dimensions": {
      const base = required
        ? z.string().min(1, MESSAGES.required)
        : z.string().optional().or(z.literal(""));
      return base.refine(
        (v) => !v || DIMENSIONS_REGEX.test(v),
        "Wymiary muszą mieć format SZEROKOŚĆxWYSOKOŚĆ (np. 1024x1024)"
      );
    }
    case "switch":
      return z.boolean();
    case "select":
    case "radio_group":
      return required
        ? z.custom<UIOptionValue>((v) => !isEmptyValue(v), MESSAGES.select)
        : z.unknown();
    case "file_upload":
      return z.custom<UploadedFile | "" | null | undefined>(
        (v) => (required ? isUploadedFile(v) && v.base64.length > 0 : isEmptyValue(v) || isUploadedFile(v)),
        MESSAGES.file
      );
    case "checkbox_group":
      return required
        ? z.array(z.union([z.string(), z.number(), z.boolean()])).min(1, MESSAGES.checkbox)
        : z.array(z.union([z.string(), z.number(), z.boolean()])).optional();
    case "tags_input":
      return required
        ? z.array(z.string()).min(1, MESSAGES.tags)
        : z.array(z.string()).optional();
    case "json_editor": {
      const base = required
        ? z.string().min(1, MESSAGES.required)
        : z.string().optional().or(z.literal(""));
      return base.refine(isValidJsonText, MESSAGES.json);
    }
    case "color_picker":
      return required
        ? z.string().min(1, MESSAGES.required)
        : z.string().optional().or(z.literal(""));
    case "textarea":
    case "text":
    default:
      return required
        ? z.string().min(1, MESSAGES.required)
        : z.string().optional().or(z.literal(""));
  }
}

export function visibleInputNames(
  inputs: UIInputDefinition[],
  values: Record<string, unknown>
): Set<string> {
  const byName = new Map(inputs.map((i) => [i.name, i]));
  const cache = new Map<string, boolean>();
  const visit = (name: string, trail: Set<string>): boolean => {
    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    const input = byName.get(name);
    let visible = true;
    if (input?.depends_on) {
      const dep = input.depends_on.field;
      const parentVisible = !byName.has(dep) || trail.has(dep) ? true : visit(dep, new Set(trail).add(name));
      visible = parentVisible && evaluateCondition(input.depends_on, values);
    }
    cache.set(name, visible);
    return visible;
  };
  return new Set(inputs.filter((i) => visit(i.name, new Set())).map((i) => i.name));
}

export function buildFormSchema(inputs: UIInputDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const input of inputs) shape[input.name] = fieldSchema(input);

  return z.object(shape).superRefine((data, ctx) => {
    const values = data as Record<string, unknown>;
    const visible = visibleInputNames(inputs, values);
    for (const input of inputs) {
      if (!input.depends_on || !visible.has(input.name)) continue;
      const val = values[input.name];
      const issue = (message: string, extra: object = {}) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [input.name], ...extra });

      if (isInputRequired(input) && (isEmptyValue(val) || (input.widget === "file_upload" && !isUploadedFile(val)))) {
        issue(requiredMessage(input.widget));
        continue;
      }
      if (input.widget === "json_editor" && !isValidJsonText(val)) {
        issue(MESSAGES.json);
      }
      if ((input.widget === "number" || input.widget === "slider") && !isEmptyValue(val)) {
        const num = Number(val);
        if (Number.isNaN(num)) {
          issue(MESSAGES.number);
        } else {
          if (input.min !== undefined && num < input.min) {
            issue(`Wartość musi być większa lub równa ${input.min}`);
          }
          if (input.max !== undefined && num > input.max) {
            issue(`Wartość musi być mniejsza lub równa ${input.max}`);
          }
        }
      }
      if (input.widget === "seed" && !isEmptyValue(val)) {
        const num = Number(val);
        const min = input.min ?? -1;
        const max = input.max ?? MAX_SEED;
        if (Number.isNaN(num)) {
          issue(MESSAGES.number);
        } else if (!Number.isInteger(num)) {
          issue("Ziarno musi być liczbą całkowitą");
        } else {
          if (num < min) {
            issue(`Wartość musi być większa lub równa ${min}`);
          }
          if (num > max) {
            issue(`Wartość musi być mniejsza lub równa ${max}`);
          }
        }
      }
      if (
        input.widget === "dimensions" &&
        !isEmptyValue(val) &&
        (typeof val !== "string" || !DIMENSIONS_REGEX.test(val))
      ) {
        issue("Wymiary muszą mieć format SZEROKOŚĆxWYSOKOŚĆ (np. 1024x1024)");
      }
    }
  });
}

export async function readUploadedFile(file: File): Promise<UploadedFile> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Plik jest za duży (${(file.size / 1024 / 1024).toFixed(1)} MB, maksymalnie ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`
    );
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Nie udało się odczytać pliku"));
    reader.readAsDataURL(file);
  });
  return { name: file.name, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), size: file.size };
}

export function buildPayload(
  inputs: UIInputDefinition[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const visible = visibleInputNames(inputs, values);
  const payload: Record<string, unknown> = {};
  for (const input of inputs) {
    if (!visible.has(input.name) || !(input.name in values)) continue;
    let value = values[input.name];
    if (input.widget === "number" || input.widget === "slider" || input.widget === "seed") {
      value = toNumberOrUndefined(value);
      if (value === undefined) continue;
    }
    payload[input.name] = value;
  }
  return payload;
}

export function DynamicInferenceForm({
  schema,
  onExecute,
  isExecuting,
  submitLabel,
  variant = "card",
  inlineLabels = false,
  mode = "execute",
  presetValues = null,
  presetKey = 0,
}: DynamicFormProps) {
  const { t } = useI18n();
  const [internalRunning, setInternalRunning] = useState(false);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [filePreviews, setFilePreviews] = useState<
    Record<string, { mimeType: string; dataUrl: string }>
  >({});
  const [draggingFields, setDraggingFields] = useState<Record<string, boolean>>({});
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [showPreviewPayload, setShowPreviewPayload] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isRunning = Boolean(isExecuting) || internalRunning;

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const allInputs = useMemo(() => {
    const collected: UIInput[] = [];
    const seenNames = new Set<string>();

    const addInput = (input: UIInput) => {
      if (!seenNames.has(input.name)) {
        seenNames.add(input.name);
        collected.push(input);
      }
    };

    if (schema.inputs) {
      schema.inputs.forEach(addInput);
    }
    if (schema.sections) {
      schema.sections.forEach((sec) => {
        sec.inputs?.forEach(addInput);
      });
    }
    return collected;
  }, [schema.inputs, schema.sections]);

  const [activeSectionId, setActiveSectionId] = useState<string>(
    schema.sections?.find((s) => s.default_open)?.id ?? schema.sections?.[0]?.id ?? ""
  );

  useEffect(() => {
    if (schema.sections && schema.sections.length > 0) {
      if (!schema.sections.some((s) => s.id === activeSectionId)) {
        setActiveSectionId(
          schema.sections.find((s) => s.default_open)?.id ?? schema.sections[0]?.id ?? ""
        );
      }
    } else {
      setActiveSectionId("");
    }
  }, [schema.sections, activeSectionId]);

  const dynamicZodSchema = useMemo(() => buildFormSchema(allInputs), [allInputs]);

  const defaultValues = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    allInputs.forEach((input) => {
      if (input.default !== undefined) {
        defaults[input.name] = input.default;
      } else {
        switch (input.widget) {
          case "switch":
            defaults[input.name] = false;
            break;
          case "slider":
            defaults[input.name] = input.min ?? 0;
            break;
          case "number":

            defaults[input.name] = input.required === false ? "" : input.min ?? 0;
            break;
          case "seed":
            defaults[input.name] = -1;
            break;
          case "dimensions":
            defaults[input.name] = "1024x1024";
            break;
          case "checkbox_group":
          case "tags_input":
            defaults[input.name] = [];
            break;
          case "color_picker":
            defaults[input.name] = "#000000";
            break;
          case "json_editor":
            defaults[input.name] = "{}";
            break;
          case "select":
          case "radio_group":
          case "file_upload":
          case "textarea":
          case "text":
          default:
            defaults[input.name] = "";
            break;
        }
      }
    });
    return defaults;
  }, [allInputs]);

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<Record<string, unknown>>({
    resolver: zodResolver(dynamicZodSchema),
    defaultValues,
  });

  const appliedPreset = useRef(0);
  useEffect(() => {
    if (!presetValues || presetKey === 0 || appliedPreset.current === presetKey) return;
    appliedPreset.current = presetKey;
    const known = new Set(allInputs.map((i) => i.name));
    for (const [key, value] of Object.entries(presetValues)) {
      if (known.has(key) && value !== undefined && value !== null) {
        setValue(key, value, { shouldDirty: true, shouldValidate: true });
      }
    }
  }, [presetValues, presetKey, allInputs, setValue]);

  const watchedValues = useWatch({ control }) as Record<string, unknown> | undefined;
  const formValues = watchedValues ?? defaultValues;

  const visibleSet = useMemo(
    () => visibleInputNames(allInputs, formValues),
    [allInputs, formValues]
  );

  useEffect(() => {
    setFileErrors((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [key, msg] of Object.entries(prev)) {
        if (msg && visibleSet.has(key)) {
          next[key] = msg;
        } else if (msg) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleSet]);

  const currentSection = useMemo(() => {
    if (schema.sections && schema.sections.length > 0) {
      return (
        schema.sections.find((s) => s.id === activeSectionId) ??
        schema.sections[0] ??
        null
      );
    }
    return null;
  }, [schema.sections, activeSectionId]);

  const visibleInputs = useMemo(() => {
    if (currentSection) {
      const sectionInputNames = getSectionInputNames(currentSection);
      return allInputs.filter((input) =>
        sectionInputNames.includes(input.name)
      );
    }
    return allInputs;
  }, [allInputs, currentSection]);

  const composer = variant === "composer";
  const stageForm = variant === "form";
  const promptName = composer
    ? visibleInputs.find((i) => i.widget === "textarea" || i.widget === "text")?.name
    : undefined;

  const handleApplyPreset = (preset: UIFormPreset) => {
    Object.entries(preset.values).forEach(([key, val]) => {
      setValue(key, val, { shouldDirty: true, shouldValidate: true });
    });
    setActivePresetId(preset.id);
  };

  const handleResetDefaults = () => {
    reset(defaultValues);
    setActivePresetId(null);
    setFileErrors({});
    setFilePreviews({});
  };

  const onSubmit = async (values: Record<string, unknown>) => {
    const activeVisible = visibleInputNames(allInputs, values);
    if (Object.entries(fileErrors).some(([name, msg]) => Boolean(msg) && activeVisible.has(name))) {
      return;
    }
    const payload = buildPayload(allInputs, values);
    if (mode === "preview") {
      setShowPreviewPayload(true);
      return;
    }
    if (!onExecute) return;
    setInternalRunning(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      await onExecute(payload, controller.signal);
    } catch (err: unknown) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      console.error("Inference execution failed:", err);
    } finally {
      setInternalRunning(false);
      abortControllerRef.current = null;
    }
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  useEffect(() => {
    if (!composer || !isRunning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"], [aria-modal="true"]')) {
        return;
      }
      abortControllerRef.current?.abort();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composer, isRunning]);

  const runLabel = isRunning
    ? t("processing")
    : mode === "preview"
      ? submitLabel ?? "Podgląd JSON"
      : submitLabel ?? t("runModel");
  const mainButton = isRunning ? (
    <button
      type="button"
      onClick={handleAbort}
      aria-label={t("cancelRun")}
      className="flex h-[52px] cursor-pointer items-center gap-3 rounded-2xl border-2 border-foreground bg-transparent px-[30px] text-base font-extrabold text-foreground"
    >
      {t("cancelRun")}
      {composer && <span className="text-xs font-semibold opacity-70">Esc</span>}
    </button>
  ) : (
    <button
      type="submit"
      aria-label={runLabel}
      className="flex h-[52px] cursor-pointer items-center gap-3 rounded-2xl bg-primary px-[30px] text-base font-extrabold text-primary-foreground"
    >
      {runLabel}
      {composer && <span className="text-xs font-semibold opacity-70">Ctrl + Enter</span>}
    </button>
  );

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      aria-label={schema.title}
      className={cn(
        "w-full",
        variant === "card"
          ? "space-y-5 max-w-4xl p-5 bg-card rounded-2xl border border-border"
          : composer
            ? "flex flex-col gap-3 rounded-[22px] border border-border bg-card px-5 pb-3.5 pt-3 shadow-sm"
            : stageForm
              ? "flex flex-col gap-[18px]"
              : "space-y-6"
      )}
    >
      {variant === "card" ? (
        <div className="pb-2 border-b border-border/60 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight text-foreground font-display">
            {schema.title}
          </h2>
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isRunning}
              onClick={handleResetDefaults}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Reset defaults
            </Button>
          )}
        </div>
      ) : (
        <div className={cn("flex items-center justify-between", composer && "contents")}>
          <h2 className="sr-only">{schema.title}</h2>
          {isDirty && !composer && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isRunning}
              onClick={handleResetDefaults}
              className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Reset defaults
            </Button>
          )}
        </div>
      )}

      {schema.presets && schema.presets.length > 0 && !stageForm && (
        <div
          role="group"
          aria-label="Presety parametrów"
          className="flex flex-wrap items-center gap-1.5"
        >
          {schema.presets.map((preset) => {
            const isActive = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={isActive}
                title={preset.description}
                disabled={isRunning}
                onClick={() => handleApplyPreset(preset)}
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                  isActive
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground hover:border-foreground/30"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      <Wrap when={stageForm} className="flex items-start gap-7">
      <Wrap when={stageForm} className="min-w-0 flex-1 space-y-5 rounded-[26px] border border-border bg-card px-8 pb-8 pt-7">
      {schema.sections && schema.sections.length > 0 && (
        <div className="flex flex-col space-y-2 border-b border-border pb-3">
          <div
            role="tablist"
            aria-label="Sekcje parametrów"
            className="flex space-x-2 border-b border-border/50 overflow-x-auto"
          >
            {schema.sections.map((section) => {
              const isActive = (currentSection?.id ?? "") === section.id;
              const hasErrors = getSectionInputNames(section).some(
                (name) => errors[name] !== undefined
              );
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`section-${section.id}`}
                  id={`tab-${section.id}`}
                  onClick={() => setActiveSectionId(section.id)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5",
                    isActive
                      ? "border-primary text-ink"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span>{section.title}</span>
                  {hasErrors && (
                    <span className="h-2 w-2 rounded-full bg-destructive inline-block" />
                  )}
                </button>
              );
            })}
          </div>
          {currentSection?.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {currentSection.description}
            </p>
          )}
        </div>
      )}

      <div
        role={currentSection ? "tabpanel" : undefined}
        id={currentSection ? `section-${currentSection.id}` : undefined}
        aria-labelledby={currentSection ? `tab-${currentSection.id}` : undefined}
        className={cn(
          composer
            ? cn("flex flex-wrap gap-x-6 gap-y-3", inlineLabels ? "items-center" : "items-end")
            : stageForm
              ? "grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-6"
              : variant === "panel"
                ? "grid gap-6 grid-cols-1"
                : "grid gap-4",
          !composer && !stageForm && (variant === "panel" || schema.columns === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-6")
        )}
      >
        {(composer ? orderForComposer(visibleInputs) : visibleInputs).map((input) => {
          if (!visibleSet.has(input.name)) return null;

          const colClass = composer
            ? input.name === promptName
              ? "basis-full"
              : ""
            : variant === "panel"
              ? "col-span-1"
              : getGridColClass(input.grid_cols, schema.columns);
          const normalizedOpts = normalizeOptions(input.options);
          const isPrompt = composer && input.name === promptName;
          const isRatio = input.widget === "select" && isAspectRatioOptions(normalizedOpts);
          const quality = QUALITY_SLIDERS.has(input.name) && input.widget === "slider";

          const isSeedNumber = (composer || stageForm) && input.name === "seed" && input.widget === "number";
          const labelText =
            quality && composer
              ? t("studioQuality")
              : isSeedNumber && /^seed$/i.test(input.label)
                ? "Ziarno"
                : input.label;

          return (
            <div
              key={input.name}
              className={cn(
                "flex",
                composer && inlineLabels && !isPrompt ? "flex-row items-center gap-3" : "flex-col",
                composer ? "gap-1" : "space-y-2",
                colClass
              )}
            >
              <label
                htmlFor={input.name}
                id={`${input.name}-label`}
                className={cn(
                  composer
                    ? isPrompt || isRatio
                      ? "sr-only"
                      : inlineLabels
                        ? "text-[13px] font-semibold text-foreground"
                        : "text-[12.5px] font-bold text-foreground"
                    : stageForm
                      ? "text-[13px] font-bold text-foreground"
                      : "text-sm font-medium text-foreground"
                )}
              >
                {labelText}
                {isInputRequired(input) && !composer && <span className="text-destructive ml-1">*</span>}
              </label>

              <Controller
                name={input.name}
                control={control}
                render={({ field }) => {
                  switch (isSeedNumber ? "seed" : input.widget) {
                    case "textarea": {
                      const textVal = (field.value as string) ?? "";
                      const tokenCount = estimateTokenCount(textVal);
                      return (
                        <div className="space-y-1.5">
                          <Textarea
                            id={input.name}
                            {...field}
                            rows={composer ? 2 : 3}
                            className={composer ? "resize-none border-0 bg-transparent px-0 py-1 text-base leading-6 shadow-none focus-visible:ring-0" : undefined}
                            disabled={isRunning}
                            value={textVal}
                            placeholder={input.placeholder}
                            aria-label={input.label}
                            onKeyDown={(e) => {
                              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !isRunning) {
                                e.preventDefault();
                                void handleSubmit(onSubmit)();
                              }
                            }}
                          />
                          {tokenCount > 0 && !composer && (
                            <div className="flex justify-end">
                              <span
                                className="text-[11px] font-mono text-muted-foreground"
                                data-testid={`${input.name}-token-count`}
                              >
                                ~{tokenCount} tok
                              </span>
                            </div>
                          )}
                          {input.quick_chips && input.quick_chips.length > 0 && (
                            <QuickChipsBar
                              chips={input.quick_chips}
                              value={textVal}
                              onChange={field.onChange}
                              disabled={isRunning}
                            />
                          )}
                        </div>
                      );
                    }

                    case "slider": {
                      const min = input.min ?? 0;
                      const max = input.max ?? 100;
                      const step = input.step ?? 1;
                      const currentVal =
                        field.value !== undefined && field.value !== null && field.value !== ""
                          ? Number(field.value)
                          : min;
                      const safeNumericVal = Number.isNaN(currentVal) ? min : currentVal;
                      const defaultNumeric =
                        input.default !== undefined ? Number(input.default) : undefined;
                      const showReset =
                        defaultNumeric !== undefined &&
                        !Number.isNaN(defaultNumeric) &&
                        safeNumericVal !== defaultNumeric;
                      if (composer) {
                        return (
                          <div className="flex items-center gap-3">
                            {quality && <span className="text-xs text-muted-foreground">{t("studioQualityFast")}</span>}
                            <div className="w-[150px]">
                              <Slider
                                id={input.name}
                                name={input.name}
                                value={[safeNumericVal]}
                                min={min}
                                max={max}
                                step={step}
                                onValueChange={(val) => field.onChange(val[0])}
                                disabled={isRunning}
                                aria-label={input.label}
                              />
                            </div>
                            {quality ? (
                              <span className="text-xs text-muted-foreground">{t("studioQualityExact")}</span>
                            ) : (
                              <span className="w-8 font-mono text-xs text-muted-foreground" data-testid={`${input.name}-value`}>
                                {safeNumericVal}
                                {input.unit ? ` ${input.unit}` : ""}
                              </span>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div className="flex items-center gap-2.5">
                          <Slider
                            id={input.name}
                            name={input.name}
                            value={[safeNumericVal]}
                            min={min}
                            max={max}
                            step={step}
                            onValueChange={(val) => field.onChange(val[0])}
                            disabled={isRunning}
                            aria-label={input.label}
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min={min}
                              max={max}
                              step={step}
                              disabled={isRunning}
                              value={
                                field.value !== undefined && field.value !== null
                                  ? (field.value as number | string)
                                  : min
                              }
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === "") return;
                                const parsed = Number(raw);
                                if (!Number.isNaN(parsed)) {
                                  field.onChange(parsed);
                                }
                              }}
                              onBlur={field.onBlur}
                              aria-label={`${input.label} (wartość)`}
                              className="h-8 w-20 rounded-md border border-input bg-background px-2 py-1 text-right font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            {input.unit && (
                              <span className="text-xs font-mono text-muted-foreground">
                                {input.unit}
                              </span>
                            )}
                            {showReset && (
                              <button
                                type="button"
                                disabled={isRunning}
                                onClick={() => field.onChange(input.default)}
                                aria-label={`Resetuj ${input.label}`}
                                className="ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors cursor-pointer disabled:opacity-50"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    case "switch":
                      return (
                        <Switch
                          id={input.name}
                          name={input.name}
                          checked={Boolean(field.value)}
                          onCheckedChange={field.onChange}
                          disabled={isRunning}
                          aria-label={input.label}
                        />
                      );

                    case "select":
                      if (isAspectRatioOptions(normalizedOpts)) {
                        return (
                          <div
                            id={input.name}
                            role="radiogroup"
                            aria-label={input.label}
                            className={composer ? "flex items-center gap-1" : "grid gap-2"}
                            style={
                              composer
                                ? undefined
                                : { gridTemplateColumns: `repeat(${Math.min(normalizedOpts.length, 5)}, minmax(0, 1fr))` }
                            }
                          >
                            {normalizedOpts.map((opt) => {
                              const on = String(field.value) === String(opt.value);
                              const frame = ratioFrame(String(opt.value), composer ? 22 : 26);
                              return (
                                <button
                                  key={String(opt.value)}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  aria-label={opt.label}
                                  disabled={isRunning}
                                  onClick={() => field.onChange(opt.value)}
                                  className={cn(
                                    "flex flex-col items-center justify-center font-bold cursor-pointer transition-colors disabled:opacity-50",
                                    composer
                                      ? cn(
                                          "h-12 w-12 gap-1 rounded-xl text-[11px]",
                                          on ? "bg-primary/25 text-ink" : "text-muted-foreground hover:text-foreground"
                                        )
                                      : cn(
                                          "h-[68px] rounded-xl border-2 gap-2 text-xs",
                                          on
                                            ? "border-primary bg-primary/15 text-foreground"
                                            : "border-border bg-card text-muted-foreground hover:text-foreground"
                                        )
                                  )}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="rounded-[3px] border-2 border-current"
                                    style={{ width: frame.width, height: frame.height }}
                                  />
                                  {String(opt.value)}
                                </button>
                              );
                            })}
                          </div>
                        );
                      }
                      return (
                        <Select
                          id={input.name}
                          name={input.name}
                          value={
                            field.value !== undefined && field.value !== null
                              ? String(field.value)
                              : ""
                          }
                          onValueChange={(picked: string) =>
                            field.onChange(
                              normalizedOpts.find((o) => String(o.value) === picked)?.value ?? picked
                            )
                          }
                          disabled={isRunning}
                          aria-label={input.label}
                        >
                          <SelectTrigger className={composer ? "h-11 min-w-[170px] rounded-[10px] bg-background" : stageForm ? "h-[46px] rounded-xl" : undefined}>
                            <SelectValue
                              placeholder={input.placeholder ?? "Wybierz opcję..."}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {normalizedOpts.map((opt) => (
                              <SelectItem
                                key={String(opt.value)}
                                value={String(opt.value)}
                              >
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );

                    case "file_upload": {
                      const picked = isUploadedFile(field.value) ? field.value : null;
                      const preview = filePreviews[input.name];
                      const isDragging = Boolean(draggingFields[input.name]);
                      const handlePickedFile = async (file: File) => {
                        try {
                          const uploaded = await readUploadedFile(file);
                          field.onChange(uploaded);
                          const mimeType = inferMimeType(file);
                          setFilePreviews((prev) => ({
                            ...prev,
                            [input.name]: {
                              mimeType,
                              dataUrl: `data:${mimeType};base64,${uploaded.base64}`,
                            },
                          }));
                          setFileErrors((prev) => ({ ...prev, [input.name]: "" }));
                        } catch (err) {
                          field.onChange("");
                          setFilePreviews((prev) => {
                            const next = { ...prev };
                            delete next[input.name];
                            return next;
                          });
                          setFileErrors((prev) => ({
                            ...prev,
                            [input.name]: err instanceof Error ? err.message : String(err),
                          }));
                        }
                      };
                      const clearPickedFile = () => {
                        field.onChange("");
                        setFileErrors((prev) => ({ ...prev, [input.name]: "" }));
                        setFilePreviews((prev) => {
                          const next = { ...prev };
                          delete next[input.name];
                          return next;
                        });
                      };
                      const isImagePreview =
                        picked && preview && preview.dataUrl.startsWith("data:image/");
                      const isAudioPreview =
                        picked && preview && preview.dataUrl.startsWith("data:audio/");
                      const isVideoPreview =
                        picked && preview && preview.dataUrl.startsWith("data:video/");

                      return (
                        <div className="space-y-2">
                          <div
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (!isRunning && !isDragging) {
                                setDraggingFields((prev) => ({ ...prev, [input.name]: true }));
                              }
                            }}
                            onDragLeave={(e) => {
                              e.preventDefault();
                              setDraggingFields((prev) => ({ ...prev, [input.name]: false }));
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDraggingFields((prev) => ({ ...prev, [input.name]: false }));
                              if (isRunning) return;
                              const file = e.dataTransfer?.files?.[0];
                              if (file) {
                                void handlePickedFile(file);
                              }
                            }}
                            data-dragging={isDragging ? "true" : "false"}
                            className={cn(
                              "rounded-lg border border-dashed p-2 transition-colors",
                              isDragging
                                ? "border-primary bg-primary/10 ring-1 ring-primary"
                                : "border-border/80 bg-background/50"
                            )}
                          >
                            <div className="flex items-center space-x-2">
                              <div
                                id={input.name}
                                role="status"
                                aria-label={input.label}
                                className="flex min-h-9 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                              >
                                {picked ? (
                                  <span className="truncate font-mono text-xs" title={picked.name}>
                                    {picked.name}
                                    <span className="ml-2 text-muted-foreground">
                                      ({(picked.size / 1024).toFixed(0)} KB)
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground text-xs">
                                    {isDragging
                                      ? "Upuść plik tutaj..."
                                      : input.placeholder ?? "Nie wybrano pliku (lub upuść tutaj)"}
                                  </span>
                                )}
                              </div>
                              <div className="relative flex items-center space-x-1">
                                <input
                                  type="file"
                                  name={input.name}
                                  className="hidden"
                                  accept={input.accept}
                                  disabled={isRunning}
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = "";
                                    if (!file) return;
                                    await handlePickedFile(file);
                                  }}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={isRunning}
                                  onClick={(e) => {
                                    const target =
                                      e.currentTarget.parentElement?.querySelector(
                                        'input[type="file"]'
                                      ) as HTMLInputElement | null;
                                    target?.click();
                                  }}
                                >
                                  Plik
                                </Button>
                                {picked && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={isRunning}
                                    aria-label={`Usuń plik ${picked.name}`}
                                    onClick={clearPickedFile}
                                  >
                                    Usuń
                                  </Button>
                                )}
                              </div>
                            </div>

                            {isImagePreview && (
                              <div className="mt-2 flex items-center gap-3 rounded-md border border-border/60 bg-card/60 p-2">
                                <img
                                  src={preview.dataUrl}
                                  alt={picked.name}
                                  className="h-14 w-14 rounded object-cover border border-border shrink-0"
                                />
                                <div className="min-w-0 text-xs">
                                  <p className="truncate font-mono font-medium text-foreground">
                                    {picked.name}
                                  </p>
                                  <p className="text-muted-foreground">
                                    {(picked.size / 1024).toFixed(1)} KB
                                  </p>
                                </div>
                              </div>
                            )}

                            {isAudioPreview && (
                              <div className="mt-2">
                                <audio
                                  controls
                                  src={preview.dataUrl}
                                  aria-label={`Podgląd audio ${picked.name}`}
                                  className="w-full h-9"
                                />
                              </div>
                            )}

                            {isVideoPreview && (
                              <div className="mt-2">
                                <video
                                  controls
                                  src={preview.dataUrl}
                                  aria-label={`Podgląd wideo ${picked.name}`}
                                  className="max-h-48 w-full rounded-md border border-border bg-black"
                                />
                              </div>
                            )}
                          </div>

                          {fileErrors[input.name] && (
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-destructive">
                                {fileErrors[input.name]}
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  setFileErrors((prev) => ({ ...prev, [input.name]: "" }))
                                }
                                aria-label={`Wyczyść błąd pliku ${input.label}`}
                                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }

                    case "number":
                      return (
                        <input
                          id={input.name}
                          name={input.name}
                          type="number"
                          min={input.min}
                          max={input.max}
                          step={input.step ?? "any"}
                          className={cn(
                            "flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                            composer ? "h-11 w-24 rounded-[10px] font-mono" : stageForm ? "h-[46px] rounded-xl font-mono" : "h-9"
                          )}
                          disabled={isRunning}
                          value={
                            field.value !== undefined && field.value !== null
                              ? (field.value as number | string)
                              : ""
                          }
                          onChange={(e) => field.onChange(e.target.value)}
                          onBlur={field.onBlur}
                          placeholder={input.placeholder}
                          aria-label={input.label}
                        />
                      );

                    case "color_picker":
                      return (
                        <div className="flex items-center space-x-2">
                          <input
                            type="color"
                            value={
                              typeof field.value === "string" &&
                              /^#[0-9A-Fa-f]{6}$/.test(field.value)
                                ? field.value
                                : "#000000"
                            }
                            disabled={isRunning}
                            onChange={(e) => field.onChange(e.target.value)}
                            className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`${input.label} Picker`}
                          />
                          <input
                            id={input.name}
                            name={input.name}
                            type="text"
                            value={(field.value as string) ?? "#000000"}
                            disabled={isRunning}
                            onChange={(e) => field.onChange(e.target.value)}
                            onBlur={field.onBlur}
                            placeholder="#000000"
                            aria-label={input.label}
                            className="flex h-9 w-full font-mono rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                      );

                    case "radio_group":
                      return (
                        <div
                          id={input.name}
                          role="radiogroup"
                          aria-labelledby={`${input.name}-label`}
                          aria-label={input.label}
                          className="flex flex-wrap gap-4 pt-1"
                        >
                          {normalizedOpts.map((opt) => {
                            const optVal = String(opt.value);
                            const isChecked = String(field.value ?? "") === optVal;
                            return (
                              <label
                                key={optVal}
                                className="flex items-center space-x-2 text-sm font-medium text-foreground cursor-pointer select-none"
                              >
                                <input
                                  type="radio"
                                  name={input.name}
                                  value={optVal}
                                  checked={isChecked}
                                  disabled={isRunning}
                                  onChange={() => field.onChange(opt.value)}
                                  aria-label={opt.label}
                                  className="h-4 w-4 text-ink border-input focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
                                />
                                <span>{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      );

                    case "checkbox_group": {
                      const selectedVals = Array.isArray(field.value)
                        ? (field.value as UIOptionValue[])
                        : [];
                      return (
                        <div
                          id={input.name}
                          role="group"
                          aria-labelledby={`${input.name}-label`}
                          aria-label={input.label}
                          className="flex flex-wrap gap-4 pt-1"
                        >
                          {normalizedOpts.map((opt) => {
                            const optVal = String(opt.value);
                            const isChecked = selectedVals.some((v) => String(v) === optVal);
                            return (
                              <label
                                key={optVal}
                                className="flex items-center space-x-2 text-sm font-medium text-foreground cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  name={`${input.name}[]`}
                                  value={optVal}
                                  checked={isChecked}
                                  disabled={isRunning}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      field.onChange([...selectedVals, opt.value]);
                                    } else {
                                      field.onChange(
                                        selectedVals.filter((v) => String(v) !== optVal)
                                      );
                                    }
                                  }}
                                  aria-label={opt.label}
                                  className="h-4 w-4 rounded text-ink border-input focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
                                />
                                <span>{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    }

                    case "json_editor":
                      return (
                        <JsonEditorField
                          id={input.name}
                          name={input.name}
                          label={input.label}
                          value={(field.value as string) ?? "{}"}
                          onChange={field.onChange}
                          disabled={isRunning}
                          placeholder={input.placeholder}
                        />
                      );

                    case "tags_input":
                      return (
                        <TagsInputField
                          id={input.name}
                          name={input.name}
                          label={input.label}
                          value={
                            Array.isArray(field.value)
                              ? (field.value as string[])
                              : []
                          }
                          onChange={field.onChange}
                          disabled={isRunning}
                          placeholder={input.placeholder}
                        />
                      );

                    case "seed":
                      return (
                        <SeedField
                          id={input.name}
                          name={input.name}
                          label={input.label}
                          value={field.value}
                          min={input.min}
                          max={input.max}
                          placeholder={input.placeholder}
                          disabled={isRunning}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          compact={composer}
                          tall={stageForm}
                        />
                      );

                    case "dimensions":
                      return (
                        <DimensionsField
                          id={input.name}
                          label={input.label}
                          value={field.value}
                          options={normalizedOpts.length > 0 ? normalizedOpts : undefined}
                          disabled={isRunning}
                          onChange={field.onChange}
                        />
                      );

                    case "text":
                    default: {
                      const textVal = (field.value as string) ?? "";
                      return (
                        <div className="space-y-1.5">
                          <input
                            id={input.name}
                            name={input.name}
                            type="text"
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isRunning}
                            value={textVal}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            placeholder={input.placeholder}
                            aria-label={input.label}
                          />
                          {input.quick_chips && input.quick_chips.length > 0 && (
                            <QuickChipsBar
                              chips={input.quick_chips}
                              value={textVal}
                              onChange={field.onChange}
                              disabled={isRunning}
                            />
                          )}
                        </div>
                      );
                    }
                  }
                }}
              />

              {errors[input.name] && (
                <span className="text-xs font-medium text-destructive">
                  {String(errors[input.name]?.message || "Nieprawidłowa wartość")}
                </span>
              )}
            </div>
          );
        })}
        {composer && <div className="ml-auto">{mainButton}</div>}
      </div>
      </Wrap>
      {stageForm && schema.presets && schema.presets.length > 0 && (
        <aside aria-label={t("presetsHeading")} className="sticky top-0 flex w-[220px] shrink-0 flex-col gap-2 self-start">
          <h2 className="mb-1 text-[13px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
            {t("presetsHeading")}
          </h2>
          {schema.presets.map((preset) => {
            const isActive = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={isActive}
                title={preset.description}
                disabled={isRunning}
                onClick={() => handleApplyPreset(preset)}
                className={cn(
                  "h-11 cursor-pointer rounded-xl px-3.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
                  isActive
                    ? "border-2 border-ink bg-primary/20 font-bold text-ink"
                    : "border border-border bg-transparent font-semibold text-foreground hover:border-foreground/40"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </aside>
      )}
      </Wrap>

      {stageForm && (
        <div className="flex items-center justify-end gap-4">
          <span className="text-[13px] text-muted-foreground">
            <span className="text-destructive">*</span> {t("fieldsRequired")}
          </span>
          {mainButton}
        </div>
      )}

      {!composer && !stageForm && (
      <div className={cn("space-y-3", variant === "card" && "pt-3 border-t border-border/60")}>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            size="lg"
            disabled={isRunning}
            className="flex-1 text-base font-extrabold"
          >
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground animate-ping" />
                <span>{t("processing")}</span>
              </span>
            ) : mode === "preview" ? (
              submitLabel ?? "Podgląd JSON"
            ) : (
              submitLabel ?? t("runModel")
            )}
          </Button>
          {mode === "preview" && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              aria-expanded={showPreviewPayload}
              onClick={() => setShowPreviewPayload((prev) => !prev)}
              className="px-4 text-sm font-mono"
            >
              Inspect Payload JSON
            </Button>
          )}
          {isRunning && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleAbort}
              size="lg"
              className="px-5"
            >
              {t("stopModel")}
            </Button>
          )}
        </div>

        {mode === "preview" && showPreviewPayload && (
          <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono font-medium">Payload JSON</span>
              <button
                type="button"
                onClick={() => setShowPreviewPayload(false)}
                className="text-xs hover:text-foreground cursor-pointer"
              >
                Zwiń
              </button>
            </div>
            <pre
              data-testid="preview-payload-json"
              className="max-h-64 overflow-auto rounded-md bg-background p-2.5 font-mono text-xs text-foreground border border-border/60"
            >
              {JSON.stringify(buildPayload(allInputs, formValues), null, 2)}
            </pre>
          </div>
        )}
      </div>
      )}
    </form>
  );
}
