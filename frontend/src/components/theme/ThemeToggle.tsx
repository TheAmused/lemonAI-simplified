import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      className={cn(
        "h-8 px-2.5 text-xs font-mono tracking-tight flex items-center gap-2 border-border/80 hover:border-primary/50 bg-card/80 transition-all",
        className
      )}
      aria-label="Przełącz motyw"
      title={
        isDark ? "Przełącz na motyw jasny" : "Przełącz na motyw ciemny"
      }
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full transition-all shadow-xs",
            isDark
              ? "bg-primary shadow-neon-lemon"
              : "bg-amber-500 shadow-beacon"
          )}
        />
        <span className="text-[11px] font-sans">
          {isDark ? "🌙" : "☀️"}
        </span>
      </span>
      <span data-testid="theme-label" className="text-[11px] font-medium font-sans">
        {isDark ? "Motyw: ciemny" : "Motyw: jasny"}
      </span>
    </Button>
  );
}
