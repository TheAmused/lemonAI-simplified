import { useCallback, useEffect, useRef, useState } from "react";
import { apiMarkNotificationsRead, apiNotifications, type HubNotification } from "@/lib/hub-api";
import { formatDate } from "@/lib/moderation";
import { cn } from "@/lib/utils";
import { BellIcon } from "@/components/shell/icons";
import { useI18n } from "@/lib/i18n";

const POLL_MS = 60_000;

const ADMIN_KINDS = new Set(["review_needed", "appeal", "author_message", "report"]);

export function NotificationsBell({
  isAdmin,
  onOpen,
  variant = "header",
}: {
  isAdmin: boolean;
  onOpen: (target: "profile" | "admin") => void;

  variant?: "header" | "rail";
}) {
  const { t } = useI18n();
  const rail = variant === "rail";
  const [items, setItems] = useState<HubNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async (): Promise<number> => {
    try {
      const data = await apiNotifications();
      if (mounted.current) {
        setItems(data.notifications);
        setUnread(data.unread);
      }
      return data.unread;
    } catch {

      return 0;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await load();
  };

  const markAllRead = async () => {
    try {
      await apiMarkNotificationsRead("all");
      if (mounted.current) {
        setItems((list) => list.map((n) => ({ ...n, read: true })));
        setUnread(0);
      }
    } catch {
      // stays unread
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        className={cn(
          "relative flex cursor-pointer items-center justify-center",
          rail
            ? cn(
                "w-16 flex-col gap-[5px] rounded-[14px] pb-2 pt-[9px] text-[11.5px] font-medium text-rail-muted hover:text-rail-foreground rail-hover",
                open && "bg-black/10 text-rail-foreground dark:bg-white/10"
              )
            : "h-8 w-8 rounded-md border border-border hover:bg-secondary"
        )}
        aria-label={unread > 0 ? `Powiadomienia (${unread} nowe)` : "Powiadomienia"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="relative inline-flex">
          <BellIcon />
          {unread > 0 && (
            <span
              className={cn(
                "flex items-center justify-center rounded-lg bg-primary text-primary-foreground font-extrabold ring-2 ring-rail",
                rail ? "absolute -right-[9px] -top-[5px] h-4 min-w-4 px-1 text-[10px]" : "absolute -right-2 -top-2 h-4 min-w-4 px-1 text-[10px]"
              )}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        {rail && <span>{t("navBell")}</span>}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Lista powiadomień"
          className={cn(
            "absolute z-50 max-h-[28rem] w-[372px] overflow-y-auto rounded-[20px] border border-border bg-card text-card-foreground shadow-pop",
            rail ? "bottom-0 left-full ml-3" : "right-0 mt-2"
          )}
        >
          <header className="flex items-center justify-between gap-3 px-[18px] pb-3 pt-4">
            <h2 className="m-0 text-base font-extrabold">Powiadomienia</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-foreground underline"
              >
                {t("notificationsMarkRead")}
              </button>
            )}
          </header>
          {items.length === 0 ? (
            <p className="px-[18px] pb-4 text-[13px] text-muted-foreground">Brak powiadomień.</p>
          ) : (
            <ul className="m-0 list-none p-0 pb-1.5">
              {items.map((n) => (
                <li key={n.id} className={cn("border-l-[3px] border-t border-t-border", n.read ? "border-l-transparent" : "border-l-primary")}>
                  <button
                    type="button"
                    className="w-full cursor-pointer border-0 bg-transparent px-[18px] py-3 text-left hover:bg-secondary/60"
                    onClick={() => {
                      setOpen(false);
                      onOpen(isAdmin && ADMIN_KINDS.has(n.kind) ? "admin" : "profile");
                    }}
                  >
                    <p className={cn("m-0 text-sm leading-[1.4]", n.read ? "font-medium" : "font-bold")}>{n.title}</p>
                    {n.body && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12.5px] text-muted-foreground">{n.body}</p>}
                    <p className="mt-[3px] text-[12.5px] text-muted-foreground">{formatDate(n.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
