import { cn } from "@/lib/utils";

export function InfoTip({
  text,
  tone = "muted",
  align = "right",
  className,
}: {
  text: string;
  tone?: "muted" | "warn";

  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex items-center group/tip align-middle", className)}>
      <button
        type="button"
        tabIndex={0}
        aria-label={text}
        title={text}
        className={cn(
          "inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[11px] font-bold leading-none transition-colors cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tone === "warn"
            ? "border-warn/70 bg-warn/15 text-warn hover:bg-warn/25"
            : "border-muted-foreground/70 text-muted-foreground hover:text-foreground hover:border-foreground"
        )}
      >
        {tone === "warn" ? "!" : "i"}
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100 transition-opacity duration-150 absolute top-full z-40 mt-1.5 w-64 rounded-xl border border-border bg-popover px-3 py-2.5 text-xs font-normal leading-snug text-popover-foreground shadow-pop",
          align === "right" && "right-0",
          align === "left" && "left-0",
          align === "center" && "left-1/2 -translate-x-1/2"
        )}
      >
        {text}
      </span>
    </span>
  );
}
