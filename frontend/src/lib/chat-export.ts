import type { Conversation } from "@/lib/ipc";

function readable(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return content;
  try {
    const parts = JSON.parse(trimmed) as Array<Record<string, unknown>>;
    if (!Array.isArray(parts)) return content;
    return parts
      .map((p) =>
        p.type === "text" && typeof p.text === "string"
          ? p.text
          : p.type === "image_url"
            ? "_[obraz]_"
            : p.type === "input_audio"
              ? "_[nagranie]_"
              : ""
      )
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return content;
  }
}

export function conversationToMarkdown(conversation: Conversation, modelName: string): string {
  const lines: string[] = [`# ${conversation.title || "Rozmowa"}`, ""];
  lines.push(`_Model: ${modelName} · ${new Date(conversation.created_at).toLocaleString("pl-PL")}_`, "");
  if (conversation.system_prompt) lines.push("> **Instrukcja systemowa:** " + conversation.system_prompt.replace(/\n/g, "\n> "), "");
  for (const message of conversation.messages) {
    lines.push(message.role === "user" ? "## Ty" : "## Model", "");
    if (message.role === "assistant" && message.reasoning) {
      lines.push("<details><summary>Rozumowanie</summary>", "", message.reasoning.trim(), "", "</details>", "");
    }
    lines.push(readable(message.content).trim(), "");
    if (message.role === "assistant" && message.web_search?.sources.length) {
      const safeSources = message.web_search.sources.filter((s) => /^https?:\/\//i.test(s.url));
      if (safeSources.length) {
        lines.push("**Źródła internetowe:**");
        for (const s of safeSources) {
          const title = (s.title || s.domain || s.url).replace(/[\[\]\r\n]/g, " ");
          lines.push(`${s.index}. [${title}](${s.url})`);
        }
        lines.push("");
      }
    }
    if (message.interrupted) lines.push("_(przerwano)_", "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function exportFileName(conversation: Conversation): string {
  const base = (conversation.title || "rozmowa")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "rozmowa"}.md`;
}
