import type { ReportReason, ScriptStatus, StandardIssue } from "@/lib/hub-api";

export const STATUS_LABELS: Record<ScriptStatus, string> = {
  published: "Opublikowany",
  pending: "Czeka na przegląd",
  rejected: "Odrzucony",
};

export const STATUS_CLASSES: Record<ScriptStatus, string> = {
  published: "text-ok",
  pending: "text-warn",
  rejected: "text-destructive",
};

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  malicious: "Szkodliwy lub podejrzany",
  broken: "Nie działa / błędne pliki",
  misleading: "Wprowadza w błąd (opis, nazwa, wymagania)",
  license: "Problem z licencją lub prawami autorskimi",
  spam: "Spam lub duplikat",
  other: "Inny powód",
};

const STANDARD_TEXTS: Record<string, string> = {
  impersonation_name: "Nazwa jest taka sama jak oficjalnego modelu LemonAI. Wybierz własną nazwę.",
  impersonation_author: "Wpis społeczności nie może podawać się za LemonAI ani za oficjalny.",
  short_description: "Opisz, co robi model i czego potrzebuje (co najmniej 40 znaków).",
  no_preview_image: "Dodaj obrazek podglądu.",
  no_license: "Podaj licencję wag modelu.",
  no_checksum: "Plik wag nie ma sumy SHA-256, więc zmieniony plik w repozytorium zostałby zainstalowany bez sprawdzenia.",
  unrealistic_requirements: "Model tylko na GPU musi wymagać więcej niż 0 GB VRAM.",
};

export function standardText(issue: StandardIssue): string {
  return STANDARD_TEXTS[issue.code] ?? issue.message;
}

const ACTION_LABELS: Record<string, string> = {
  approve: "zatwierdził",
  reject: "odrzucił",
  delete: "usunął",
  curate: "oznaczył jako polecany",
  uncurate: "zdjął oznaczenie polecanego",
  auto_hold: "wstrzymano automatycznie (zgłoszenia)",
  report_resolve: "zamknął zgłoszenie (rozwiązane)",
  report_dismiss: "odrzucił zgłoszenie",
  ban: "zablokował",
  unban: "odblokował",
  role_admin: "nadał rolę administratora",
  role_user: "odebrał rolę administratora",
  appeal: "odwołał się od decyzji",
  reset_code: "wygenerował kod resetu hasła dla",
  release_publish: "opublikował wydanie aplikacji",
  release_withdraw: "wycofał wydanie aplikacji",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";

  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("pl-PL");
}
