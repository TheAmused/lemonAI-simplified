import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Select({
  value,
  onValueChange,
  disabled = false,
  className,
  children,
  id,
  name,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectProps) {
  return (
    <select
      id={id}
      name={name}
      value={value ?? ""}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onChange={(e) => onValueChange?.(e.target.value)}
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-md border border-input bg-card/60 backdrop-blur-xs px-3 py-1.5 text-xs font-mono font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer text-foreground transition-all",
        className
      )}
    >
      {children}
    </select>
  );
}

export interface SelectTriggerProps {
  className?: string;
  children?: React.ReactNode;
}

export function SelectTrigger({ children }: SelectTriggerProps) {
  return <>{children}</>;
}

export interface SelectValueProps {
  placeholder?: string;
}

export function SelectValue({ placeholder }: SelectValueProps) {
  if (!placeholder) return null;
  return (
    <option value="" disabled hidden>
      {placeholder}
    </option>
  );
}

export interface SelectContentProps {
  className?: string;
  children?: React.ReactNode;
}

export function SelectContent({ children }: SelectContentProps) {
  return <>{children}</>;
}

export interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function SelectItem({
  value,
  children,
  className,
  disabled = false,
}: SelectItemProps) {
  return (
    <option
      value={value}
      disabled={disabled}
      className={cn("bg-card text-foreground py-1", className)}
    >
      {children}
    </option>
  );
}
