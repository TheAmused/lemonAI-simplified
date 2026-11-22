import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HubUser } from "@/lib/hub-api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { AppsIcon, ClockIcon, GearIcon, GridIcon, LemonMark, SparkleIcon, UserIcon, WandIcon } from "./icons";

export type AppView = "workspace" | "hub" | "creator" | "apps" | "history" | "settings" | "profile" | "admin";

export interface RailProps {
  view: AppView;
  onNavigate: (view: AppView) => void;

  updateCount: number;

  appUpdate?: boolean;
  currentUser: HubUser | null;
  onSignIn: () => void;
  onPublish: () => void;
  onLogout: () => void;
}

function RailLink({
  label,
  icon,
  active,
  onClick,
  badge,
  ...rest
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: ReactNode;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative w-16 pb-2 pt-[9px] rounded-[14px] flex flex-col items-center gap-[5px] text-[11.5px] transition-colors cursor-pointer",
        active
          ? "bg-rail-active text-rail-active-foreground font-semibold"
          : "text-rail-muted font-medium hover:text-rail-foreground rail-hover"
      )}
      {...rest}
    >
      {icon}
      <span>{label}</span>
      {badge}
    </button>
  );
}

export function Rail({ view, onNavigate, updateCount, appUpdate = false, currentUser, onSignIn, onPublish, onLogout }: RailProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isAdmin = currentUser?.role === "admin";

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const go = (target: AppView) => {
    setMenuOpen(false);
    onNavigate(target);
  };

  const menuItem = "w-full h-11 px-5 flex items-center gap-3 text-left text-sm hover:bg-secondary cursor-pointer";

  return (
    <nav
      aria-label={t("mainNavigation")}
      className="w-[76px] shrink-0 flex flex-col items-center gap-1 pb-3 pt-4 bg-rail text-rail-foreground border-r border-rail-border select-none z-30"
    >
      <div
        role="img"
        aria-label="LemonAI"
        className="h-10 w-10 mb-[18px] rounded-[13px] flex items-center justify-center bg-rail-active text-rail-active-foreground"
      >
        <LemonMark />
      </div>

      <RailLink label={t("navStudio")} icon={<SparkleIcon />} active={view === "workspace"} onClick={() => go("workspace")} />
      <RailLink
        label={t("navCatalog")}
        icon={<GridIcon />}
        active={view === "hub"}
        onClick={() => go("hub")}
        badge={
          updateCount > 0 ? (
            <span
              className="absolute top-1.5 right-4 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-rail"
              title={`Aktualizacje modeli: ${updateCount}`}
              aria-label={`Aktualizacje modeli: ${updateCount}`}
            />
          ) : undefined
        }
      />
      <RailLink
        label={t("navApps")}
        icon={<AppsIcon />}
        active={view === "apps"}
        onClick={() => go("apps")}
        badge={
          appUpdate ? (
            <span
              className="absolute top-1.5 right-4 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-rail"
              title="Jest nowa wersja aplikacji"
              aria-label="Jest nowa wersja aplikacji"
            />
          ) : undefined
        }
      />
      <RailLink label={t("navHistory")} icon={<ClockIcon />} active={view === "history"} onClick={() => go("history")} />
      <RailLink label={t("navCreator")} icon={<WandIcon />} active={view === "creator"} onClick={() => go("creator")} />

      <div className="flex-1" />

      {currentUser && (
        <NotificationsBell key={currentUser.id} isAdmin={isAdmin} variant="rail" onOpen={(target) => go(target)} />
      )}
      <RailLink label={t("navSettings")} icon={<GearIcon />} active={view === "settings"} onClick={() => go("settings")} />

      {currentUser ? (
        <div ref={menuRef} className="relative mt-2">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("navAccount")}
            title={currentUser.username}
            className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm cursor-pointer bg-rail-active text-rail-active-foreground",
              (view === "profile" || view === "admin") && "ring-2 ring-offset-2 ring-offset-rail ring-rail-active"
            )}
          >
            {currentUser.username.slice(0, 1).toUpperCase()}
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label={t("navAccount")}
              className="absolute left-full bottom-0 ml-3 w-72 rounded-2xl bg-card text-card-foreground border border-border shadow-pop overflow-hidden z-50"
            >
              <div className="flex items-center gap-3 px-5 py-4">
                <span
                  aria-hidden="true"
                  className="h-11 w-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-extrabold"
                >
                  {currentUser.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold truncate">{currentUser.username}</span>
                  <span className="block text-xs text-muted-foreground">
                    {isAdmin ? "Administrator · LemonAI Hub" : "LemonAI Hub"}
                  </span>
                </span>
              </div>
              <div className="border-t border-border py-1.5">
                <button type="button" role="menuitem" className={menuItem} onClick={() => go("profile")}>
                  {t("profileNav")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onPublish();
                  }}
                >
                  {t("publishModel")}
                </button>
                {isAdmin && (
                  <button type="button" role="menuitem" className={menuItem} onClick={() => go("admin")}>
                    {t("admin")}
                  </button>
                )}
              </div>
              <div className="border-t border-border py-1.5">
                <button type="button" role="menuitem" className={menuItem} onClick={() => go("settings")}>
                  {t("navSettings")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={cn(menuItem, "text-muted-foreground")}
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                >
                  {t("logout")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <RailLink label={t("navSignIn")} icon={<UserIcon />} active={false} onClick={onSignIn} />
      )}
    </nav>
  );
}
