import { cn } from "@/lib/utils";

export const fieldLabel = "text-[13px] font-bold";
export const fieldInput =
  "h-12 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none disabled:opacity-50";
export const fieldSelect = cn(fieldInput, "cursor-pointer");
export const outlineButton =
  "h-12 cursor-pointer rounded-[14px] border-2 border-foreground bg-transparent px-5 text-sm font-bold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButton =
  "h-12 cursor-pointer rounded-[14px] bg-primary px-6 text-sm font-extrabold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50";
export const linkButton = "cursor-pointer border-0 bg-transparent p-0 text-sm font-bold text-foreground underline";

export const dialogInput = fieldInput.replace("bg-card", "bg-background");
export const dialogSelect = cn(dialogInput, "cursor-pointer");
