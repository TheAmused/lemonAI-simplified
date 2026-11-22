import { useState } from "react";
import { cn } from "@/lib/utils";

export function StarRating({
  name,
  average,
  count,
  mine,
  onRate,
}: {
  name: string;
  average: number | null | undefined;
  count: number | undefined;
  mine?: number | null;
  onRate?: (stars: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? mine ?? Math.round(average ?? 0);
  return (
    <div className="flex items-center gap-1.5 text-[11px]" data-testid="star-rating">
      <div className="flex" role={onRate ? "radiogroup" : undefined} aria-label={onRate ? `Twoja ocena: ${name}` : undefined}>
        {[1, 2, 3, 4, 5].map((n) =>
          onRate ? (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={mine === n}
              aria-label={`${n} ${n === 1 ? "gwiazdka" : n < 5 ? "gwiazdki" : "gwiazdek"}`}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onRate(mine === n ? null : n)}
              className={cn("leading-none px-px", n <= shown ? "text-amber-500" : "text-muted-foreground/40")}
            >
              ★
            </button>
          ) : (
            <span key={n} aria-hidden="true" className={cn("leading-none px-px", n <= shown ? "text-amber-500" : "text-muted-foreground/40")}>
              ★
            </span>
          )
        )}
      </div>
      <span className="text-muted-foreground">
        {count ? `${(average ?? 0).toFixed(1)} (${count})` : "brak ocen"}
        {mine ? ` · Twoja: ${mine}` : ""}
      </span>
    </div>
  );
}
