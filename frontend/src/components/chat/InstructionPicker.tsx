import { useEffect, useId, useRef, useState } from "react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { fmt, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { countWords, estimateTokens, type Instruction, type UseInstructions } from "@/lib/instructions";

type DialogState =
  | { mode: "new"; name: string; text: string }
  | { mode: "edit"; source: Instruction }
  | { mode: "view"; source: Instruction };

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function InstructionOption({
  item,
  selected,
  onPick,
}: {
  item: Instruction;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={cn(
        "block w-full rounded-[10px] px-3 py-2 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-soft" : "hover:bg-secondary"
      )}
    >
      <span className="flex items-center justify-between gap-2 text-sm font-bold">
        {item.name}
        {selected && <span className="text-ink"><CheckIcon /></span>}
      </span>
      <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{item.snippet}</span>
    </button>
  );
}

function InstructionDialog({
  state,
  onClose,
  instructions,
}: {
  state: DialogState;
  onClose: () => void;
  instructions: UseInstructions;
}) {
  const { t } = useI18n();
  const readOnly = state.mode === "view";
  const source = state.mode === "new" ? null : state.source;
  const [name, setName] = useState(state.mode === "new" ? state.name : state.source.name);
  const [text, setText] = useState(state.mode === "new" ? state.text : state.source.text);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameId = useId();
  const textId = useId();
  const canSave = name.trim() !== "" && text.trim() !== "";

  const title =
    state.mode === "new" ? t("instrNewTitle") : state.mode === "edit" ? t("instrEditTitle") : state.source.name;

  const save = () => {
    if (!canSave) return;
    if (state.mode === "edit") {
      instructions.update(state.source.id, name, text);
      instructions.select(state.source.id);
    } else {
      instructions.create(name, text);
    }
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {readOnly && <p className="text-sm text-muted-foreground">{t("instrReadOnly")}</p>}
        <div>
          <label htmlFor={nameId} className="mb-1.5 block text-[13px] font-bold">
            {t("instrName")}
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            readOnly={readOnly}
            placeholder={t("instrNamePh")}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              "h-12 w-full rounded-xl border border-input px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              readOnly ? "bg-background text-muted-foreground" : "bg-background"
            )}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={textId} className="text-[13px] font-bold">
              {t("instrText")}
            </label>
            <span className="font-mono text-xs text-muted-foreground">
              {fmt(t("instrCounter"), { w: countWords(text), t: estimateTokens(text) })}
            </span>
          </div>
          <textarea
            id={textId}
            rows={8}
            value={text}
            readOnly={readOnly}
            placeholder={t("instrTextPh")}
            onChange={(e) => setText(e.target.value)}
            className={cn(
              "w-full resize-y rounded-xl border border-input px-3.5 py-3 text-[15px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              readOnly ? "bg-background text-muted-foreground resize-none" : "bg-background"
            )}
          />
        </div>
      </div>
      <ModalFooter className="justify-between">
        <div>
          {state.mode === "edit" && source && (
            <button
              type="button"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                instructions.remove(source.id);
                onClose();
              }}
              className="text-sm font-semibold text-destructive underline cursor-pointer"
            >
              {confirmDelete ? t("chatDeleteConfirm") : t("instrDelete")}
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? t("close") : t("cancel")}
          </Button>
          {readOnly && source ? (
            <Button
              type="button"
              onClick={() => {

                setName(`${source.name} ${t("instrCopySuffix")}`);
                instructions.create(`${source.name} ${t("instrCopySuffix")}`, source.text);
                onClose();
              }}
            >
              {t("instrCopyEdit")}
            </Button>
          ) : (
            <Button type="button" onClick={save} disabled={!canSave}>
              {t("instrSaveUse")}
            </Button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
}

export function InstructionPicker({ instructions, disabled = false }: { instructions: UseInstructions; disabled?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const { builtin, mine, selected } = instructions;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const target =
      root?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
      root?.querySelector<HTMLElement>('[role="option"]');
    target?.focus();
  }, [open]);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const options = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const index = options.findIndex((o) => o === document.activeElement);
    const next = e.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
    options[next]?.focus();
  };

  const pick = (item: Instruction) => {
    instructions.select(item.id);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <section
      ref={rootRef}
      aria-label={t("instrLabel")}
      className="relative rounded-2xl border border-border bg-card p-4"
    >
      <div className="mb-2.5 flex items-center gap-2 text-sm font-bold">
        <span id={`${listId}-label`}>{t("instrLabel")}</span>
        <InfoTip text={t("instrTip")} align="left" />
      </div>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${listId}-label`}
        data-testid="instruction-select"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-xl border border-foreground bg-background px-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate text-left font-bold">{selected.name}</span>
        <span className="text-xs text-muted-foreground">
          {selected.builtin ? t("instrTagBuiltin") : t("instrTagMine")}
        </span>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          id={listId}
          aria-label={t("instrListLabel")}
          onKeyDown={onListKeyDown}
          className="absolute inset-x-3 top-[110px] z-30 rounded-2xl border border-border bg-popover p-2 shadow-pop"
        >
          <div className="px-3 pb-1 pt-1.5 text-[11.5px] font-bold tracking-wide text-muted-foreground">
            {t("instrBuiltinGroup")}
          </div>
          {builtin.map((item) => (
            <InstructionOption key={item.id} item={item} selected={item.id === selected.id} onPick={() => pick(item)} />
          ))}
          {mine.length > 0 && (
            <>
              <div className="mt-1.5 border-t border-border px-3 pb-1 pt-2.5 text-[11.5px] font-bold tracking-wide text-muted-foreground">
                {t("instrMineGroup")}
              </div>
              {mine.map((item) => (
                <InstructionOption key={item.id} item={item} selected={item.id === selected.id} onPick={() => pick(item)} />
              ))}
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setDialog({ mode: "new", name: "", text: "" });
            }}
            className="mt-1.5 flex w-full cursor-pointer items-center gap-2.5 border-t border-border px-3 pb-2 pt-3 text-left text-sm font-bold"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("instrNew")}
          </button>
        </div>
      )}

      <div className="mt-3 rounded-xl bg-background px-3.5 py-3" data-testid="instruction-preview">
        <div className="text-[11.5px] font-bold tracking-wide text-muted-foreground">{t("instrPreview")}</div>
        <p className="mt-1.5 line-clamp-4 text-[13px] leading-relaxed">
          {selected.text.trim() === "" ? t("instrNoneText") : selected.text}
        </p>
      </div>
      <div className="mt-3 flex gap-4 text-[13px] font-semibold">
        {selected.id !== "none" && (
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => setDialog(selected.builtin ? { mode: "view", source: selected } : { mode: "edit", source: selected })}
          >
            {selected.builtin ? t("instrShowAll") : t("instrEdit")}
          </button>
        )}
        <button type="button" className="cursor-pointer underline" onClick={() => setDialog({ mode: "new", name: "", text: "" })}>
          {t("instrNew")}
        </button>
      </div>

      {dialog && <InstructionDialog state={dialog} onClose={() => setDialog(null)} instructions={instructions} />}
    </section>
  );
}
