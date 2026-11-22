import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Page({
  children,
  width = "wide",
  className,
}: {
  children: ReactNode;

  width?: "wide" | "narrow" | number;
  className?: string;
}) {
  const max = width === "wide" ? 1180 : width === "narrow" ? 1060 : width;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div

        style={{ maxWidth: `clamp(${max}px, ${Math.round(max / 18)}vw, ${Math.round(max * 1.55)}px)` }}
        className={cn("mx-auto flex w-full flex-col gap-[34px] px-12 pb-10 pt-8", className)}
      >
        {children}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  before,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;

  before?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      {before}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em]">{title}</h1>
          {description && <p className="mt-2 max-w-[560px] text-sm leading-normal text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;

  count?: number;
}

export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  trailing,
  idPrefix,
  accent = false,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;

  trailing?: ReactNode;

  idPrefix?: string;

  accent?: boolean;
}) {
  return (
    <div className="sticky top-0 z-[3] flex flex-wrap items-end gap-x-7 gap-y-2 border-b border-border bg-background pt-2">
      <div role="tablist" aria-label={label} className="flex flex-1 flex-wrap gap-7">
        {tabs.map((tab) => {
          const on = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={on}
              id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
              aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
              onClick={() => onChange(tab.id)}
              className={cn(
                "-mb-px cursor-pointer whitespace-nowrap border-b-[3px] text-base",
                accent ? "inline-flex h-12 items-center gap-2" : "pb-3",
                on
                  ? cn("font-extrabold text-foreground", accent ? "border-primary" : "border-ink")
                  : "border-transparent font-medium text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.count ? (
                accent ? (
                  <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-extrabold text-primary-foreground">
                    {tab.count}
                  </span>
                ) : (
                  <span className="ml-1.5 text-ink font-bold">{tab.count}</span>
                )
              ) : null}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}

export function LineSearch({
  value,
  onChange,
  placeholder,
  label,
  icon,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative h-11 w-[260px] border-b-2 border-border focus-within:border-foreground", className)}>
      {icon && <span className="absolute left-0 top-3 text-muted-foreground">{icon}</span>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          "h-[42px] w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground",
          icon && "pl-7"
        )}
      />
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
  onClose,
  closeLabel = "Zamknij",
}: {
  tone?: "info" | "ok" | "error";
  children: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-4 text-sm pl-4 border-l-[3px] py-1",
        tone === "error" ? "border-destructive text-destructive" : tone === "ok" ? "border-ok" : "border-line"
      )}
    >
      <div className="flex-1 min-w-0 whitespace-pre-wrap break-words">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 font-semibold hover:underline cursor-pointer">
          {closeLabel}
        </button>
      )}
    </div>
  );
}

export function Section({
  id,
  title,
  hint,
  label,
  actions,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;

  label?: string;

  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      {...(label ? { "aria-label": label } : { "aria-labelledby": id })}
      className="flex flex-wrap gap-x-10 gap-y-4 py-7 border-t border-border first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="basis-56 grow max-w-64">
        <h2 id={id} className="text-[15px] font-bold">
          {title}
        </h2>
        {hint && <div className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{hint}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="basis-96 grow-[999] min-w-0 flex flex-col gap-3 text-sm">{children}</div>
    </section>
  );
}

export function ProgressLine({
  percent,
  message,
  label,
}: {
  percent: number | null;
  message: ReactNode;
  label: string;
}) {
  return (
    <div
      className="relative h-10 px-3 rounded-xl bg-secondary text-xs flex items-center min-w-0 overflow-hidden"
      {...(percent !== null
        ? { role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent }
        : {})}
    >
      {percent !== null && (
        <div aria-hidden="true" className="absolute inset-y-0 left-0 bg-primary/60 transition-[width] duration-300" style={{ width: `${percent}%` }} />
      )}
      <span className="relative truncate font-medium">{message}</span>
    </div>
  );
}
