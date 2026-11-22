import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { DialogError, DialogField, DialogFooter } from "@/components/ui/dialog-parts";
import { dialogInput, outlineButton, primaryButton } from "@/components/ui/form-styles";
import { StatusBadge } from "@/components/hub/ModerationBits";
import { apiPostScriptMessage, apiScriptMessages, type ScriptMessage, type ScriptStatus } from "@/lib/hub-api";
import { formatDate } from "@/lib/moderation";
import { cn } from "@/lib/utils";

export function useScriptConversation(
  slug: string,
  asModerator: boolean,
  onStatusChange?: (status: ScriptStatus) => void
) {
  const [messages, setMessages] = useState<ScriptMessage[] | null>(null);
  const [status, setStatus] = useState<ScriptStatus>("published");
  const [text, setText] = useState("");
  const [requestReview, setRequestReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessages(null);
    setError(null);
    try {
      const data = await apiScriptMessages(slug);
      setMessages(data.messages);
      setStatus(data.status);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const appeal = !asModerator && status === "rejected" && requestReview;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPostScriptMessage(slug, text.trim(), appeal);
      setText("");
      setMessages((prev) => [...(prev ?? []), result.message]);
      if (result.status !== status) {
        setStatus(result.status);
        onStatusChange?.(result.status);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return { messages, status, text, setText, requestReview, setRequestReview, busy, error, appeal, send, reload: load };
}

export function MessageBubble({
  message,
  asModerator,
  compact,
  authorOnRight,
}: {
  message: ScriptMessage;
  asModerator: boolean;
  compact?: boolean;

  authorOnRight?: boolean;
}) {
  const mine = asModerator ? message.from_moderator : !message.from_moderator;
  return (
    <li className={cn("max-w-[85%] rounded-[20px] px-4 py-3", (authorOnRight ? !message.from_moderator : mine) ? "ml-auto bg-soft" : "bg-secondary")}>
      <p className="m-0 mb-0.5 text-xs font-bold">
        {mine ? "Ty" : message.from_moderator ? "Moderator" : message.author ?? "autor"}
        {" · "}
        <span className="font-normal text-muted-foreground">{formatDate(message.created_at)}</span>
      </p>
      <p className={cn("m-0 whitespace-pre-wrap break-words leading-normal", compact ? "text-sm" : "text-[14.5px]")}>{message.body}</p>
    </li>
  );
}

export function MessagesModal({
  script,
  asModerator,
  onClose,
  onStatusChange,
}: {
  script: { slug: string; name: string };
  asModerator: boolean;
  onClose: () => void;
  onStatusChange?: (status: ScriptStatus) => void;
}) {
  const { messages, status, text, setText, requestReview, setRequestReview, busy, error, appeal, send } =
    useScriptConversation(script.slug, asModerator, onStatusChange);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Wiadomości: ${script.name}`}
      description={
        asModerator
          ? "Rozmowa z autorem wpisu."
          : "Rozmowa z moderatorami LemonAI Hub. Odpowiedź dostaniesz w powiadomieniach i e-mailem."
      }
      size="lg"
      aria-labelledby="messages-title"
    >
      <div className="flex flex-col gap-4">
        <StatusBadge status={status} />
        <ul className="m-0 flex max-h-80 list-none flex-col gap-3 overflow-y-auto p-0" aria-label="Wiadomości">
          {messages === null ? (
            <li className="text-sm text-muted-foreground">Wczytywanie…</li>
          ) : messages.length === 0 ? (
            <li className="text-sm text-muted-foreground">Brak wiadomości.</li>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} asModerator={asModerator} />)
          )}
        </ul>
      </div>

      <div className="mt-5 flex flex-col gap-3.5 border-t border-border pt-5">
        <DialogField label="Nowa wiadomość">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 4000))}
            rows={3}
            aria-label="Nowa wiadomość"
            placeholder={asModerator ? "Odpowiedź dla autora…" : "Np. wyjaśnij, co poprawiłeś albo dlaczego decyzja jest błędna…"}
            className={cn(dialogInput, "h-auto min-h-[96px] resize-y px-3.5 py-3 leading-normal")}
          />
        </DialogField>
        {!asModerator && status === "rejected" && (
          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={requestReview}
              onChange={(e) => setRequestReview(e.target.checked)}
              className="h-[18px] w-[18px] accent-[hsl(var(--line))]"
            />
            <span>Poproś o ponowny przegląd (odwołanie)</span>
          </label>
        )}
        {error && <DialogError>{error}</DialogError>}
      </div>
      <DialogFooter>
        <button type="button" className={outlineButton} onClick={onClose}>
          Zamknij
        </button>
        <button type="button" className={primaryButton} onClick={() => void send()} disabled={busy || !text.trim()}>
          {busy ? "Wysyłanie…" : appeal ? "Wyślij odwołanie" : "Wyślij"}
        </button>
      </DialogFooter>
    </Modal>
  );
}
