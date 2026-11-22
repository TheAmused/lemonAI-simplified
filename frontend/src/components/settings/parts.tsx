import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

export function SettingsSection({
  id,
  title,
  tip,
  hint,
  children,
  className,
}: {
  id: string;
  title: string;
  tip?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("flex scroll-mt-8 flex-col gap-[18px] border-t border-border py-7", className)}
    >
      <div>
        <h2 id={`${id}-title`} className="flex items-center gap-2.5 text-lg font-extrabold">
          {title}
          {tip && <InfoTip text={tip} align="left" />}
        </h2>
        {hint && <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export { fieldLabel, fieldInput, fieldSelect, outlineButton, primaryButton, linkButton } from "@/components/ui/form-styles";
import { fieldLabel } from "@/components/ui/form-styles";

export function Field({
  label,
  htmlFor,
  tip,
  help,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  tip?: string;
  help?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className={cn(fieldLabel, "flex items-center gap-2")}>
        {label}
        {tip && <InfoTip text={tip} align="left" />}
      </label>
      {children}
      {help && <div className="text-[13px] text-muted-foreground">{help}</div>}
    </div>
  );
}

export function SwitchRow({
  checked,
  onChange,
  title,
  description,
  tip,
  large,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description?: string;
  tip?: string;
  large?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <div className={cn("flex items-center gap-2.5", large ? "text-lg font-extrabold" : "text-[15px] font-bold")}>
          {title}
          {tip && <InfoTip text={tip} align="left" />}
        </div>
        {description && <div className="mt-1 text-[13px] text-muted-foreground">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 cursor-pointer rounded-full border-0 transition-colors",
          checked ? "bg-ink" : "bg-border"
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-card shadow transition-[left]",
            checked ? "left-[23px]" : "left-[3px]"
          )}
        />
      </button>
    </div>
  );
}
