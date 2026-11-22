import { useEffect, useMemo, useRef } from "react";
import type { ModelPackageManifest } from "@/types/manifest";
import { DynamicInferenceForm } from "@/components/forms/DynamicInferenceForm";
import { ModelOutputViewer, getLogLevel, type InferenceMetrics } from "@/components/output/ModelOutputViewer";
import {
  AudioStage,
  EmptyStage,
  GeneratingStage,
  ImageStage,
  JsonStage,
  LogDrawer,
  RecentAudio,
  RecentImages,
  useRecent,
  type Progress,
} from "@/components/studio/StudioStages";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const COMPOSER_WIDGETS = new Set(["textarea", "text", "select", "slider", "number", "seed", "switch", "file_upload"]);

export function studioLayout(model: ModelPackageManifest): "composer" | "form" {
  const ui = model.ui;
  if (ui.presets?.length || ui.sections?.length) return "form";
  const inputs = ui.inputs ?? [];
  if (inputs.length === 0 || inputs.length > 6) return "form";
  if (!inputs.every((i) => COMPOSER_WIDGETS.has(i.widget))) return "form";

  const texts = inputs.filter((i) => i.widget === "textarea" || i.widget === "text").length;
  const files = inputs.filter((i) => i.widget === "file_upload").length;
  return texts <= 1 && files <= 1 && texts + files >= 1 ? "composer" : "form";
}

export type OutputKind = "image" | "audio" | "json" | "text";

export function outputKind(model: ModelPackageManifest): OutputKind {
  const type = model.ui.output?.type;
  return type === "image" || type === "audio" || type === "json" ? type : "text";
}

export interface StudioWorkspaceProps {
  model: ModelPackageManifest;

  header: React.ReactNode;
  submitLabel: string;
  onExecute: (payload: Record<string, unknown>, signal: AbortSignal) => Promise<void>;
  isExecuting: boolean;
  presetValues: Record<string, unknown> | null;
  presetKey: number;
  tokens: string;
  images: string[];
  audios: string[];
  jsonValues: unknown[];
  logs: string[];
  logOpen: boolean;
  onClearLogs: () => void;
  isStreaming: boolean;
  progress: Progress;
  metrics: InferenceMetrics | null;

  lastParams: Record<string, unknown> | null;
  onOpenHistory: () => void;
}

export function StudioWorkspace(props: StudioWorkspaceProps) {
  const { t } = useI18n();
  const { model, isStreaming, images, audios, jsonValues, tokens } = props;
  const declared = outputKind(model);

  const kind: OutputKind = tokens.trim() ? "text" : declared;
  const layout = useMemo(() => studioLayout(model), [model]);
  const hasResult =
    (kind === "image" && images.length > 0) ||
    (kind === "audio" && audios.length > 0) ||
    (kind === "json" && jsonValues.length > 0) ||
    (kind === "text" && Boolean(tokens.trim()));

  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (layout === "form" && (isStreaming || hasResult)) stageRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [layout, isStreaming, hasResult]);
  const recentKind = declared === "audio" ? "audio" : "image";
  const recent = useRecent(model.id, recentKind, `${images.length}:${audios.length}:${isStreaming}`);

  const form = (
    <DynamicInferenceForm
      key={model.id}
      variant={layout === "composer" ? "composer" : "form"}
      inlineLabels={layout === "composer" && kind === "image"}
      schema={model.ui}
      onExecute={props.onExecute}
      isExecuting={props.isExecuting}
      submitLabel={props.submitLabel}
      presetValues={props.presetValues}
      presetKey={props.presetKey}
    />
  );

  const showLogsInStage = kind !== "json" && kind !== "text";

  const lastLog = props.logs[props.logs.length - 1];
  const failure = !props.logOpen && !isStreaming && lastLog && getLogLevel(lastLog) === "error" ? lastLog : null;

  let stage: React.ReactNode;
  if (kind === "text") {
    stage = (
      <ModelOutputViewer
        variant="stage"
        logsOpen={props.logOpen}
        tokens={tokens}
        images={images}
        audios={audios}
        jsonValues={jsonValues}
        logs={props.logs}
        isStreaming={isStreaming}
        progress={props.progress}
        metrics={props.metrics}
        onClearLogs={props.onClearLogs}
        className="flex-1 rounded-[26px]"
      />
    );
  } else {
    let body: React.ReactNode;
    if (isStreaming && !hasResult) body = <GeneratingStage progress={props.progress} />;
    else if (kind === "image" && images.length > 0)
      body = <ImageStage images={images} params={props.lastParams} metrics={props.metrics} onOpenHistory={props.onOpenHistory} />;
    else if (kind === "audio" && audios.length > 0)
      body = <AudioStage src={audios[audios.length - 1]} params={props.lastParams} onOpenHistory={props.onOpenHistory} />;
    else if (kind === "json" && (jsonValues.length > 0 || isStreaming))
      body = (
        <JsonStage
          values={jsonValues}
          tokens={tokens}
          metrics={props.metrics}
          logs={props.logs}
          showLogs={props.logOpen}
          isStreaming={isStreaming}
        />
      );
    else body = <EmptyStage kind={kind} />;
    stage = (
      <section aria-label={t("modelOutput")} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-border bg-card">
        {body}
        {failure && (
          <div role="alert" className="border-t border-border bg-destructive/10 px-6 py-3 font-mono text-xs text-destructive">
            {failure.replace(/^(\[[^\]]*\]\s*)*?\[ERROR\]\s*/i, "")}
          </div>
        )}
        {showLogsInStage && <LogDrawer logs={props.logs} className={props.logOpen ? undefined : "hidden"} />}
      </section>
    );
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[clamp(1200px,72vw,1800px)] flex-1 flex-col gap-[18px] overflow-y-auto px-8 pb-[22px] pt-6">
      {props.header}
      {layout === "composer" ? (
        <>
          <div className="flex min-h-[300px] flex-1 gap-5">
            {stage}
            {recentKind === "image" ? (
              <RecentImages entries={recent} onOpenHistory={props.onOpenHistory} />
            ) : (
              <RecentAudio entries={recent} onOpenHistory={props.onOpenHistory} />
            )}
          </div>
          {form}
        </>
      ) : (
        <>
          {form}
          {(hasResult || isStreaming || props.logOpen) && (
            <div ref={stageRef} className={cn("flex min-h-[320px] gap-5")}>{stage}</div>
          )}
        </>
      )}
    </div>
  );
}
