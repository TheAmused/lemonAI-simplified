import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps {
  value?: number[];
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onValueChange?: (value: number[]) => void;
  className?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  onValueChange,
  className,
  id,
  name,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SliderProps) {
  const currentValue = value?.[0] ?? min;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = parseFloat(e.target.value);
    onValueChange?.([isNaN(num) ? min : num]);
  };

  return (
    <div className={cn("relative flex w-full touch-none select-none items-center py-1", className)}>
      <input
        type="range"
        id={id}
        name={name}
        min={min}
        max={max}
        step={step}
        value={currentValue}
        disabled={disabled}
        onChange={handleChange}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={currentValue}
        className={cn(
          "w-full h-2.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-[hsl(var(--line))] focus:outline-none focus:ring-2 focus:ring-ring border border-border/80 shadow-xs transition-all",
          disabled && "opacity-40 cursor-not-allowed"
        )}
      />
    </div>
  );
}
