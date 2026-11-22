import { useEffect, useRef } from "react";
import { extensionForDataUrl, type ExportImageFormat } from "@/components/output/ModelOutputViewer";
import { useModalLayer } from "@/components/ui/modal";
import { fmt, useI18n } from "@/lib/i18n";

export function Lightbox({
  images,
  index,
  onIndex,
  onClose,
  onDownload,
  meta,
}: {
  images: string[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onDownload: (dataUrl: string, index: number, format: ExportImageFormat) => void;

  meta?: string;
}) {
  const image = images[index];
  const several = images.length > 1;
  const dialogRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useModalLayer({ isOpen: Boolean(image), closeOnEsc: true, onClose, dialogRef });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onIndex]);

  if (!image) return null;
  const side =
    "h-11 shrink-0 cursor-pointer rounded-xl border-2 border-foreground bg-transparent px-4 text-sm font-bold text-foreground disabled:cursor-not-allowed disabled:opacity-35";
  const save =
    "h-12 cursor-pointer rounded-xl border-2 border-foreground bg-transparent px-5 text-sm font-bold text-foreground hover:bg-secondary";

  return (
    <div
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightbox-title"
        tabIndex={-1}
        className="relative flex max-h-[94vh] w-full max-w-[860px] flex-col gap-5 overflow-y-auto rounded-[28px] bg-card p-8 text-card-foreground shadow-pop outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="absolute right-6 top-6 flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="pr-12">
          <h2 id="lightbox-title" className="font-display text-[26px] font-extrabold leading-tight tracking-[-0.01em]">
            {fmt(t("lightboxTitle"), { index: index + 1 })}
          </h2>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {t("lightboxSubtitle")}
            <span className="sr-only">
              {" "}
              {fmt(t("lightboxFrameInfo"), {
                index: index + 1,
                total: images.length,
                format: extensionForDataUrl(image).toUpperCase(),
              })}
            </span>
          </p>
        </div>

        <div className="flex items-center justify-between gap-5">
          {several ? (
            <button type="button" aria-label={t("lightboxPrevAria")} disabled={index === 0} onClick={() => onIndex(index - 1)} className={side}>
              {t("lightboxPrev")}
            </button>
          ) : (
            <span className="w-[124px] shrink-0" />
          )}
          <img
            src={image}
            alt={fmt(t("lightboxImageAlt"), { index: index + 1 })}
            className="max-h-[52vh] min-w-0 max-w-full select-none rounded-[18px] object-contain"
          />
          {several ? (
            <button
              type="button"
              aria-label={t("lightboxNextAria")}
              disabled={index === images.length - 1}
              onClick={() => onIndex(index + 1)}
              className={side}
            >
              {t("lightboxNext")}
            </button>
          ) : (
            <span className="w-[120px] shrink-0" />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <span className="font-mono text-xs text-muted-foreground">{meta}</span>
          <div className="flex gap-3">
            <button type="button" className={save} onClick={() => onDownload(image, index, "png")}>
              {fmt(t("lightboxDownload"), { format: "PNG" })}
            </button>
            <button type="button" className={save} onClick={() => onDownload(image, index, "webp")}>
              {fmt(t("lightboxDownload"), { format: "WebP" })}
            </button>
            <button type="button" className={save} onClick={() => onDownload(image, index, "jpeg")}>
              {fmt(t("lightboxDownload"), { format: "JPEG" })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
