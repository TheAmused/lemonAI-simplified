import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLanguage } = useI18n();

  return (
    <div
      role="group"
      aria-label="Wybór języka"
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-secondary/80 p-0.5 text-xs font-mono select-none",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setLanguage("pl")}
        className={cn(
          "px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer",
          lang === "pl"
            ? "bg-card text-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        )}
        aria-pressed={lang === "pl"}
      >
        PL
      </button>
      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={cn(
          "px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer",
          lang === "en"
            ? "bg-card text-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        )}
        aria-pressed={lang === "en"}
      >
        EN
      </button>
    </div>
  );
}
