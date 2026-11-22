import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DialogField({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-bold">{label}</span>
        {children}
      </label>
      {hint && <span className="mt-1.5 block text-[12.5px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function DialogNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 text-[14.5px] leading-[1.55] text-muted-foreground", className)}>{children}</p>;
}

export function DialogError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 rounded-xl border-l-4 border-destructive bg-background px-4 py-3 text-sm">
      {children}
    </p>
  );
}

export function DialogStatus({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="m-0 rounded-xl border-l-4 border-ok bg-background px-4 py-3 text-sm">
      {children}
    </p>
  );
}

export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-3 pt-2", className)}>{children}</div>;
}

export function DialogFooter({ left, children }: { left?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
      <div>{left}</div>
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

export function FileDrop({
  accept,
  file,
  onFile,
  hint,
  disabled,
  ariaLabel,
}: {
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
  hint: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (disabled) return;
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
      }}
      className={cn(
        "flex min-h-[56px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border px-4 py-3.5 text-center text-sm text-muted-foreground transition-colors hover:border-line hover:bg-secondary/40",
        file && "border-solid border-line text-foreground",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <input
        type="file"
        accept={accept}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="sr-only"
      />
      <span className="break-all">{file ? file.name : hint}</span>
    </label>
  );
}
