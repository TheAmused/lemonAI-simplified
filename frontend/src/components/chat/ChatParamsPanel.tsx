import type { ReactNode } from "react";
import type { UIInputDefinition } from "@/types/manifest";
import type { ModelContextInfo } from "@/lib/ipc";
import { fmt, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info-tip";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { UseInstructions } from "@/lib/instructions";
import { InstructionPicker } from "./InstructionPicker";

export interface CtxStop {
  value: number;
  label: string;
}

export interface ChatParamsPanelProps {
  settingInputs: UIInputDefinition[];
  settings: Record<string, unknown>;
  onSetting: (name: string, value: unknown) => void;

  disabled: boolean;

  instructions: UseInstructions | null;
  isLlamaCpp: boolean;
  contextInfo: ModelContextInfo;
  ctxStops: CtxStop[];

  ctxValue: number;
  onCtxChange: (value: number) => void;

  restarting: boolean;
  ctxBusy: boolean;
  extendedMaxTokens: boolean;
  onExtendedMaxTokens: (next: boolean) => void;
  autoContinue: boolean;
  onAutoContinue: (next: boolean) => void;
  logs: string[];
  onOpenLogsFolder: () => void;
}

const CARD = "rounded-2xl border border-border bg-card px-4 pt-4";

function formatDecimal(value: number, lang: string): string {

  const text = (Math.round(value * 100) / 100).toFixed(2).replace(/0$/, "");
  return lang === "pl" ? text.replace(".", ",") : text;
}

function approxWords(tokens: number, lang: string): string {
  const words = tokens * 0.75;
  const rounded = words < 10000 ? Math.round(words / 500) * 500 : Math.round(words / 1000) * 1000;
  return rounded.toLocaleString(lang === "pl" ? "pl-PL" : "en-US");
}

function RangeRow({
  id,
  label,
  tip,
  readout,
  min,
  max,
  step,
  value,
  onChange,
  disabled,
  ends,
  footer,
}: {
  id: string;
  label: string;
  tip?: string;
  readout: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ends?: [ReactNode, ReactNode];
  footer?: ReactNode;
}) {
  return (
    <div className="pb-3.5">
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-bold">
          {label}
          {tip && <InfoTip text={tip} align="left" />}
        </label>
        <span className="font-mono text-[13px] font-semibold">{readout}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="block h-6 w-full cursor-pointer accent-[hsl(var(--line))] disabled:cursor-default disabled:opacity-50"
      />
      {ends && (
        <div className="mt-0.5 flex justify-between text-xs text-muted-foreground">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
      {footer}
    </div>
  );
}

function SwitchRow({
  id,
  icon,
  label,
  tip,
  checked,
  disabled,
  onChange,
  first,
  testId,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  tip?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  first?: boolean;
  testId?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 py-3", !first && "border-t border-border")}>
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-soft text-ink">
        {icon}
      </span>
      <span id={`${id}-label`} className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
        <span className="min-w-0">{label}</span>
        {tip && <InfoTip text={tip} align="center" />}
      </span>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-labelledby={`${id}-label`} data-testid={testId} />
    </div>
  );
}

const iconProps = {
  width: 19,
  height: 19,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const SparkleSvg = () => (
  <svg {...iconProps}>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);
const LinesSvg = () => (
  <svg {...iconProps}>
    <path d="M4 6h16 M4 12h16 M4 18h10" />
  </svg>
);
const ArrowSvg = () => (
  <svg {...iconProps}>
    <path d="M5 12h14 M13 6l6 6-6 6" />
  </svg>
);
const DotsSvg = () => (
  <svg {...iconProps}>
    <path d="M5 7h14 M5 12h14 M5 17h14" />
  </svg>
);

function PlainField({
  input,
  value,
  disabled,
  onChange,
}: {
  input: UIInputDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const id = `chat-setting-${input.name}`;
  const fieldClass =
    "h-10 w-full rounded-[10px] border border-input bg-background px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
  const header = (
    <div className="mb-2 flex items-center justify-between gap-2">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-bold">
        {input.label}
        {input.description && <InfoTip text={input.description} align="left" />}
      </label>
    </div>
  );
  switch (input.widget) {
    case "textarea":
      return (
        <div className="pb-3.5">
          {header}
          <Textarea
            id={id}
            value={typeof value === "string" ? value : ""}
            placeholder={input.placeholder ?? undefined}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-[84px] rounded-[10px] bg-background px-3 py-2 text-[13px]"
          />
        </div>
      );
    case "select":
      return (
        <div className="pb-3.5">
          {header}
          <select
            id={id}
            className={fieldClass}
            disabled={disabled}
            value={String(value ?? "")}
            onChange={(e) => {
              const picked = (input.options ?? []).find(
                (o) => String(typeof o === "string" ? o : o.value) === e.target.value
              );
              onChange(picked === undefined ? e.target.value : typeof picked === "string" ? picked : picked.value);
            }}
          >
            {(input.options ?? []).map((option) => {
              const optionValue = typeof option === "string" ? option : option.value;
              const optionLabel = typeof option === "string" ? option : option.label;
              return (
                <option key={String(optionValue)} value={String(optionValue)}>
                  {optionLabel}
                </option>
              );
            })}
          </select>
        </div>
      );
    case "number":
      return (
        <div className="pb-3.5">
          {header}
          <input
            id={id}
            type="number"
            className={cn(fieldClass, "font-mono")}
            min={input.min ?? undefined}
            max={input.max ?? undefined}
            step={input.step ?? undefined}
            disabled={disabled}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>
      );
    default:
      return (
        <div className="pb-3.5">
          {header}
          <input
            id={id}
            type="text"
            className={fieldClass}
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            placeholder={input.placeholder ?? undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}

export function ChatParamsPanel(props: ChatParamsPanelProps) {
  const { t, lang } = useI18n();
  const {
    settingInputs,
    settings,
    onSetting,
    disabled,
    instructions,
    isLlamaCpp,
    contextInfo,
    ctxStops,
    ctxValue,
    onCtxChange,
    restarting,
    ctxBusy,
    extendedMaxTokens,
    onExtendedMaxTokens,
    autoContinue,
    onAutoContinue,
    logs,
    onOpenLogsFolder,
  } = props;

  const inputs = settingInputs.filter((i) => i.name !== "system_prompt" && i.widget !== "switch");
  const switches = settingInputs.filter((i) => i.widget === "switch");
  const maxTokensInput = isLlamaCpp ? inputs.find((i) => i.name === "max_tokens") : undefined;
  const stopIndex = Math.max(0, ctxStops.findIndex((s) => s.value === ctxValue));
  const recommendedLabel = ctxStops.find((s) => s.value === contextInfo.recommended)?.label ?? String(contextInfo.recommended);

  const renderInput = (input: UIInputDefinition) => {
    const value = settings[input.name];
    if (input.name === "max_tokens" && maxTokensInput) {
      const standardCap = Math.max(
        input.max ?? 2048,
        Math.min(contextInfo.output_max_supported, Math.floor(contextInfo.configured / 2))
      );
      const effectiveMax = extendedMaxTokens ? contextInfo.output_max_supported : standardCap;
      const isAuto = value == null;
      const current = typeof value === "number" ? Math.min(effectiveMax, value) : effectiveMax;
      return (
        <RangeRow
          key={input.name}
          id="chat-setting-max_tokens"
          label={t("paramLength")}
          tip={t("paramLengthTip")}
          readout={
            isAuto && extendedMaxTokens ? t("paramLengthAuto") : fmt(t("paramLengthTokens"), { n: current.toLocaleString(lang === "pl" ? "pl-PL" : "en-US") })
          }
          min={Math.max(64, input.min ?? 64)}
          max={effectiveMax}
          step={64}
          value={current}
          disabled={disabled}
          onChange={(v) => onSetting(input.name, v)}
          ends={[
            Math.max(64, input.min ?? 64).toLocaleString(lang === "pl" ? "pl-PL" : "en-US"),
            effectiveMax.toLocaleString(lang === "pl" ? "pl-PL" : "en-US"),
          ]}
          footer={
            extendedMaxTokens ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSetting(input.name, null)}
                aria-pressed={isAuto}
                className={cn(
                  "mt-2 rounded-md border px-2 py-0.5 font-mono text-[11px] cursor-pointer",
                  isAuto ? "border-primary bg-primary/15 font-semibold" : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {t("paramLengthAuto")}
              </button>
            ) : undefined
          }
        />
      );
    }
    if (input.widget === "slider") {
      const isTemperature = input.name === "temperature";
      const numeric = typeof value === "number" ? value : (input.min ?? 0);
      return (
        <RangeRow
          key={input.name}
          id={`chat-setting-${input.name}`}
          label={isTemperature ? t("paramStyle") : input.label}
          tip={isTemperature ? t("paramStyleTip") : (input.description ?? undefined)}
          readout={isTemperature || !Number.isInteger(numeric) ? formatDecimal(numeric, lang) : numeric}
          min={input.min ?? 0}
          max={input.max ?? 1}
          step={input.step ?? 0.05}
          value={numeric}
          disabled={disabled}
          onChange={(v) => onSetting(input.name, v)}
          ends={isTemperature ? [t("paramStylePrecise"), t("paramStyleCreative")] : undefined}
        />
      );
    }
    return (
      <PlainField key={input.name} input={input} value={value} disabled={disabled} onChange={(v) => onSetting(input.name, v)} />
    );
  };

  return (
    <aside aria-label={t("paramsToggle")} className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-border">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-background px-6 pb-3 pt-[22px]">
        <h2 className="text-[22px] font-extrabold tracking-tight">{t("paramsTitle")}</h2>
        <span role="status" className="inline-flex items-center gap-[7px] text-[12.5px] text-muted-foreground">
          <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", restarting ? "bg-warn" : "bg-ok")} />
          {restarting ? t("paramsRestarting") : t("paramsSavedAuto")}
        </span>
      </div>

      <div className="flex flex-col gap-3.5 px-6 pb-6 pt-1">
        {instructions && <InstructionPicker instructions={instructions} disabled={disabled} />}

        {inputs.length > 0 && (
          <section aria-label={t("chatSettings")} className={CARD}>
            {inputs.map(renderInput)}
            {maxTokensInput && (
              <SwitchRow
                id="extended-max-tokens-toggle"
                testId="extended-max-tokens-toggle"
                icon={<LinesSvg />}
                label={t("paramExtendedLabel")}
                tip={fmt(t("paramExtendedTip"), { max: contextInfo.output_max_supported.toLocaleString("en-US") })}
                checked={extendedMaxTokens}
                disabled={disabled}
                onChange={onExtendedMaxTokens}
              />
            )}
          </section>
        )}

        {isLlamaCpp && (
          <section
            aria-label={t("paramMemory")}
            data-testid="chat-context-window-control"
            className={cn(CARD, "pb-4")}
          >
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="chat-context-window-input" className="flex items-center gap-2 text-sm font-bold">
                {t("paramMemory")}
                <InfoTip text={fmt(t("paramMemoryTip"), { rec: recommendedLabel })} align="left" />
              </label>
              <span className="font-mono text-[13px] font-semibold">{ctxStops[stopIndex]?.label}</span>
            </div>
            <input
              id="chat-context-window-input"
              data-testid="chat-context-window-input"
              type="range"
              min={0}
              max={Math.max(0, ctxStops.length - 1)}
              step={1}
              value={stopIndex}
              disabled={disabled || restarting || ctxBusy}
              aria-valuetext={ctxStops[stopIndex]?.label}
              onChange={(e) => {
                const stop = ctxStops[Number(e.target.value)];
                if (stop) onCtxChange(stop.value);
              }}
              className="block h-6 w-full cursor-pointer accent-[hsl(var(--line))] disabled:cursor-default disabled:opacity-50"
            />
            <div aria-hidden="true" className="mt-1 flex justify-between font-mono text-xs text-muted-foreground">
              {ctxStops.map((stop) => (
                <span
                  key={stop.value}
                  className={cn(
                    "min-w-[30px] text-center",
                    stop.value === contextInfo.recommended && "font-bold text-foreground"
                  )}
                >
                  {stop.label}
                  {stop.value === contextInfo.recommended && (
                    <span className="mt-[3px] block h-[3px] rounded-sm bg-primary" />
                  )}
                </span>
              ))}
            </div>
            <div className="mt-2.5 text-[13px] text-muted-foreground">
              {fmt(t("paramMemoryWords"), { n: approxWords(ctxValue, lang) })}
            </div>
            {restarting && (
              <div className="mt-3">
                <div
                  role="progressbar"
                  aria-label={t("paramsRestarting")}
                  className="relative h-1.5 overflow-hidden rounded-[3px] bg-secondary"
                >
                  <span className="absolute inset-y-0 w-2/5 animate-[lmslide_1.2s_ease-in-out_infinite] rounded-[3px] bg-ink" />
                </div>
                <div className="mt-2 text-[13px]">{t("paramMemoryRestarting")}</div>
              </div>
            )}
          </section>
        )}

        <section aria-label={t("paramsTitle")} className={cn(CARD, "pt-0")}>
          {switches.map((input, index) => {
            const isThinking = /think|reason/i.test(input.name);
            return (
              <SwitchRow
                key={input.name}
                id={`chat-setting-${input.name}`}
                icon={isThinking ? <SparkleSvg /> : <DotsSvg />}
                label={input.label}
                tip={input.description ?? (isThinking ? t("paramThinkingTip") : undefined)}
                checked={settings[input.name] === true}
                disabled={disabled}
                onChange={(next) => onSetting(input.name, next)}
                first={index === 0}
              />
            );
          })}
          <SwitchRow
            id="auto-continue-toggle"
            testId="auto-continue-toggle"
            icon={<ArrowSvg />}
            label={t("paramContinueLabel")}
            tip={t("paramContinueTip")}
            checked={autoContinue}
            disabled={disabled}
            onChange={onAutoContinue}
            first={switches.length === 0}
          />
        </section>

        <details className="px-1 text-xs">
          <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 text-[13px] font-semibold underline">
            <span>
              {t("chatLogs")} ({logs.length})
            </span>
            <button
              type="button"
              data-testid="open-logs-folder-chat"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenLogsFolder();
              }}
              className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground no-underline hover:bg-secondary hover:text-foreground cursor-pointer"
            >
              {t("openLogsFolder")}
            </button>
          </summary>
          <ul className="mt-2.5 space-y-1 font-mono text-xs leading-relaxed text-muted-foreground">
            {logs.slice(-40).map((line, i) => (
              <li key={i} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </aside>
  );
}
