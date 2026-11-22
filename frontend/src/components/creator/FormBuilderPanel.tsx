import { useState } from "react";
import type {
  UIConfig,
  UIFormPreset,
  UIInputDefinition,
  UIOutputType,
  UIWidgetType,
} from "@/types/manifest";
import { useI18n, fmt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const ALL_WIDGET_TYPES: readonly UIWidgetType[] = [
  "text",
  "textarea",
  "slider",
  "switch",
  "select",
  "file_upload",
  "number",
  "color_picker",
  "radio_group",
  "checkbox_group",
  "json_editor",
  "tags_input",
  "seed",
  "dimensions",
];

const OUTPUT_TYPES: readonly UIOutputType[] = ["text", "markdown", "image", "audio", "json"];

export interface FormBuilderPanelProps {
  ui: UIConfig;
  onChange: (nextUi: UIConfig) => void;

  initialExpanded?: number;
}

const fieldCls =
  "w-full h-11 px-3 rounded-[10px] border border-input bg-background text-[13.5px] focus:outline-none focus:ring-2 focus:ring-primary";
const labelCls = "block text-[12.5px] font-bold mb-1.5";
const smallBtn =
  "h-9 px-3 rounded-[10px] border-[1.5px] border-foreground bg-transparent text-[13px] font-bold cursor-pointer hover:bg-secondary/60 disabled:opacity-40 disabled:cursor-not-allowed";

function defaultForWidget(widget: UIWidgetType): Partial<UIInputDefinition> {
  switch (widget) {
    case "slider":
      return { min: 0, max: 100, step: 1, default: 50 };
    case "number":
      return { min: 0, max: 1000, step: 1, default: 10 };
    case "switch":
      return { default: false };
    case "select":
    case "radio_group":
      return { options: ["Option A", "Option B"], default: "Option A" };
    case "checkbox_group":
      return { options: ["Tag A", "Tag B"], default: [] };
    case "color_picker":
      return { default: "#eab308" };
    case "seed":
      return { default: -1 };
    case "dimensions":
      return { default: "1024x1024" };
    case "tags_input":
      return { default: [] };
    case "json_editor":
      return { default: "{}" };
    case "file_upload":
      return { accept: "*/*" };
    default:
      return { default: "" };
  }
}

function formatOptions(options?: UIInputDefinition["options"]): string {
  if (!options || options.length === 0) return "";
  return options
    .map((o) => (typeof o === "string" ? o : String(o.value)))
    .join(", ");
}

function parseOptions(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDefaultValue(widget: UIWidgetType, raw: string): unknown {
  if (raw === "") return undefined;
  if (widget === "slider" || widget === "number" || widget === "seed") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (widget === "switch") {
    return raw === "true";
  }
  return raw;
}

export function FormBuilderPanel({ ui, onChange, initialExpanded = 0 }: FormBuilderPanelProps) {
  const { t } = useI18n();
  const [presetJsonDrafts, setPresetJsonDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<number | null>(
    ui.inputs.length > 0 ? Math.min(initialExpanded, ui.inputs.length - 1) : null
  );

  const updateInput = (index: number, patch: Partial<UIInputDefinition>) => {
    const next = ui.inputs.map((inp, i) => (i === index ? { ...inp, ...patch } : inp));
    onChange({ ...ui, inputs: next });
  };

  const replaceInput = (index: number, nextInput: UIInputDefinition) => {
    const next = ui.inputs.map((inp, i) => (i === index ? nextInput : inp));
    onChange({ ...ui, inputs: next });
  };

  const addInput = () => {
    const existingNames = new Set(ui.inputs.map((i) => i.name));
    let n = ui.inputs.length + 1;
    let candidate = `param_${n}`;
    while (existingNames.has(candidate)) {
      n += 1;
      candidate = `param_${n}`;
    }
    const created: UIInputDefinition = {
      name: candidate,
      label: `Parameter ${n}`,
      widget: "text",
      default: "",
    };
    onChange({ ...ui, inputs: [...ui.inputs, created] });
    setExpanded(ui.inputs.length);
  };

  const removeInput = (index: number) => {
    onChange({ ...ui, inputs: ui.inputs.filter((_, i) => i !== index) });
    setExpanded((cur) => {
      if (cur === null) return cur;
      const remaining = ui.inputs.length - 1;
      if (remaining <= 0) return null;
      return Math.min(cur === index ? Math.max(0, index - 1) : cur > index ? cur - 1 : cur, remaining - 1);
    });
  };

  const moveInput = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= ui.inputs.length) return;
    const next = [...ui.inputs];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange({ ...ui, inputs: next });
    setExpanded((cur) => (cur === index ? target : cur === target ? index : cur));
  };

  const presets = ui.presets ?? [];

  const addPreset = () => {
    const idx = presets.length + 1;
    const created: UIFormPreset = {
      id: `preset_${idx}`,
      label: `Preset ${idx}`,
      values: {},
    };
    onChange({ ...ui, presets: [...presets, created] });
  };

  const updatePreset = (index: number, patch: Partial<UIFormPreset>) => {
    const next = presets.map((p, i) => (i === index ? { ...p, ...patch } : p));
    onChange({ ...ui, presets: next });
  };

  const removePreset = (index: number) => {
    const next = presets.filter((_, i) => i !== index);
    onChange({ ...ui, presets: next.length > 0 ? next : undefined });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3.5">
        <h2 className="text-[15px] font-extrabold">{t("fbInputsTitle")}</h2>

        {ui.inputs.length === 0 && (
          <p className="text-sm text-muted-foreground rounded-2xl border border-dashed border-border p-4">
            {t("fbNoInputs")}
          </p>
        )}

        {ui.inputs.map((inp, idx) => {
          const isOpen = expanded === idx;
          if (!isOpen) {
            return (
              <div
                key={`${idx}-${inp.name}`}
                className="flex items-center gap-3.5 pl-[18px] pr-2 py-1.5 rounded-2xl bg-card border border-border hover:bg-secondary/40 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(idx)}
                  aria-expanded="false"
                  aria-label={`${t("creatorEditField")} ${inp.name}`}
                  className="flex-1 min-w-0 flex items-center gap-3.5 py-2 text-left cursor-pointer"
                >
                  <span className="font-mono text-[13.5px] font-medium flex-1 truncate">{inp.name}</span>
                  <span className="text-[13px] text-muted-foreground truncate">{inp.label}</span>
                  <span className="px-2 py-0.5 rounded-md bg-secondary text-xs font-bold">{inp.widget}</span>
                </button>
                <button
                  type="button"
                  disabled={idx === 0}
                  aria-label={`${t("fbMoveUp")} ${inp.name}`}
                  onClick={() => moveInput(idx, -1)}
                  className="h-[34px] w-[34px] text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={idx === ui.inputs.length - 1}
                  aria-label={`${t("fbMoveDown")} ${inp.name}`}
                  onClick={() => moveInput(idx, 1)}
                  className="h-[34px] w-[34px] text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  ↓
                </button>
              </div>
            );
          }

          const showNumeric = inp.widget === "slider" || inp.widget === "number";
          const showOptions =
            inp.widget === "select" || inp.widget === "radio_group" || inp.widget === "checkbox_group";
          const showChips = inp.widget === "text" || inp.widget === "textarea";
          const otherFields = ui.inputs.filter((_, i) => i !== idx).map((o) => o.name);

          return (
            <div
              key={`${idx}-${inp.name}`}
              aria-label={`${fmt(t("fbFieldNumber"), { n: idx + 1 })} ${inp.name}`}
              role="group"
              className="rounded-[20px] bg-card border-2 border-line px-[22px] py-5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground tracking-[.05em]">
                  {fmt(t("fbFieldNumber"), { n: idx + 1 })}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={idx === 0}
                  aria-label={`${t("fbMoveUp")} ${inp.name}`}
                  onClick={() => moveInput(idx, -1)}
                  className={smallBtn}
                >
                  {t("fbMoveUp")}
                </button>
                <button
                  type="button"
                  disabled={idx === ui.inputs.length - 1}
                  aria-label={`${t("fbMoveDown")} ${inp.name}`}
                  onClick={() => moveInput(idx, 1)}
                  className={smallBtn}
                >
                  {t("fbMoveDown")}
                </button>
                <button
                  type="button"
                  aria-label={`${t("delete")} ${inp.name}`}
                  onClick={() => removeInput(idx)}
                  className={cn(smallBtn, "border-destructive text-destructive hover:bg-destructive/10")}
                >
                  {t("delete")}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <label className="block">
                  <span className={labelCls}>{t("fbFieldName")}</span>
                  <input
                    type="text"
                    aria-label={`${t("fbFieldName")} ${idx + 1}`}
                    value={inp.name}
                    onChange={(e) => updateInput(idx, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })}
                    className={`${fieldCls} font-mono`}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>{t("fbFieldLabel")}</span>
                  <input
                    type="text"
                    aria-label={`${t("fbFieldLabel")} ${idx + 1}`}
                    value={inp.label}
                    onChange={(e) => updateInput(idx, { label: e.target.value })}
                    className={fieldCls}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>{t("fbFieldWidget")}</span>
                  <select
                    aria-label={`${t("fbFieldWidget")} ${idx + 1}`}
                    value={inp.widget}
                    onChange={(e) => {
                      const nextWidget = e.target.value as UIWidgetType;
                      replaceInput(idx, {
                        name: inp.name,
                        label: inp.label,
                        widget: nextWidget,
                        required: inp.required,
                        grid_cols: inp.grid_cols,
                        description: inp.description,
                        ...defaultForWidget(nextWidget),
                      });
                    }}
                    className={fieldCls}
                  >
                    {ALL_WIDGET_TYPES.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className={labelCls}>{t("fbFieldDefault")}</span>
                  <input
                    type="text"
                    aria-label={`${t("fbFieldDefault")} ${idx + 1}`}
                    value={inp.default === undefined ? "" : String(inp.default)}
                    onChange={(e) => updateInput(idx, { default: parseDefaultValue(inp.widget, e.target.value) })}
                    className={`${fieldCls} font-mono`}
                  />
                </label>

                {showNumeric && (
                  <>
                    <label className="block">
                      <span className={labelCls}>{t("fbFieldMin")}</span>
                      <input
                        type="number"
                        aria-label={`${t("fbFieldMin")} ${idx + 1}`}
                        value={inp.min ?? ""}
                        onChange={(e) =>
                          updateInput(idx, { min: e.target.value === "" ? undefined : Number(e.target.value) })
                        }
                        className={`${fieldCls} font-mono`}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("fbFieldMax")}</span>
                      <input
                        type="number"
                        aria-label={`${t("fbFieldMax")} ${idx + 1}`}
                        value={inp.max ?? ""}
                        onChange={(e) =>
                          updateInput(idx, { max: e.target.value === "" ? undefined : Number(e.target.value) })
                        }
                        className={`${fieldCls} font-mono`}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("fbFieldStep")}</span>
                      <input
                        type="number"
                        step="any"
                        aria-label={`${t("fbFieldStep")} ${idx + 1}`}
                        value={inp.step ?? ""}
                        onChange={(e) =>
                          updateInput(idx, { step: e.target.value === "" ? undefined : Number(e.target.value) })
                        }
                        className={`${fieldCls} font-mono`}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("fbFieldUnit")}</span>
                      <input
                        type="text"
                        aria-label={`${t("fbFieldUnit")} ${idx + 1}`}
                        value={inp.unit ?? ""}
                        onChange={(e) => updateInput(idx, { unit: e.target.value.trim() || undefined })}
                        placeholder="steps / px / s"
                        className={fieldCls}
                      />
                    </label>
                  </>
                )}

                <label className="block">
                  <span className={labelCls}>{t("fbFieldGridCols")}</span>
                  <select
                    aria-label={`${t("fbFieldGridCols")} ${idx + 1}`}
                    value={inp.grid_cols ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateInput(idx, { grid_cols: v ? (Number(v) as 1 | 2 | 3) : undefined });
                    }}
                    className={fieldCls}
                  >
                    <option value="">Auto</option>
                    <option value="1">1 / 3</option>
                    <option value="2">2 / 3</option>
                    <option value="3">Full (3 / 3)</option>
                  </select>
                </label>

                <label className="block sm:col-span-3">
                  <span className={labelCls}>{t("fbFieldDescription")}</span>
                  <input
                    type="text"
                    aria-label={`${t("fbFieldDescription")} ${idx + 1}`}
                    value={inp.description ?? ""}
                    onChange={(e) => updateInput(idx, { description: e.target.value || undefined })}
                    className={fieldCls}
                  />
                </label>

                {showOptions && (
                  <label className="block sm:col-span-3">
                    <span className={labelCls}>{t("fbFieldOptions")}</span>
                    <input
                      type="text"
                      value={formatOptions(inp.options)}
                      onChange={(e) => updateInput(idx, { options: parseOptions(e.target.value) })}
                      placeholder="Option 1, Option 2, Option 3"
                      className={fieldCls}
                    />
                  </label>
                )}

                {showChips && (
                  <label className="block sm:col-span-3">
                    <span className={labelCls}>{t("fbFieldQuickChips")}</span>
                    <input
                      type="text"
                      aria-label={`${t("fbFieldQuickChips")} ${idx + 1}`}
                      value={(inp.quick_chips ?? []).join(", ")}
                      onChange={(e) => {
                        const chips = parseOptions(e.target.value);
                        updateInput(idx, { quick_chips: chips.length > 0 ? chips : undefined });
                      }}
                      placeholder="cinematic lighting, 8k, trigger_word"
                      className={fieldCls}
                    />
                  </label>
                )}

                {inp.widget === "file_upload" && (
                  <label className="block sm:col-span-3">
                    <span className={labelCls}>{t("fbFieldAccept")}</span>
                    <input
                      type="text"
                      value={inp.accept ?? ""}
                      onChange={(e) => updateInput(idx, { accept: e.target.value.trim() || undefined })}
                      placeholder="audio/*, image/*"
                      className={fieldCls}
                    />
                  </label>
                )}

                <label className="flex items-center gap-2.5 text-sm font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(inp.required)}
                    onChange={(e) => updateInput(idx, { required: e.target.checked })}
                    className="h-[18px] w-[18px] accent-[hsl(var(--line))]"
                  />
                  <span>{t("fbFieldRequired")}</span>
                </label>
              </div>

              {otherFields.length > 0 && (
                <div className="pt-3.5 border-t border-border">
                  <div className="text-[12.5px] font-bold mb-2">{t("fbFieldDependsOn")}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <label className="block">
                      <span className={labelCls}>{t("fbFieldDependsOnField")}</span>
                      <select
                        aria-label={`${t("fbFieldDependsOnField")} ${idx + 1}`}
                        value={inp.depends_on?.field ?? ""}
                        onChange={(e) => {
                          const field = e.target.value;
                          if (!field) {
                            updateInput(idx, { depends_on: undefined });
                          } else {
                            updateInput(idx, {
                              depends_on: { field, equals: inp.depends_on?.equals ?? true },
                            });
                          }
                        }}
                        className={fieldCls}
                      >
                        <option value="">—</option>
                        {otherFields.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </label>
                    {inp.depends_on?.field && (
                      <label className="block">
                        <span className={labelCls}>{t("fbFieldDependsOnValue")}</span>
                        <input
                          type="text"
                          aria-label={`${t("fbFieldDependsOnValue")} ${idx + 1}`}
                          value={inp.depends_on.equals === undefined ? "" : String(inp.depends_on.equals)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const parsed =
                              raw === "true"
                                ? true
                                : raw === "false"
                                  ? false
                                  : raw !== "" && Number.isFinite(Number(raw))
                                    ? Number(raw)
                                    : raw;
                            updateInput(idx, {
                              depends_on: { field: inp.depends_on!.field, equals: parsed },
                            });
                          }}
                          className={`${fieldCls} font-mono`}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <Button type="button" variant="outline" className="self-start h-11" onClick={addInput}>
          {t("fbAddInput")}
        </Button>
      </div>

      <section aria-label={t("fbPresetsTitle")} className="space-y-3 pt-2">
        <h2 className="text-[15px] font-extrabold">{t("fbPresetsTitle")}</h2>

        {presets.map((preset, pIdx) => {
          const draftKey = `${pIdx}-${preset.id}`;
          const draftVal = presetJsonDrafts[draftKey] ?? JSON.stringify(preset.values ?? {}, null, 0);
          return (
            <div
              key={draftKey}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-[18px] rounded-2xl bg-card border border-border"
            >
              <label className="block">
                <span className={labelCls}>{t("fbPresetId")}</span>
                <input
                  type="text"
                  value={preset.id}
                  onChange={(e) => updatePreset(pIdx, { id: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })}
                  className={`${fieldCls} font-mono`}
                />
              </label>
              <label className="block">
                <span className={labelCls}>{t("fbPresetLabel")}</span>
                <input
                  type="text"
                  value={preset.label}
                  onChange={(e) => updatePreset(pIdx, { label: e.target.value })}
                  className={fieldCls}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelCls}>{t("fbPresetValues")}</span>
                <textarea
                  value={draftVal}
                  onChange={(e) => {
                    const nextStr = e.target.value;
                    setPresetJsonDrafts((prev) => ({ ...prev, [draftKey]: nextStr }));
                    try {
                      const parsed: unknown = JSON.parse(nextStr);
                      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        updatePreset(pIdx, { values: parsed as Record<string, unknown> });
                      }
                    } catch {
                      // wait until user finishes typing valid JSON
                    }
                  }}
                  placeholder='{"steps": 28, "guidance_scale": 6.5}'
                  className="w-full h-[76px] px-3 py-2.5 rounded-[10px] border border-input bg-background font-mono text-[12.5px] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removePreset(pIdx)}
                  className="h-9 px-3 text-[13px] font-bold text-destructive hover:bg-destructive/10 rounded-[10px] cursor-pointer"
                >
                  {t("delete")}
                </button>
              </div>
            </div>
          );
        })}

        <Button type="button" variant="outline" className="self-start h-10" onClick={addPreset}>
          {t("fbAddPreset")}
        </Button>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
        <label className="block">
          <span className={labelCls}>{t("fbOutputType")}</span>
          <select
            aria-label={t("fbOutputType")}
            value={ui.output.type}
            onChange={(e) =>
              onChange({ ...ui, output: { ...ui.output, type: e.target.value as UIOutputType } })
            }
            className={fieldCls}
          >
            {OUTPUT_TYPES.map((ot) => (
              <option key={ot} value={ot}>
                {ot}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>{t("fbColumns")}</span>
          <select
            aria-label={t("fbColumns")}
            value={ui.columns ?? 2}
            onChange={(e) => onChange({ ...ui, columns: Number(e.target.value) === 1 ? 1 : 2 })}
            className={fieldCls}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      </section>
    </div>
  );
}
