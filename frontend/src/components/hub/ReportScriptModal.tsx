import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { DialogError, DialogField, DialogFooter } from "@/components/ui/dialog-parts";
import { dialogInput, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { cn } from "@/lib/utils";
import { HubApiError, apiReportScript, type HubScript, type ReportReason } from "@/lib/hub-api";
import { REPORT_REASON_LABELS } from "@/lib/moderation";

const REASONS = Object.keys(REPORT_REASON_LABELS) as ReportReason[];

export function ReportScriptModal({
  script,
  onClose,
  onReported,
}: {
  script: HubScript;
  onClose: () => void;
  onReported: (message: string) => void;
}) {
  const [reason, setReason] = useState<ReportReason>("broken");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsDetails = reason === "other" && !details.trim();

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await apiReportScript(script.slug || script.id, reason, details);
      onReported(`Dziękujemy. Zgłoszenie modelu ${script.name} trafiło do moderatorów.`);
    } catch (err: unknown) {
      if (err instanceof HubApiError && err.code === "already_reported") {
        onReported(`Ten model został już przez Ciebie zgłoszony; moderator się nim zajmie.`);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setSending(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Zgłoś: ${script.name}`}
      description="Zgłoszenie trafia do moderatorów LemonAI Hub. Wpisy zgłoszone przez kilka osób są ukrywane do czasu przeglądu."
      variant="warning"
      size="md"
      aria-labelledby="report-title"
    >
      <div className="flex flex-col gap-[18px]">
        <fieldset role="radiogroup" aria-label="Powód" className="m-0 flex flex-col border-0 p-0">
          <legend className="mb-1 p-0 text-[13px] font-bold">Powód</legend>
          {REASONS.map((value) => (
            <label key={value} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14.5px]">
              <input
                type="radio"
                name="report-reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
                className="h-[18px] w-[18px] accent-[hsl(var(--line))]"
              />
              <span>{REPORT_REASON_LABELS[value]}</span>
            </label>
          ))}
        </fieldset>
        <DialogField label={`Szczegóły zgłoszenia${reason === "other" ? "" : " (opcjonalnie)"}`}>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 2000))}
            rows={3}
            aria-label="Szczegóły zgłoszenia"
            className={cn(dialogInput, "h-auto min-h-[96px] resize-y px-3.5 py-3 leading-normal")}
            placeholder="Co jest nie tak? Np. która część opisu się nie zgadza albo jaki błąd pojawia się przy instalacji."
          />
        </DialogField>
        {error && <DialogError>{error}</DialogError>}
      </div>
      <DialogFooter>
        <button type="button" className={outlineButton} onClick={onClose} disabled={sending}>
          Anuluj
        </button>
        <button type="button" className={primaryButton} onClick={() => void send()} disabled={sending || needsDetails}>
          {sending ? "Wysyłanie…" : "Wyślij zgłoszenie"}
        </button>
      </DialogFooter>
    </Modal>
  );
}
