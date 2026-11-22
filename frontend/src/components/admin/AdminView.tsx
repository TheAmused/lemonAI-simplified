import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { DialogError, DialogField, DialogFooter, DialogNote } from "@/components/ui/dialog-parts";
import { dialogInput, linkButton, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { StandardsList, StatusBadge } from "@/components/hub/ModerationBits";
import { installSummary } from "@/components/hub/ModelHubView";
import { MessageBubble, MessagesModal, useScriptConversation } from "@/components/hub/MessagesModal";
import { ReleasesPanel } from "@/components/admin/ReleasesPanel";
import {
  apiAdminActions,
  apiAdminBan,
  apiAdminResetCode,
  apiAdminThreads,
  apiAdminModerate,
  apiAdminOverview,
  apiAdminReports,
  apiAdminResolveReport,
  apiAdminScripts,
  apiAdminSetRole,
  apiAdminUnban,
  apiAdminUsers,
  apiSetCuration,
  type AdminOverview,
  type AdminScript,
  type AdminUser,
  type HubReport,
  type HubUser,
  type MessageThread,
  type ModerationAction,
  type Paged,
  type ReportReason,
  type ScriptStatus,
} from "@/lib/hub-api";
import { REPORT_REASON_LABELS, actionLabel, formatDate } from "@/lib/moderation";
import { Notice, Page, LineSearch, UnderlineTabs } from "@/components/shell/Page";
import { SearchIcon } from "@/components/shell/icons";
import { cn } from "@/lib/utils";

type AdminTab = "overview" | "reports" | "messages" | "users" | "releases" | "log";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "overview", label: "Przegląd" },
  { id: "reports", label: "Zgłoszenia" },
  { id: "messages", label: "Wiadomości" },
  { id: "users", label: "Użytkownicy" },
  { id: "releases", label: "Wydania" },
  { id: "log", label: "Dziennik" },
];

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function reportsText(n: number): string {
  if (n === 1) return "1 zgłoszenie";
  const last = n % 10;
  const teen = n % 100 >= 12 && n % 100 <= 14;
  return `${n} ${last >= 2 && last <= 4 && !teen ? "zgłoszenia" : "zgłoszeń"}`;
}

const textButton = cn(linkButton, "h-11 px-1.5 text-sm");
const boardOutline = cn(outlineButton, "h-11 rounded-xl px-[18px]");
const boardPrimary = cn(primaryButton, "h-11 rounded-xl px-[22px]");
const destructiveButton =
  "h-12 cursor-pointer rounded-[14px] border-0 bg-destructive px-6 text-sm font-extrabold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50";
const checkboxClass = "h-[18px] w-[18px] cursor-pointer accent-[hsl(var(--ink))]";

function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-[22px]">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "h-10 cursor-pointer border-0 border-b-[3px] bg-transparent p-0 text-sm",
              on ? "border-primary font-extrabold text-foreground" : "border-transparent font-semibold text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Pager({ data, onPage }: { data: Paged | null; onPage: (page: number) => void }) {
  if (!data || data.pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-1">
      <button type="button" className={textButton} disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
        Poprzednia
      </button>
      <span className="text-[13px] text-muted-foreground">
        Strona {data.page} z {data.pages}
      </span>
      <button type="button" className={textButton} disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)}>
        Następna
      </button>
    </div>
  );
}

