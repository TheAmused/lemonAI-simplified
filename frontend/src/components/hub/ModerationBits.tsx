import type { ScriptStatus, StandardIssue } from "@/lib/hub-api";
import { STATUS_CLASSES, STATUS_LABELS, standardText } from "@/lib/moderation";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: ScriptStatus | undefined; className?: string }) {
  const value = status ?? "published";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-2 text-[13px] font-bold text-foreground", className)}
      data-testid="moderation-status"
    >
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full bg-current", STATUS_CLASSES[value])} />
      {STATUS_LABELS[value]}
    </span>
  );
}

export function StandardsList({ issues, compact = false }: { issues: StandardIssue[] | undefined; compact?: boolean }) {
  if (!issues || issues.length === 0) return null;
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return (
    <ul
      className={cn("m-0 flex list-none flex-col p-0", compact ? "gap-1 text-xs" : "gap-2 text-sm")}
      aria-label="Wyniki sprawdzenia standardów"
    >
      {sorted.map((issue) => (
        <li key={issue.code} className="flex gap-3 leading-snug">
          <span
            className={cn(
              "shrink-0 font-extrabold",
              compact ? "w-9" : "w-11",
              issue.level === "error" ? "text-destructive" : "text-warn"
            )}
          >
            {issue.level === "error" ? "Błąd" : "Uwaga"}
          </span>
          <span>{standardText(issue)}</span>
        </li>
      ))}
    </ul>
  );
}
