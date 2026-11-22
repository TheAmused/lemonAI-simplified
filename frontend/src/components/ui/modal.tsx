import React, { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface OpenModalEntry {
  id: number;
  closeOnEsc: boolean;
  onClose: () => void;
  dialogRef: React.RefObject<HTMLElement | null>;
}

let nextModalId = 1;
const openModalStack: OpenModalEntry[] = [];
let previousBodyOverflow: string | null = null;
let keydownListenerAttached = false;

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest("[hidden]") && !el.closest('[aria-hidden="true"]')
  );
}

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (openModalStack.length === 0) return;
  const top = openModalStack[openModalStack.length - 1];
  if (e.key === "Escape") {
    if (top.closeOnEsc) {
      e.preventDefault();
      e.stopImmediatePropagation();
      top.onClose();
    }
    return;
  }
  if (e.key === "Tab") {
    const dialog = top.dialogRef.current;
    if (!dialog) return;
    const focusables = getFocusableElements(dialog);
    if (focusables.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (!active || active === first || !dialog.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
}

function registerModal(entry: OpenModalEntry) {
  if (openModalStack.length === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!keydownListenerAttached) {
      window.addEventListener("keydown", handleGlobalKeyDown);
      keydownListenerAttached = true;
    }
  }
  openModalStack.push(entry);
}

function unregisterModal(id: number) {
  const idx = openModalStack.findIndex((m) => m.id === id);
  if (idx !== -1) {
    openModalStack.splice(idx, 1);
  }
  if (openModalStack.length === 0) {
    document.body.style.overflow = previousBodyOverflow ?? "";
    previousBodyOverflow = null;
    if (keydownListenerAttached) {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      keydownListenerAttached = false;
    }
  }
}

export function useModalLayer({
  isOpen,
  closeOnEsc = true,
  onClose,
  dialogRef,
}: {
  isOpen: boolean;
  closeOnEsc?: boolean;
  onClose: () => void;
  dialogRef: React.RefObject<HTMLElement | null>;
}) {
  const entryRef = useRef<OpenModalEntry | null>(null);
  if (!entryRef.current) {
    entryRef.current = { id: nextModalId++, closeOnEsc, onClose, dialogRef };
  }
  entryRef.current.closeOnEsc = closeOnEsc;
  entryRef.current.onClose = onClose;
  entryRef.current.dialogRef = dialogRef;

  useEffect(() => {
    if (!isOpen) return;
    const entry = entryRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    registerModal(entry);

    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const focusables = getFocusableElements(dialog);
      (focusables[0] ?? dialog).focus();
    }

    return () => {
      unregisterModal(entry.id);
      if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [isOpen, dialogRef]);
}

export type ModalVariant = "default" | "destructive" | "warning";
export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;

  description?: React.ReactNode;
  variant?: ModalVariant;
  size?: ModalSize;
  children: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
  closeOnOutsideClick?: boolean;
  closeOnEsc?: boolean;
  "aria-labelledby"?: string;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-[520px]",
  md: "max-w-[560px]",
  lg: "max-w-[640px]",
  xl: "max-w-[720px]",
  "2xl": "max-w-[760px]",
};

const VARIANT_BORDER_CLASSES: Record<ModalVariant, string> = {
  default: "border-border",
  destructive: "border-destructive/40",
  warning: "border-warn/40",
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  variant = "default",
  size = "md",
  children,
  className,
  showCloseButton = true,
  closeOnOutsideClick = true,
  closeOnEsc = true,
  "aria-labelledby": ariaLabelledBy,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const generatedTitleId = useId();
  const titleId = ariaLabelledBy ?? generatedTitleId;
  useModalLayer({ isOpen, closeOnEsc, onClose, dialogRef });

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOutsideClick && dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  return (
    <div
      role="presentation"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 animate-in fade-in-0 duration-150"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "w-full bg-card border rounded-[28px] shadow-pop px-9 pb-7 pt-8 text-card-foreground relative flex flex-col max-h-[90vh] outline-none animate-in zoom-in-95 duration-150",
          SIZE_CLASSES[size],
          VARIANT_BORDER_CLASSES[variant],
          className
        )}
      >
        {(title || showCloseButton) && (
          <div className={cn("flex items-start gap-4", title ? "mb-5" : "absolute right-5 top-5 z-10")}>
            {title && (
              <div className="min-w-0 flex-1">
                <h2
                  id={titleId}
                  className={cn(
                    "m-0 font-display font-extrabold leading-[1.12] tracking-[-0.02em] text-foreground",
                    size === "sm" || size === "md" ? "text-[28px]" : "text-[34px]"
                  )}
                >
                  {title}
                </h2>
                {description && (
                  <p className="mt-2 text-sm leading-normal text-muted-foreground">{description}</p>
                )}
              </div>
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Zamknij"
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 -mx-2">
          {children}
        </div>
      </div>
    </div>
  );
}

export function ModalHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("mb-4 flex items-center justify-between", className)}>{children}</div>;
}

export function ModalBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("flex-1 overflow-y-auto space-y-4", className)}>{children}</div>;
}

export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-5 pt-5 border-t border-border flex items-center justify-end gap-3", className)}>
      {children}
    </div>
  );
}