function useDebouncedValue<T>(value: T, onValue: (v: T) => void, delay = 350) {
  const cb = useRef(onValue);
  cb.current = onValue;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => cb.current(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
}

function LogList({ actions, empty }: { actions: ModerationAction[]; empty: string }) {
  if (actions.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="m-0 list-none border-t border-border p-0" aria-label="Dziennik moderacji">
      {actions.map((a) => (
        <li
          key={a.id}
          className="grid grid-cols-[150px_150px_minmax(0,1fr)] items-baseline gap-4 border-b border-border px-1 py-3.5 text-sm max-md:grid-cols-1 max-md:gap-1"
        >
          <span className="text-[13px] text-muted-foreground">{formatDate(a.created_at)}</span>
          <strong>{a.actor ?? "system"}</strong>
          <span>
            {actionLabel(a.action)} {a.target_label}
            {a.reason && <span className="text-muted-foreground"> — {a.reason}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface ReasonRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;

  optional?: boolean;

  noteField?: boolean;
  checkbox?: string;
  onConfirm: (reason: string, checked: boolean, note: string) => Promise<void>;
}

function ReasonDialog({ request, onClose }: { request: ReasonRequest; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await request.onConfirm(reason.trim(), checked, note.trim());
      onClose();
    } catch (err: unknown) {
      setError(message(err));
      setBusy(false);
    }
  };
  const disabled = busy || (!request.optional && !reason.trim());
  return (
    <Modal
      isOpen={true}
      onClose={() => !busy && onClose()}
      title={request.title}
      size="md"
      aria-labelledby="admin-reason-title"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) void confirm();
        }}
      >
        <DialogNote>{request.description}</DialogNote>
        <DialogField label={request.optional ? "Uwagi (opcjonalnie)" : request.noteField ? "Powód (zobaczy go autor)" : "Powód"}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 1000))}
            rows={3}
            aria-label="Powód"
            placeholder={request.noteField ? "Np. brak licencji wag w opisie." : undefined}
            className={cn(dialogInput, "h-auto min-h-[96px] resize-y px-3.5 py-3 leading-normal")}
          />
        </DialogField>
        {request.noteField && (
          <DialogField label="Uwagi (opcjonalnie)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              aria-label="Uwagi"
              placeholder="widoczne tylko w dzienniku"
              className={dialogInput}
            />
          </DialogField>
        )}
        {request.checkbox && (
          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className={checkboxClass} />
            <span>{request.checkbox}</span>
          </label>
        )}
        {error && <DialogError>{error}</DialogError>}
        <DialogFooter>
          <button type="button" className={outlineButton} onClick={onClose} disabled={busy}>
            Anuluj
          </button>
          <button type="submit" className={request.destructive ? destructiveButton : primaryButton} disabled={disabled}>
            {busy ? "…" : request.confirmLabel}
          </button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

function ThreadPane({
  thread,
  onSent,
  onApprove,
  status,
}: {
  thread: MessageThread["script"];
  onSent: () => void;
  onApprove: () => void;
  status: ScriptStatus;
}) {
  const convo = useScriptConversation(thread.slug, true);
  const { messages, text, setText, busy, error, send } = convo;
  return (
    <div className="flex min-w-0 flex-col gap-3.5 px-6 py-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[17px] font-extrabold">Rozmowa {thread.name}</h2>
        {status !== "published" && (
          <button type="button" className={textButton} onClick={onApprove}>
            Zatwierdź
          </button>
        )}
      </div>
      <ul className="m-0 flex max-h-[360px] list-none flex-col gap-3 overflow-y-auto p-0" aria-label="Rozmowa">
        {messages === null ? (
          <li className="text-sm text-muted-foreground">Wczytywanie…</li>
        ) : messages.length === 0 ? (
          <li className="text-sm text-muted-foreground">Brak wiadomości.</li>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} asModerator compact authorOnRight />)
        )}
      </ul>
      <div className="flex-1" />
      <label className="block">
        <span className="sr-only">Odpowiedź dla autora</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 4000))}
          placeholder="Odpowiedź dla autora…"
          className="min-h-[84px] w-full resize-y rounded-xl border border-border bg-background px-3.5 py-3 text-sm"
        />
      </label>
      {error && <DialogError>{error}</DialogError>}
      <div className="flex justify-end">
        <button
          type="button"
          className={boardPrimary}
          disabled={busy || !text.trim()}
          onClick={async () => {
            await send();
            onSent();
          }}
        >
          {busy ? "Wysyłanie…" : "Odpowiedz"}
        </button>
      </div>
    </div>
  );
}

