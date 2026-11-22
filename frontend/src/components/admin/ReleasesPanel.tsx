import { useCallback, useEffect, useState } from "react";
import { fieldInput, fieldLabel, linkButton, primaryButton } from "@/components/ui/form-styles";
import { cn } from "@/lib/utils";
import {
  apiAdminPublishRelease,
  apiAdminReleases,
  apiAdminWithdrawRelease,
  type AppRelease,
} from "@/lib/hub-api";
import { formatDate } from "@/lib/moderation";
import { Notice } from "@/components/shell/Page";

const mono = "font-mono";

export function ReleasesPanel() {
  const [releases, setReleases] = useState<AppRelease[] | null>(null);
  const [targets, setTargets] = useState<string[]>(["windows-x86_64"]);
  const [form, setForm] = useState({ version: "", target: "windows-x86_64", url: "", signature: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiAdminReleases();
      setReleases(data.releases);
      setTargets(data.targets);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { release } = await apiAdminPublishRelease(form);
      setNotice(`Opublikowano wersję ${release.version} (${release.target}). Aplikacje zaproponują aktualizację przy następnym sprawdzeniu.`);
      setForm({ version: "", target: form.target, url: "", signature: "", notes: "" });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (release: AppRelease) => {
    try {
      await apiAdminWithdrawRelease(release.id);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <section aria-label="Wydania" className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-10 max-lg:grid-cols-1">
      <form onSubmit={publish} className="flex flex-col gap-4" aria-label="Nowe wydanie">
        <div>
          <h2 className="m-0 text-xl font-extrabold">Opublikuj wydanie aplikacji</h2>
          <p className="m-0 mt-2 text-sm leading-[1.6] text-muted-foreground">
            Zbuduj instalator poleceniem <span className="font-mono text-foreground">.\build-windows.ps1 -Installer</span>; na końcu
            wypisze wersję, plik i podpis. Wgraj instalator w publiczne miejsce (np. GitHub Releases) i wklej tu adres oraz podpis.
            Aplikacja sprawdza podpis kluczem wbudowanym przy kompilacji, więc nie zainstaluje pliku podpisanego innym kluczem.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className={cn(fieldLabel, "mb-1.5 block")}>Wersja</span>
            <input className={cn(fieldInput, mono)} value={form.version} onChange={set("version")} placeholder="0.2.0" aria-label="Wersja" />
          </label>
          <label className="block">
            <span className={cn(fieldLabel, "mb-1.5 block")}>Platforma</span>
            <select className={cn(fieldInput, "cursor-pointer")} value={form.target} onChange={set("target")} aria-label="Platforma">
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className={cn(fieldLabel, "mb-1.5 block")}>Adres instalatora (https)</span>
          <input
            className={cn(fieldInput, mono)}
            value={form.url}
            onChange={set("url")}
            placeholder="https://…/LemonAI_0.2.0_x64-setup.exe"
            aria-label="Adres instalatora"
          />
        </label>
        <label className="block">
          <span className={cn(fieldLabel, "mb-1.5 block")}>Podpis (zawartość pliku .sig)</span>
          <textarea
            className={cn(fieldInput, mono, "h-auto min-h-[84px] resize-y py-3 text-[13px]")}
            value={form.signature}
            onChange={set("signature")}
            aria-label="Podpis"
          />
        </label>
        <label className="block">
          <span className={cn(fieldLabel, "mb-1.5 block")}>Co nowego</span>
          <textarea
            className={cn(fieldInput, "h-auto min-h-[96px] resize-y py-3")}
            value={form.notes}
            onChange={set("notes")}
            aria-label="Co nowego"
          />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        {notice && <Notice tone="ok">{notice}</Notice>}
        <div>
          <button type="submit" className={primaryButton} disabled={busy || !form.version.trim() || !form.url.trim() || !form.signature.trim()}>
            {busy ? "Publikowanie…" : "Opublikuj"}
          </button>
        </div>
      </form>
      <aside className="flex flex-col gap-2.5" aria-label="Opublikowane wydania">
        <h2 className="m-0 text-[13px] font-bold tracking-[0.05em] text-muted-foreground">OPUBLIKOWANE WYDANIA</h2>
        {!releases ? (
          <p className="text-sm text-muted-foreground">Wczytywanie…</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {releases.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-t border-border py-3.5" aria-label={`Wydanie ${r.version}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold">Wydanie {r.version}</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {r.target} · {formatDate(r.created_at)}
                  </div>
                  {r.notes && <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px]">{r.notes}</div>}
                </div>
                <button type="button" className={cn(linkButton, "h-11 px-1.5 text-destructive")} onClick={() => void withdraw(r)}>
                  Wycofaj
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-[13px] text-muted-foreground">Pusta lista oznacza: aplikacje nie dostaną aktualizacji.</p>
      </aside>
    </section>
  );
}
