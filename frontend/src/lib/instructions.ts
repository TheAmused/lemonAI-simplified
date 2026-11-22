import { useCallback, useMemo, useState } from "react";
import { useI18n, type Translations } from "@/lib/i18n";

export interface Instruction {
  id: string;
  name: string;
  text: string;

  builtin: boolean;

  snippet: string;
}

export const INSTRUCTIONS_KEY = "lemonai.chat.instructions";

export const INSTRUCTION_SELECTED_KEY = "lemonai.chat.instruction";

export const NO_INSTRUCTION_ID = "none";
export const MODEL_DEFAULT_INSTRUCTION_ID = "model-default";

interface StoredInstruction {
  id: string;
  name: string;
  text: string;
}

function oneLine(text: string, max = 48): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function estimateTokens(text: string): number {
  return Math.round(countWords(text) * 1.5);
}

export function builtinInstructions(t: (key: keyof Translations) => string, modelDefault?: string): Instruction[] {
  const list: Instruction[] = [];
  if (modelDefault && modelDefault.trim() !== "") {
    list.push({
      id: MODEL_DEFAULT_INSTRUCTION_ID,
      name: t("instrModelDefault"),
      text: modelDefault,
      builtin: true,
      snippet: oneLine(modelDefault),
    });
  }
  list.push(
    { id: NO_INSTRUCTION_ID, name: t("instrNoneName"), text: "", builtin: true, snippet: t("instrNoneSnippet") },
    { id: "concise", name: t("instrConciseName"), text: t("instrConciseText"), builtin: true, snippet: t("instrConciseSnippet") },
    { id: "translator", name: t("instrTranslatorName"), text: t("instrTranslatorText"), builtin: true, snippet: t("instrTranslatorSnippet") },
    { id: "tutor", name: t("instrTutorName"), text: t("instrTutorText"), builtin: true, snippet: t("instrTutorSnippet") },
    { id: "developer", name: t("instrDeveloperName"), text: t("instrDeveloperText"), builtin: true, snippet: t("instrDeveloperSnippet") },
    { id: "editor", name: t("instrEditorName"), text: t("instrEditorText"), builtin: true, snippet: t("instrEditorSnippet") }
  );
  return list;
}

export function loadCustomInstructions(): StoredInstruction[] {
  try {
    const raw = localStorage.getItem(INSTRUCTIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredInstruction =>
        !!item &&
        typeof item === "object" &&
        typeof (item as StoredInstruction).id === "string" &&
        typeof (item as StoredInstruction).name === "string" &&
        typeof (item as StoredInstruction).text === "string"
    );
  } catch {
    return [];
  }
}

function saveCustomInstructions(list: StoredInstruction[]): void {
  try {
    localStorage.setItem(INSTRUCTIONS_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the instructions last for this session only.
  }
}

function loadSelectedId(): string | null {
  try {
    return localStorage.getItem(INSTRUCTION_SELECTED_KEY);
  } catch {
    return null;
  }
}

function saveSelectedId(id: string): void {
  try {
    localStorage.setItem(INSTRUCTION_SELECTED_KEY, id);
  } catch {
    // ignore storage errors
  }
}

function newId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface UseInstructions {
  builtin: Instruction[];
  mine: Instruction[];
  selected: Instruction;
  select: (id: string) => void;

  create: (name: string, text: string) => Instruction;
  update: (id: string, name: string, text: string) => void;
  remove: (id: string) => void;
}

export function useInstructions(modelDefault?: string): UseInstructions {
  const { t, lang } = useI18n();
  const [custom, setCustom] = useState<StoredInstruction[]>(() => loadCustomInstructions());
  const [selectedId, setSelectedId] = useState<string | null>(() => loadSelectedId());

  const builtin = useMemo(() => builtinInstructions(t, modelDefault), [lang, modelDefault]); 
  const mine = useMemo<Instruction[]>(
    () => custom.map((c) => ({ ...c, builtin: false, snippet: oneLine(c.text) })),
    [custom]
  );

  const selected = useMemo<Instruction>(() => {
    const all = [...builtin, ...mine];
    const found = selectedId ? all.find((i) => i.id === selectedId) : undefined;
    if (found) return found;
    return all.find((i) => i.id === MODEL_DEFAULT_INSTRUCTION_ID) ?? all.find((i) => i.id === NO_INSTRUCTION_ID) ?? all[0];
  }, [builtin, mine, selectedId]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    saveSelectedId(id);
  }, []);

  const create = useCallback((name: string, text: string): Instruction => {
    const entry: StoredInstruction = { id: newId(), name: name.trim(), text };
    setCustom((prev) => {
      const next = [...prev, entry];
      saveCustomInstructions(next);
      return next;
    });
    setSelectedId(entry.id);
    saveSelectedId(entry.id);
    return { ...entry, builtin: false, snippet: oneLine(entry.text) };
  }, []);

  const update = useCallback((id: string, name: string, text: string) => {
    setCustom((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, name: name.trim(), text } : c));
      saveCustomInstructions(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setCustom((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveCustomInstructions(next);
      return next;
    });
    setSelectedId((current) => {
      if (current !== id) return current;
      saveSelectedId(NO_INSTRUCTION_ID);
      return NO_INSTRUCTION_ID;
    });
  }, []);

  return { builtin, mine, selected, select, create, update, remove };
}