export function AdminView({ currentUser }: { currentUser: HubUser }) {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reasonRequest, setReasonRequest] = useState<ReasonRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [scriptFilter, setScriptFilter] = useState<{ status: ScriptStatus | ""; search: string; reported: boolean; page: number }>({
    status: "pending",
    search: "",
    reported: false,
    page: 1,
  });
  const [scriptSearch, setScriptSearch] = useState("");
  const [scripts, setScripts] = useState<(Paged & { scripts: AdminScript[] }) | null>(null);

  const [openSlug, setOpenSlug] = useState<string | null | undefined>(undefined);
  const [reportStatus, setReportStatus] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const [reportPage, setReportPage] = useState(1);
  const [reports, setReports] = useState<(Paged & { reports: HubReport[] }) | null>(null);
  const [userFilter, setUserFilter] = useState<{ search: string; banned: boolean | undefined; page: number }>({
    search: "",
    banned: undefined,
    page: 1,
  });
  const [userSearch, setUserSearch] = useState("");
  const [users, setUsers] = useState<(Paged & { users: AdminUser[] }) | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [threads, setThreads] = useState<MessageThread[] | null>(null);
  const [threadsWaiting, setThreadsWaiting] = useState(true);
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [thread, setThread] = useState<{ slug: string; name: string } | null>(null);
  const [resetCode, setResetCode] = useState<{ code: string; username: string } | null>(null);
  const [log, setLog] = useState<(Paged & { actions: ModerationAction[] }) | null>(null);

  const reqIds = useRef<Record<string, number>>({});
  const errorKey = useRef<string | null>(null);

  const guarded = useCallback(async <T,>(key: string, fetcher: () => Promise<T>, apply: (data: T) => void) => {
    const id = (reqIds.current[key] ?? 0) + 1;
    reqIds.current[key] = id;
    try {
      const data = await fetcher();
      if (mounted.current && reqIds.current[key] === id) {
        if (errorKey.current === key) {
          errorKey.current = null;
          setError(null);
        }
        apply(data);
      }
    } catch (err: unknown) {
      if (mounted.current && reqIds.current[key] === id) {
        errorKey.current = key;
        setError(message(err));
      }
    }
  }, []);

  const loadOverview = useCallback(() => guarded("overview", apiAdminOverview, setOverview), [guarded]);
  const loadScripts = useCallback(
    () => guarded("scripts", () => apiAdminScripts(scriptFilter), setScripts),
    [guarded, scriptFilter]
  );
  const loadReports = useCallback(
    () => guarded("reports", () => apiAdminReports(reportStatus, reportPage), setReports),
    [guarded, reportStatus, reportPage]
  );
  const loadThreads = useCallback(
    () =>
      guarded("threads", () => apiAdminThreads(threadsWaiting), (data) => {
        setThreads(data.threads);
        if (threadsWaiting) setWaitingCount(data.total ?? data.threads.length);
      }),
    [guarded, threadsWaiting]
  );
  const loadUsers = useCallback(() => guarded("users", () => apiAdminUsers(userFilter), setUsers), [guarded, userFilter]);
  const loadLog = useCallback(() => guarded("log", () => apiAdminActions(logPage), setLog), [guarded, logPage]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);
  useEffect(() => {
    if (tab === "overview") void loadScripts();
  }, [tab, loadScripts]);
  useEffect(() => {
    if (tab === "reports") void loadReports();
  }, [tab, loadReports]);
  useEffect(() => {
    if (tab === "messages") void loadThreads();
  }, [tab, loadThreads]);
  useEffect(() => {
    if (tab === "users") void loadUsers();
  }, [tab, loadUsers]);
  useEffect(() => {
    if (tab === "log") void loadLog();
  }, [tab, loadLog]);

  useEffect(() => {
    apiAdminThreads(true)
      .then((data) => mounted.current && setWaitingCount(data.total ?? data.threads.length))
      .catch(() => undefined);
  }, []);

  useDebouncedValue(scriptSearch, (search) => setScriptFilter((f) => (f.search === search ? f : { ...f, search, page: 1 })));
  useDebouncedValue(userSearch, (search) => setUserFilter((f) => (f.search === search ? f : { ...f, search, page: 1 })));

  const entries = scripts?.scripts ?? [];
  const openId = openSlug === null ? null : entries.some((e) => e.slug === openSlug) ? openSlug : entries[0]?.slug ?? null;
  const threadId =
    threads?.some((t) => t.script.slug === activeThread) ? activeThread : threads?.[0]?.script.slug ?? null;

  const refresh = () => {
    void loadOverview();
    if (tab === "overview") void loadScripts();
    else if (tab === "reports") void loadReports();
    else if (tab === "messages") void loadThreads();
    else if (tab === "users") void loadUsers();
    else if (tab === "log") void loadLog();
  };

  const done = (text: string) => {
    setNotice(text);
    refresh();
  };

  const approve = (script: { slug: string; name: string }) =>
    setReasonRequest({
      title: `Zatwierdzić ${script.name}?`,
      description: "Model będzie widoczny w katalogu dla wszystkich. Otwarte zgłoszenia zostaną zamknięte jako odrzucone.",
      confirmLabel: "Zatwierdź",
      optional: true,
      onConfirm: async (reason) => {
        await apiAdminModerate(script.slug, "approve", reason);
        done(`Zatwierdzono ${script.name}.`);
      },
    });

  const reject = (script: { slug: string; name: string }) =>
    setReasonRequest({
      title: `Odrzucić ${script.name}?`,
      description:
        "Autor zobaczy powód w „Moje modele” i może poprawić wpis, który wtedy wróci do przeglądu. Otwarte zgłoszenia zostaną zamknięte jako odrzucone.",
      confirmLabel: "Odrzuć",
      destructive: true,
      noteField: true,
      onConfirm: async (reason, _checked, note) => {
        await apiAdminModerate(script.slug, "reject", reason, note);
        done(`Odrzucono ${script.name}.`);
      },
    });

  const remove = (script: { slug: string; name: string }) =>
    setReasonRequest({
      title: `Usunąć ${script.name} na zawsze?`,
      description:
        "Wpis i jego obrazek zostaną usunięte z Hubu bez możliwości przywrócenia; autor nie zobaczy powodu (zostaje w dzienniku). Do zwykłych naruszeń lepiej użyć „Odrzuć”.",
      confirmLabel: "Usuń na zawsze",
      destructive: true,
      onConfirm: async (reason) => {
        await apiAdminModerate(script.slug, "delete", reason);
        done(`Usunięto ${script.name}.`);
      },
    });

  const toggleCurated = async (script: AdminScript) => {
    try {
      await apiSetCuration(script.slug, !script.is_curated);
      done(script.is_curated ? `${script.name} nie jest już polecany.` : `${script.name} jest teraz polecany.`);
    } catch (err: unknown) {
      setError(message(err));
    }
  };

  const closeReport = (report: HubReport, action: "resolve" | "dismiss") =>
    setReasonRequest({
      title: action === "resolve" ? "Zamknąć zgłoszenie jako rozwiązane?" : "Odrzucić zgłoszenie?",
      description:
        action === "resolve"
          ? "Problem został naprawiony lub obsłużony inaczej. Model pozostaje w obecnym stanie."
          : "Zgłoszenie jest bezzasadne. Model pozostaje w obecnym stanie.",
      confirmLabel: action === "resolve" ? "Rozwiązane" : "Odrzuć zgłoszenie",
      optional: true,
      onConfirm: async (note) => {
        await apiAdminResolveReport(report.id, action, note);
        done("Zgłoszenie zamknięte.");
      },
    });

  const ban = (user: AdminUser) =>
    setReasonRequest({
      title: `Zablokować ${user.username}?`,
      description: "Użytkownik zostanie wylogowany ze wszystkich sesji i nie zaloguje się, dopóki go nie odblokujesz.",
      confirmLabel: "Zablokuj",
      destructive: true,
      checkbox: `Odrzuć też modele tego użytkownika (${user.scripts_count})`,
      onConfirm: async (reason, rejectScripts) => {
        const result = await apiAdminBan(user.id, reason, rejectScripts);
        done(
          `Zablokowano ${user.username}.` + (result.scripts_rejected ? ` Odrzucono modeli: ${result.scripts_rejected}.` : "")
        );
      },
    });

  const unban = async (user: AdminUser) => {
    try {
      await apiAdminUnban(user.id);
      done(`Odblokowano ${user.username}.`);
    } catch (err: unknown) {
      setError(message(err));
    }
  };

  const issueResetCode = async (user: AdminUser) => {
    try {
      setResetCode(await apiAdminResetCode(user.id));
    } catch (err: unknown) {
      setError(message(err));
    }
  };

  const setRole = async (user: AdminUser, role: "user" | "admin") => {
    try {
      await apiAdminSetRole(user.id, role);
      done(role === "admin" ? `${user.username} jest teraz administratorem.` : `${user.username} nie jest już administratorem.`);
    } catch (err: unknown) {
      setError(message(err));
    }
  };

  const filterTo = (status: ScriptStatus | "") => {
    setScriptFilter((f) => ({ ...f, status, page: 1 }));
    setTab("overview");
  };

  const statCards = overview
    ? [
        { label: "Czeka na przegląd", value: overview.scripts.pending, note: "", bar: overview.scripts.pending > 0, go: () => filterTo("pending") },
        { label: "Otwarte zgłoszenia", value: overview.open_reports, note: "", bar: overview.open_reports > 0, go: () => { setReportStatus("open"); setReportPage(1); setTab("reports"); } },
        { label: "Opublikowane", value: overview.scripts.published, note: "", bar: false, go: () => filterTo("published") },
        { label: "Odrzucone", value: overview.scripts.rejected, note: "", bar: false, go: () => filterTo("rejected") },
        { label: "Użytkownicy", value: overview.users, note: `${overview.banned_users} zablokowanych`, bar: false, go: () => setTab("users") },
      ]
    : [];

  const entryRow = (script: AdminScript) => {
    const official = script.author_role === "system";
    const open = script.slug === openId;
    const summary = installSummary(script.manifest);
    return (
      <li
        key={script.id}
        aria-label={script.name}
        className={cn("border-b border-border border-l-4", open ? "border-l-primary bg-card" : "border-l-transparent")}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpenSlug(open ? null : script.slug)}
          className="flex w-full cursor-pointer flex-wrap items-center gap-4 border-0 bg-transparent px-4 py-3.5 text-left"
        >
          <span className="min-w-0 flex-[1_1_240px]">
            <span className="flex flex-wrap items-center gap-2.5">
              <span className="text-base font-bold">{script.name}</span>
              {official && <span className="rounded-md border-[1.5px] border-ink px-2 py-0.5 text-[11.5px] font-bold">Oficjalny</span>}
              {script.open_reports > 0 && (
                <span className="text-xs font-bold text-destructive">{reportsText(script.open_reports)}</span>
              )}
            </span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">
              {official ? "LemonAI" : script.author}
              {script.author_banned ? " (zablokowany)" : ""} · {script.installs_count ?? script.downloads_count ?? 0} pobrań ·{" "}
              {script.min_vram_gb} GB VRAM · {script.min_ram_gb} GB RAM
            </span>
          </span>
          <StatusBadge status={script.status} />
        </button>
        {open && (
          <div className="flex flex-col gap-3.5 px-4 pb-[18px] pt-1">
            <p className="m-0 max-w-[640px] text-sm leading-[1.55] text-muted-foreground">{script.description}</p>
            {script.moderation_note && (
              <p className="m-0 text-[13px] text-muted-foreground">Notatka moderacji: {script.moderation_note}</p>
            )}
            <StandardsList issues={script.standards} compact />
            <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-muted-foreground">Co instaluje</dt>
              <dd className="m-0" />
              {summary.repos.length > 0 && (
                <>
                  <dt className="text-muted-foreground">HF:</dt>
                  <dd className="m-0 break-all font-mono">{summary.repos.join(", ")}</dd>
                </>
              )}
              {summary.packages.length > 0 && (
                <>
                  <dt className="text-muted-foreground">pip:</dt>
                  <dd className="m-0 break-all font-mono">{summary.packages.join(", ")}</dd>
                </>
              )}
              {summary.args.length > 0 && (
                <>
                  <dt className="text-muted-foreground">argumenty:</dt>
                  <dd className="m-0 break-all font-mono">{summary.args.join(" ")}</dd>
                </>
              )}
              <dt className="text-muted-foreground">runner:</dt>
              <dd className="m-0 font-mono">{script.manifest.runtime.archetype}</dd>
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              {script.status !== "published" && (
                <button type="button" className={boardPrimary} onClick={() => approve(script)}>
                  Zatwierdź
                </button>
              )}
              {script.status !== "rejected" && (
                <button type="button" className={boardOutline} onClick={() => reject(script)}>
                  Odrzuć
                </button>
              )}
              {script.status === "published" && (
                <button type="button" className={textButton} onClick={() => void toggleCurated(script)}>
                  {script.is_curated ? "Nie polecaj" : "Polecaj"}
                </button>
              )}
              {!official && (
                <button type="button" className={textButton} onClick={() => setThread(script)}>
                  Wiadomości
                </button>
              )}
              {!official && (
                <button type="button" className={cn(textButton, "text-destructive")} onClick={() => remove(script)}>
                  Usuń…
                </button>
              )}
            </div>
          </div>
        )}
      </li>
    );
  };

  const overviewView = () => (
    <section aria-label="Przegląd" className="flex flex-col gap-[26px]">
      {!overview ? (
        <p className="text-sm text-muted-foreground">Wczytywanie…</p>
      ) : (
        <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-2">
          {statCards.map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={card.go}
              className={cn(
                "cursor-pointer rounded-[18px] border border-border border-l-4 bg-card px-5 py-[18px] text-left transition-colors hover:bg-secondary/60",
                card.bar ? "border-l-primary" : "border-l-border"
              )}
            >
              <span className="block text-[13px] text-muted-foreground">{card.label}</span>
              <span
                className="mt-1.5 block font-display text-[38px] font-extrabold leading-none tabular-nums"
                data-testid={`admin-stat-${card.label}`}
              >
                {card.value}
              </span>
              <span className="mt-1.5 block min-h-4 text-[12.5px] text-muted-foreground">{card.note}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-9 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-3.5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <Segments<ScriptStatus | "">
              label="Filtr"
              value={scriptFilter.status}
              onChange={(status) => setScriptFilter((f) => ({ ...f, status, page: 1 }))}
              options={[
                { id: "", label: "Wszystkie" },
                { id: "pending", label: "Czeka na przegląd" },
                { id: "published", label: "Opublikowane" },
                { id: "rejected", label: "Odrzucone" },
              ]}
            />
            <LineSearch
              value={scriptSearch}
              onChange={setScriptSearch}
              placeholder="Nazwa, slug lub autor…"
              label="Szukaj modeli"
              icon={<SearchIcon size={18} />}
              className="w-[280px] max-w-full"
            />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={scriptFilter.reported}
              onChange={(e) => setScriptFilter((f) => ({ ...f, reported: e.target.checked, page: 1 }))}
            />
            Tylko zgłoszone
          </label>
          {!scripts ? (
            <p className="text-sm text-muted-foreground">Wczytywanie…</p>
          ) : scripts.scripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak wpisów.</p>
          ) : (
            <ul className="m-0 list-none border-t border-border p-0">{scripts.scripts.map(entryRow)}</ul>
          )}
          <Pager data={scripts} onPage={(page) => setScriptFilter((f) => ({ ...f, page }))} />
        </div>
        <aside aria-label="Ostatnie działania" className="flex flex-col gap-3">
          <h2 className="m-0 text-[13px] font-bold tracking-[0.05em] text-muted-foreground">OSTATNIE DZIAŁANIA</h2>
          {!overview ? null : overview.recent_actions.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">Brak działań moderacyjnych.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {overview.recent_actions.map((a) => (
                <li key={a.id} className="border-t border-border py-3 text-[13.5px] leading-normal">
                  <strong>{a.actor ?? "system"}</strong> {actionLabel(a.action)} {a.target_label}
                  <div className="mt-0.5 text-[12.5px] text-muted-foreground">{formatDate(a.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );

  const reportsView = () => (
    <section aria-label="Zgłoszenia" className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-[18px]">
        <span className="text-[13px] font-bold text-muted-foreground">Stan zgłoszeń</span>
        <Segments<typeof reportStatus>
          label="Filtr"
          value={reportStatus}
          onChange={(s) => {
            setReportStatus(s);
            setReportPage(1);
          }}
          options={[
            { id: "open", label: "Otwarte" },
            { id: "resolved", label: "Rozwiązane" },
            { id: "dismissed", label: "Odrzucone" },
            { id: "all", label: "Wszystkie" },
          ]}
        />
      </div>
      {!reports ? (
        <p className="text-sm text-muted-foreground">Wczytywanie…</p>
      ) : reports.reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak zgłoszeń.</p>
      ) : (
        <ul className="m-0 list-none border-t border-border p-0">
          {reports.reports.map((report) => (
            <li
              key={report.id}
              aria-label={`Zgłoszenie ${report.script?.name ?? ""}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-7 gap-y-4 border-b border-border px-1 py-5 max-md:grid-cols-1"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-bold">
                  <span>
                    Zgłoszenie {report.script?.name ?? "(usunięty model)"}
                    {report.script?.author && (
                      <span className="ml-1 text-[13.5px] font-medium text-muted-foreground">· autor modelu: {report.script.author}</span>
                    )}
                  </span>
                  {report.script && <StatusBadge status={report.script.status} />}
                </div>
                <div className="mt-1.5 text-[13px] font-bold text-warn">
                  {REPORT_REASON_LABELS[report.reason as ReportReason] ?? report.reason}
                </div>
                {report.details && (
                  <p className="m-0 mt-1.5 max-w-[620px] whitespace-pre-wrap break-words text-sm leading-[1.55] text-muted-foreground">
                    „{report.details}”
                  </p>
                )}
                <div className="mt-1.5 text-[12.5px] text-muted-foreground">
                  zgłosił: {report.reporter ?? "(konto usunięte)"} · {formatDate(report.created_at)}
                </div>
                {report.status !== "open" && (
                  <div className="mt-1 text-[12.5px] text-muted-foreground">
                    {report.status === "resolved" ? "Rozwiązane" : "Odrzucone"} przez {report.resolved_by ?? "—"}{" "}
                    {formatDate(report.resolved_at)}
                    {report.resolution_note ? `: ${report.resolution_note}` : ""}
                  </div>
                )}
              </div>
              {report.status === "open" && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  <button type="button" className={boardOutline} onClick={() => closeReport(report, "resolve")}>
                    Rozwiązane
                  </button>
                  <button type="button" className={textButton} onClick={() => closeReport(report, "dismiss")}>
                    Bezzasadne
                  </button>
                  {report.script && report.script.status !== "rejected" && (
                    <button
                      type="button"
                      className={cn(textButton, "text-destructive")}
                      onClick={() => report.script && reject(report.script)}
                    >
                      Odrzuć model…
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager data={reports} onPage={setReportPage} />
    </section>
  );

  const messagesView = () => {
    const current = threads?.find((t) => t.script.slug === threadId) ?? null;
    return (
      <section aria-label="Wiadomości" className="flex flex-col gap-[18px]">
        <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" className={checkboxClass} checked={threadsWaiting} onChange={(e) => setThreadsWaiting(e.target.checked)} />
          Tylko czekające na odpowiedź
        </label>
        {!threads ? (
          <p className="text-sm text-muted-foreground">Wczytywanie…</p>
        ) : threads.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak rozmów{threadsWaiting ? " czekających na odpowiedź" : ""}.</p>
        ) : (
          <div className="grid min-h-[420px] grid-cols-[360px_minmax(0,1fr)] overflow-hidden rounded-[20px] border border-border bg-card max-lg:grid-cols-1">
            <ul className="m-0 list-none border-r border-border p-0 max-lg:border-b max-lg:border-r-0">
              {threads.map((t) => {
                const waiting = !t.last_message.from_moderator;
                const selected = t.script.slug === threadId;
                return (
                  <li key={t.script.id} aria-label={`Rozmowa ${t.script.name}`}>
                    <button
                      type="button"
                      aria-current={selected}
                      onClick={() => setActiveThread(t.script.slug)}
                      className={cn(
                        "block w-full cursor-pointer border-0 border-b border-l-4 border-b-border px-[18px] py-4 text-left",
                        waiting ? "border-l-primary" : "border-l-transparent",
                        selected || waiting ? "bg-secondary/70" : "bg-transparent"
                      )}
                    >
                      <span className="block text-[14.5px] font-bold">{t.script.name}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                        {t.last_message.from_moderator ? "Moderator" : t.last_message.author}: {t.last_message.body}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t.script.author ?? "—"} · {formatDate(t.last_message.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {current && (
              <ThreadPane
                key={current.script.slug}
                thread={current.script}
                status={current.script.status}
                onSent={() => {
                  void loadThreads();
                }}
                onApprove={() => approve(current.script)}
              />
            )}
          </div>
        )}
      </section>
    );
  };

  const usersView = () => (
    <section aria-label="Użytkownicy" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <LineSearch
          value={userSearch}
          onChange={setUserSearch}
          placeholder="Nazwa lub e-mail…"
          label="Szukaj użytkowników"
          icon={<SearchIcon size={18} />}
          className="w-[280px] max-w-full"
        />
        <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={userFilter.banned === true}
            onChange={(e) => setUserFilter((f) => ({ ...f, banned: e.target.checked ? true : undefined, page: 1 }))}
          />
          Tylko zablokowani
        </label>
      </div>
      {!users ? (
        <p className="text-sm text-muted-foreground">Wczytywanie…</p>
      ) : users.users.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak użytkowników.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[12.5px] text-muted-foreground">
              <th className="border-b border-border px-2 py-2.5 font-bold">Użytkownik</th>
              <th className="border-b border-border px-2 py-2.5 font-bold">Rola</th>
              <th className="border-b border-border px-2 py-2.5 text-right font-bold">Modele</th>
              <th className="border-b border-border px-2 py-2.5 font-bold">Stan</th>
              <th className="border-b border-border px-2 py-2.5">
                <span className="sr-only">Akcje</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.users.map((user) => {
              const self = user.id === currentUser.id;
              const banned = Boolean(user.banned_at);
              return (
                <tr key={user.id} aria-label={user.username}>
                  <td className="border-b border-border px-2 py-3.5">
                    <div className="font-bold">
                      {user.username}
                      {self ? " (Ty)" : ""}
                    </div>
                    <div className="text-[12.5px] text-muted-foreground">{user.email}</div>
                  </td>
                  <td className="border-b border-border px-2 py-3.5">{user.role === "admin" ? "Administrator" : "Użytkownik"}</td>
                  <td className="border-b border-border px-2 py-3.5 text-right tabular-nums">{user.scripts_count}</td>
                  <td className="border-b border-border px-2 py-3.5">
                    <span className="inline-flex items-center gap-2 font-semibold">
                      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", banned ? "bg-destructive" : "bg-ok")} />
                      {banned ? `Zablokowany${user.ban_reason ? `: ${user.ban_reason}` : ""}` : "Aktywny"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-border p-2 text-right">
                    {!self && (
                      <>
                        <button
                          type="button"
                          className="mr-3.5 cursor-pointer border-0 bg-transparent p-0 text-[13.5px] font-bold text-foreground hover:underline"
                          onClick={() => void issueResetCode(user)}
                        >
                          Kod resetu hasła
                        </button>
                        {!banned && (
                          <button
                            type="button"
                            className={textButton}
                            onClick={() => void setRole(user, user.role === "admin" ? "user" : "admin")}
                          >
                            {user.role === "admin" ? "Odbierz admina" : "Nadaj admina"}
                          </button>
                        )}
                        {banned ? (
                          <button type="button" className={textButton} onClick={() => void unban(user)}>
                            Odblokuj
                          </button>
                        ) : user.role !== "admin" ? (
                          <button type="button" className={cn(textButton, "text-destructive")} onClick={() => ban(user)}>
                            Zablokuj…
                          </button>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Pager data={users} onPage={(page) => setUserFilter((f) => ({ ...f, page }))} />
    </section>
  );

  const logView = () => (
    <section aria-label="Dziennik moderacji" className="flex flex-col gap-3.5">
      <h2 className="m-0 text-xl font-extrabold">Dziennik moderacji</h2>
      {!log ? <p className="text-sm text-muted-foreground">Wczytywanie…</p> : <LogList actions={log.actions} empty="Brak działań moderacyjnych." />}
      <Pager data={log} onPage={setLogPage} />
    </section>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Page width={1240} className="gap-[22px]">
        <header className="flex flex-wrap items-end gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em]">Administracja</h1>
            <p className="mt-2 max-w-[620px] text-sm leading-normal text-muted-foreground">
              Przegląd wpisów w Hubie, zgłoszenia, wiadomości do autorów, konta i wydania aplikacji.
            </p>
          </div>
          <button type="button" className={boardOutline} onClick={refresh}>
            Odśwież
          </button>
        </header>
        <UnderlineTabs<AdminTab>
          accent
          label="Sekcje administracji"
          value={tab}
          onChange={(id) => {
            setNotice(null);
            setTab(id);
          }}
          tabs={TABS.map((t) => ({
            id: t.id,
            label: t.label,
            count:
              t.id === "reports" && overview ? overview.open_reports : t.id === "messages" ? waitingCount ?? undefined : undefined,
          }))}
        />
        {notice && <Notice tone="ok">{notice}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          {tab === "overview"
            ? overviewView()
            : tab === "reports"
              ? reportsView()
              : tab === "messages"
                ? messagesView()
                : tab === "releases"
                  ? <ReleasesPanel />
                  : tab === "users"
                    ? usersView()
                    : logView()}
        </div>
      </Page>
      {reasonRequest && <ReasonDialog request={reasonRequest} onClose={() => setReasonRequest(null)} />}
      {thread && (
        <MessagesModal
          script={thread}
          asModerator={true}
          onClose={() => {
            setThread(null);
            refresh();
          }}
        />
      )}
      {resetCode && (
        <Modal
          isOpen={true}
          onClose={() => setResetCode(null)}
          title={`Kod resetu hasła: ${resetCode.username}`}
          size="sm"
          aria-labelledby="reset-code-title"
        >
          <div className="flex flex-col gap-4">
            <p
              className="m-0 select-all rounded-xl bg-background px-4 py-5 text-center font-mono text-[30px] font-bold tracking-[0.18em]"
              data-testid="reset-code"
            >
              {resetCode.code}
            </p>
            <DialogNote>
              Przekaż kod użytkownikowi inną drogą (nie przez Hub). Wpisuje go w aplikacji: Zaloguj się → Nie pamiętasz hasła? → Mam
              już kod. Kod działa raz i wygasa; wcześniejsze kody tego użytkownika przestały działać.
            </DialogNote>
            <DialogFooter>
              <button type="button" className={primaryButton} onClick={() => setResetCode(null)}>
                Gotowe
              </button>
            </DialogFooter>
          </div>
        </Modal>
      )}
    </div>
  );
}
