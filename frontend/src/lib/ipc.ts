import type { ModelPackageManifest, ModelState } from "@/types/manifest";
import { isModelState } from "@/types/manifest";
import { BUNDLED_MANIFESTS, defaultVariantId, resolveVariant } from "@/lib/catalog";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type InferenceEvent =
  | { kind: "token"; text: string }
  /** The model's thinking, streamed apart from the answer. */
  | { kind: "reasoning"; text: string }
  /** Token counts reported by the model server (`context_size` only during chat). */
  | { kind: "usage"; prompt_tokens: number; completion_tokens: number; context_size?: number }
  /** Chat: older turns are being / were folded into a summary to free the context window. */
  | { kind: "compacting"; messages: number }
  | { kind: "compacted"; messages: number; summary: string }
  | { kind: "continuing"; part: number; max_parts: number }
  | { kind: "web_searching"; stage: string; queries?: string[] }
  | { kind: "web_search_results"; queries: string[]; sources: WebSearchSource[]; warning?: string | null }
  | { kind: "image"; data_url: string }
  | { kind: "audio"; data_url: string }
  | { kind: "json"; value: unknown }
  | { kind: "progress"; current: number; total: number; unit: string }
  | { kind: "log"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done" };

export interface InstallProgress {
  model_id: string;
  step_index: number;
  total_steps: number;
  step_type: string;
  message: string;

  bytes_done?: number | null;

  bytes_total?: number | null;
}

export function installPercent(progress: InstallProgress | null | undefined): number | null {
  const done = progress?.bytes_done;
  const total = progress?.bytes_total;
  if (typeof done !== "number" || typeof total !== "number" || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((done * 100) / total)));
}

export interface InferenceHandlers {
  onEvent: (event: InferenceEvent) => void;
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException("The user aborted a request.", "AbortError");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : JSON.stringify(err));
}

const mockInstalled = new Map<string, ModelPackageManifest>(
  BUNDLED_MANIFESTS.filter((m) => m.content_rating !== "adult")
    .sort((a, b) => (a.id === "flux-schnell" ? -1 : b.id === "flux-schnell" ? 1 : a.id.localeCompare(b.id)))
    .map((m) => (m.variants?.length ? resolveVariant(m, defaultVariantId(m)) : m))
    .map((m) => [m.id, m])
);
const mockStates: Record<string, ModelState> = {};
const mockCancelled = new Set<string>();
const mockInstalling = new Set<string>();
const mockInstallCancelled = new Set<string>();
const mockModelContextSizes = new Map<string, number>();
const mockActiveContextSizes = new Map<string, number>();

export function resetMockModelContextSizes(): void {
  mockModelContextSizes.clear();
  mockActiveContextSizes.clear();
}

function mockState(modelId: string): ModelState {
  return mockStates[modelId] ?? "stopped";
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw toError(err);
  }
}

export type Placement =
  | { kind: "gpu" }
  | { kind: "model_offload" }
  | { kind: "sequential_offload" }
  | { kind: "layers"; on_gpu: number; total: number };

export type MemoryMode = "auto" | "gpu_only";

export function isOffloaded(placement: Placement | null | undefined): boolean {
  if (!placement) return false;
  if (placement.kind === "layers") return placement.on_gpu < placement.total;
  return placement.kind !== "gpu";
}

export interface ActiveModelSummary {
  id: string;
  state: ModelState;
  reserved_mb: number;

  ram_mb?: number | null;
  placement?: Placement | null;
}

export interface HardwareStatus {
  accelerator: string;
  device_name?: string | null;
  total_vram_mb: number;
  free_vram_mb: number;
  allocated_vram_mb: number;
  safe_budget_mb: number;
  host_ram_mb: number;

  available_ram_mb?: number | null;
  memory_mode?: MemoryMode;
  active_models: ActiveModelSummary[];
}

export interface HardwareCapabilitiesResult {
  available_vram_gb?: number;
}

export async function apiGetHardwareStatus(): Promise<HardwareStatus> {
  if (isTauri()) {
    try {
      return await tauriInvoke<HardwareStatus>("get_hardware_status");
    } catch (err: unknown) {
      throw toError(err);
    }
  }

  const active: ActiveModelSummary[] = [];
  let allocated = 0;
  for (const [id, state] of Object.entries(mockStates)) {
    if (state !== "stopped") {
      const manifest = mockInstalled.get(id);
      const reserved = manifest ? Math.round(manifest.hardware_requirements.min_vram_gb * 1024) : 0;
      allocated += reserved;
      active.push({ id, state, reserved_mb: reserved, ram_mb: 640, placement: { kind: "gpu" } });
    }
  }
  const total = 16384;
  const safe = Math.max(0, Math.round(total * 0.9) - 512);
  const free = Math.max(0, safe - allocated);

  return {
    accelerator: "CUDA",
    device_name: "NVIDIA GeForce RTX 4080 (Mock)",
    total_vram_mb: total,
    safe_budget_mb: safe,
    allocated_vram_mb: allocated,
    free_vram_mb: free,
    host_ram_mb: 32768,
    available_ram_mb: 32768 - 9216 - active.length * 640,
    memory_mode: mockMemoryMode,
    active_models: active,
  };
}

let mockMemoryMode: MemoryMode = "auto";

export async function apiGetMemoryMode(): Promise<MemoryMode> {
  if (isTauri()) return tauriInvoke<MemoryMode>("get_memory_mode");
  return mockMemoryMode;
}

export async function apiSetMemoryMode(mode: MemoryMode): Promise<MemoryMode> {
  if (isTauri()) return tauriInvoke<MemoryMode>("set_memory_mode", { mode });
  mockMemoryMode = mode;
  return mode;
}

export async function apiGetHardwareCapabilities(): Promise<HardwareCapabilitiesResult | null> {
  try {
    const status = await apiGetHardwareStatus();
    return {
      available_vram_gb: Number((status.free_vram_mb / 1024).toFixed(2)),
    };
  } catch {
    return null;
  }
}

export async function apiListModels(): Promise<ModelPackageManifest[]> {
  if (isTauri()) return tauriInvoke<ModelPackageManifest[]>("list_models");
  return [...mockInstalled.values()];
}

export async function apiGetModelStatus(modelId: string): Promise<ModelState> {
  if (isTauri()) {
    const state = await tauriInvoke<unknown>("get_model_status", { modelId });
    if (!isModelState(state)) {
      throw new Error(`Unexpected model state from the runtime: ${JSON.stringify(state)}`);
    }
    return state;
  }
  return mockState(modelId);
}

export const MIN_CONTEXT_WINDOW = 256;
export const MAX_CONTEXT_WINDOW = 2_097_152;
export const LEGACY_MAX_CONTEXT_WINDOW = 262_144;
export const MIN_OUTPUT_TOKENS = 64;
export const MAX_OUTPUT_TOKENS = 2_097_152;

export interface ModelContextInfo {
  configured: number;
  recommended: number;
  max_supported: number;
  min_supported: number;
  is_custom: boolean;
  active: number | null;
  restart_required: boolean;
  output_recommended: number;
  output_max_supported: number;
}

function clampCtxInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function parseArgCtxSize(args: string[] | undefined): number | null {
  if (!args?.length) return null;
  let found: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ctx-size" || arg === "-c") {
      const next = Number(args[i + 1]);
      if (Number.isInteger(next) && next > 0) {
        found = next;
        i++;
      }
    } else if (arg.startsWith("--ctx-size=")) {
      const val = Number(arg.slice("--ctx-size=".length));
      if (Number.isInteger(val) && val > 0) found = val;
    } else if (arg.startsWith("-c=")) {
      const val = Number(arg.slice("-c=".length));
      if (Number.isInteger(val) && val > 0) found = val;
    }
  }
  return found;
}

function mockContextBounds(manifest?: ModelPackageManifest): { recommended: number; max_supported: number } {
  const cw = manifest?.runtime.context_window;
  const argCtx = parseArgCtxSize(manifest?.runtime.arguments);
  const recOrArg = cw?.recommended ?? argCtx ?? 8192;
  const max_supported = clampCtxInt(
    cw?.max_supported ?? Math.max(recOrArg, LEGACY_MAX_CONTEXT_WINDOW),
    MIN_CONTEXT_WINDOW,
    MAX_CONTEXT_WINDOW
  );
  const recommended = clampCtxInt(recOrArg, MIN_CONTEXT_WINDOW, max_supported);
  return { recommended, max_supported };
}

function mockOutputBounds(
  manifest: ModelPackageManifest | undefined,
  maxSupportedCtx: number
): { output_recommended: number; output_max_supported: number } {
  const cap = clampCtxInt(maxSupportedCtx, MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
  const rawDefault = manifest?.ui.inputs.find((i) => i.name === "max_tokens")?.default;
  const uiDefault = typeof rawDefault === "number" && Number.isFinite(rawDefault) ? rawDefault : 2048;
  const ot = manifest?.runtime.output_tokens;
  const output_max_supported = clampCtxInt(
    ot?.max_supported ?? cap,
    MIN_OUTPUT_TOKENS,
    cap
  );
  const output_recommended = clampCtxInt(
    ot?.recommended ?? uiDefault,
    MIN_OUTPUT_TOKENS,
    output_max_supported
  );
  return { output_recommended, output_max_supported };
}

function buildMockContextInfo(modelId: string, manifest?: ModelPackageManifest): ModelContextInfo {
  const { recommended, max_supported } = mockContextBounds(manifest);
  const { output_recommended, output_max_supported } = mockOutputBounds(manifest, max_supported);
  const override = mockModelContextSizes.get(modelId);
  const configured = clampCtxInt(override ?? recommended, MIN_CONTEXT_WINDOW, max_supported);
  const is_custom = override !== undefined && override !== recommended;
  const st = mockState(modelId);
  const isRunning = st === "ready" || st === "inferring";
  const active = isRunning ? (mockActiveContextSizes.get(modelId) ?? configured) : null;
  const restart_required = active !== null && active !== configured;
  return {
    configured,
    recommended,
    max_supported,
    min_supported: MIN_CONTEXT_WINDOW,
    is_custom,
    active,
    restart_required,
    output_recommended,
    output_max_supported,
  };
}

export async function apiLaunchModel(modelId: string): Promise<number> {
  if (isTauri()) return tauriInvoke<number>("launch_model", { modelId });
  if (!mockInstalled.has(modelId)) throw new Error(`Model '${modelId}' is not installed`);
  const info = buildMockContextInfo(modelId, mockInstalled.get(modelId));
  mockActiveContextSizes.set(modelId, info.configured);
  mockStates[modelId] = "ready";
  return 8080;
}

export async function apiStopModel(modelId: string): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("stop_model", { modelId });
  mockActiveContextSizes.delete(modelId);
  mockStates[modelId] = "stopped";
}

export async function apiGetModelContextWindow(modelId: string): Promise<ModelContextInfo> {
  if (isTauri()) return tauriInvoke<ModelContextInfo>("get_model_context_window", { modelId });
  return buildMockContextInfo(modelId, mockInstalled.get(modelId));
}

export async function apiSetModelContextWindow(
  modelId: string,
  ctxSize: number | null,
  restartIfRunning = false
): Promise<ModelContextInfo> {
  if (isTauri()) {
    return tauriInvoke<ModelContextInfo>("set_model_context_window", {
      modelId,
      ctxSize,
      restartIfRunning,
    });
  }
  const manifest = mockInstalled.get(modelId);
  if (manifest && manifest.runtime.archetype !== "llama_cpp_server") {
    throw new Error("Context window override is only supported for GGUF (llama.cpp) models.");
  }
  const { recommended, max_supported } = mockContextBounds(manifest);
  if (ctxSize !== null) {
    if (!Number.isInteger(ctxSize) || ctxSize < MIN_CONTEXT_WINDOW || ctxSize > max_supported) {
      throw new Error(
        `Context window (${ctxSize}) must be between ${MIN_CONTEXT_WINDOW} and ${max_supported} tokens.`
      );
    }
  }
  if (ctxSize === null || ctxSize === recommended) {
    mockModelContextSizes.delete(modelId);
  } else {
    mockModelContextSizes.set(modelId, ctxSize);
  }
  const effectiveConfigured = mockModelContextSizes.get(modelId) ?? recommended;
  const st = mockState(modelId);
  const isRunning = st === "ready" || st === "inferring";
  if (restartIfRunning && isRunning) {
    if (st === "inferring") {
      throw new Error("Model is currently generating; stop generation before restarting.");
    }
    mockActiveContextSizes.set(modelId, effectiveConfigured);
    mockStates[modelId] = "ready";
  }
  return buildMockContextInfo(modelId, manifest);
}

export async function apiCancelInference(modelId: string): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("cancel_inference", { modelId });
  mockCancelled.add(modelId);
}

export async function apiInstallModel(
  manifest: ModelPackageManifest,
  onProgress?: (progress: InstallProgress) => void
): Promise<void> {
  if (isTauri()) {
    const { Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<InstallProgress>();
    channel.onmessage = (message) => onProgress?.(message);
    return tauriInvoke<void>("install_model", { manifest, onProgress: channel });
  }
  const total = Math.max(manifest.install.length, 1);
  mockInstalling.add(manifest.id);
  mockInstallCancelled.delete(manifest.id);
  try {
    for (let i = 0; i < total; i++) {
      if (mockInstallCancelled.has(manifest.id)) throw new Error("Installation cancelled");
      const stepType = manifest.install[i]?.step_type ?? "copy_file";
      onProgress?.({
        model_id: manifest.id,
        step_index: i,
        total_steps: total,
        step_type: stepType,
        message: `Mock install step ${i + 1}/${total}`,
      });
      await delay(10);
      if (stepType === "hf_download") {
        const size = 2_000_000_000;
        for (let part = 1; part <= 4; part++) {
          if (mockInstallCancelled.has(manifest.id)) throw new Error("Installation cancelled");
          const done = (size * part) / 4;
          onProgress?.({
            model_id: manifest.id,
            step_index: i,
            total_steps: total,
            step_type: stepType,
            message: `Downloading mock.gguf: ${(done / 1e9).toFixed(2)} / ${(size / 1e9).toFixed(2)} GB (${part * 25}%)`,
            bytes_done: done,
            bytes_total: size,
          });
          await delay(10);
        }
      }
    }
    if (mockInstallCancelled.has(manifest.id)) throw new Error("Installation cancelled");
  } finally {
    mockInstalling.delete(manifest.id);
    mockInstallCancelled.delete(manifest.id);
  }
  mockInstalled.set(manifest.id, manifest);
  mockStates[manifest.id] = "stopped";
}

export async function apiCancelInstall(modelId: string): Promise<boolean> {
  if (isTauri()) return tauriInvoke<boolean>("cancel_install", { modelId });
  if (!mockInstalling.has(modelId)) return false;
  mockInstallCancelled.add(modelId);
  return true;
}

export async function apiUninstallModel(modelId: string): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("uninstall_model", { modelId });
  mockInstalled.delete(modelId);
  delete mockStates[modelId];
}

export async function apiExecuteInference(
  modelId: string,
  form: Record<string, unknown>,
  handlers: InferenceHandlers
): Promise<void> {
  const { signal, onEvent } = handlers;
  if (signal?.aborted) throw abortError();

  if (isTauri()) {
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<InferenceEvent>();
    channel.onmessage = (event) => onEvent(event);

    let settled = false;
    let cancelTimer: ReturnType<typeof setInterval> | undefined;
    const requestCancel = () => {

      const ask = () => {
        if (!settled) void invoke("cancel_inference", { modelId }).catch(() => undefined);
      };
      ask();
      cancelTimer = setInterval(ask, 250);
    };
    signal?.addEventListener("abort", requestCancel, { once: true });
    if (signal?.aborted) requestCancel();
    try {
      await invoke<void>("execute_inference", { modelId, form, channel });
    } catch (err) {
      if (signal?.aborted) throw abortError();
      throw toError(err);
    } finally {
      settled = true;
      if (cancelTimer) clearInterval(cancelTimer);
      signal?.removeEventListener("abort", requestCancel);
    }
    if (signal?.aborted) throw abortError();
    return;
  }

  await mockInference(modelId, form, handlers);
}

const MOCK_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'>" +
  "<rect width='400' height='400' fill='#18181b'/><circle cx='200' cy='200' r='120' fill='#eab308'/>" +
  "<text x='200' y='210' font-family='sans-serif' font-size='20' font-weight='bold' fill='#000' " +
  "text-anchor='middle'>LemonAI mock</text></svg>";

function mockWavDataUrl(): string {
  const rate = 24000;
  const seconds = 1.8;
  const n = Math.floor(rate * seconds);
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const envelope = Math.min(1, t * 8) * Math.min(1, (seconds - t) * 8) * (0.5 + 0.5 * Math.sin(t * 9));
    const hz = t < seconds / 2 ? 440 : 554;
    view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * hz * t) * envelope * 6000), true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(binary)}`;
}

async function mockInference(
  modelId: string,
  form: Record<string, unknown>,
  { onEvent, signal }: InferenceHandlers
): Promise<void> {
  const manifest = mockInstalled.get(modelId);
  if (!manifest) throw new Error(`Model '${modelId}' is not installed`);
  if (mockState(modelId) !== "ready") throw new Error(`Model '${modelId}' is not running`);
  mockCancelled.delete(modelId);
  mockStates[modelId] = "inferring";

  const cancelled = () => Boolean(signal?.aborted) || mockCancelled.has(modelId);
  try {
    onEvent({ kind: "log", message: `Mock inference for ${manifest.name}` });
    const outputType = manifest.ui.output.type;
    if (outputType === "image") {
      const steps = Math.max(1, Number(form.steps ?? form.num_inference_steps ?? 4) || 4);
      for (let i = 1; i <= steps; i++) {
        if (cancelled()) throw abortError();
        onEvent({ kind: "progress", current: i, total: steps, unit: "step" });
        await delay(40);
      }
      onEvent({ kind: "image", data_url: `data:image/svg+xml;utf8,${encodeURIComponent(MOCK_SVG)}` });
    } else if (outputType === "audio") {
      const total = 6;
      for (let i = 1; i <= total; i++) {
        if (cancelled()) throw abortError();
        onEvent({ kind: "progress", current: i, total, unit: "step" });
        await delay(40);
      }
      onEvent({ kind: "audio", data_url: mockWavDataUrl() });
    } else if (outputType === "json") {
      await delay(40);
      onEvent({
        kind: "json",
        value: {
          label: "cat",
          score: 0.9421,
          boxes: [
            { x: 12, y: 40, w: 220, h: 180 },
            { x: 260, y: 90, w: 80, h: 60 },
            { x: 300, y: 200, w: 90, h: 100 },
          ],
          meta: { model: manifest.name, took_ms: 182 },
        },
      });
    } else {
      const reply =
        "This is a **mock** reply from the web adapter.\n\n```python\nprint('hello from LemonAI')\n```\n";
      for (const piece of reply.split(/(?<= )/)) {
        if (cancelled()) throw abortError();
        onEvent({ kind: "token", text: piece });
        await delay(5);
      }
    }
    onEvent({ kind: "done" });
  } finally {
    mockStates[modelId] = "ready";
    mockCancelled.delete(modelId);
  }
}

export type ChatRole = "user" | "assistant";
export type TruncationReason = "max_tokens" | "context_window";

export interface WebSearchSource {
  index: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  page_fetched?: boolean;
}

export interface WebSearchRecord {
  queries: string[];
  sources: WebSearchSource[];
  warning?: string | null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;

  reasoning?: string | null;

  created_at: number;
  tokens?: number | null;

  interrupted?: boolean;

  truncated?: boolean;

  truncation_reason?: TruncationReason | null;

  parts?: number | null;

  web_search?: WebSearchRecord | null;
}

export interface ChatSummary {
  text: string;

  covers: number;
  updated_at: number;
  lossy?: boolean;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;

  context_size: number;
}

export interface Conversation {
  id: string;
  model_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  system_prompt?: string | null;

  messages: ChatMessage[];
  summary?: ChatSummary | null;
  usage?: ChatUsage | null;
}

export interface ConversationInfo {
  id: string;
  model_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export function supportsChat(manifest: ModelPackageManifest): boolean {
  return (
    manifest.runtime.archetype === "llama_cpp_server" ||
    manifest.runtime.archetype === "transformers_pipeline"
  );
}

const mockConversations = new Map<string, Conversation>();

export const MOCK_CONTEXT_SIZE = 2048;

function mockId(length: number): string {
  let out = "";
  while (out.length < length) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function infoOf(c: Conversation): ConversationInfo {
  return {
    id: c.id,
    model_id: c.model_id,
    title: c.title,
    created_at: c.created_at,
    updated_at: c.updated_at,
    message_count: c.messages.length,
  };
}

function mockConversation(id: string): Conversation {
  const found = mockConversations.get(id);
  if (!found) throw new Error(`Conversation '${id}' was not found`);
  return found;
}

export async function apiChatList(modelId?: string): Promise<ConversationInfo[]> {
  if (isTauri()) return tauriInvoke<ConversationInfo[]>("chat_list", { modelId: modelId ?? null });
  return [...mockConversations.values()]
    .filter((c) => !modelId || c.model_id === modelId)
    .sort((a, b) => b.updated_at - a.updated_at)
    .map(infoOf);
}

export async function apiChatGet(conversationId: string): Promise<Conversation> {
  if (isTauri()) return tauriInvoke<Conversation>("chat_get", { conversationId });
  return structuredClone(mockConversation(conversationId));
}

export async function apiChatCreate(modelId: string, systemPrompt?: string | null): Promise<Conversation> {
  if (isTauri()) {
    return tauriInvoke<Conversation>("chat_create", { modelId, systemPrompt: systemPrompt ?? null });
  }
  const manifest = mockInstalled.get(modelId);
  if (!manifest) throw new Error(`Model '${modelId}' is not installed`);
  if (!supportsChat(manifest)) throw new Error(`Model '${modelId}' does not support chat`);
  const now = Date.now();
  const conversation: Conversation = {
    id: mockId(32),
    model_id: modelId,
    title: "",
    created_at: now,
    updated_at: now,
    system_prompt: systemPrompt?.trim() || null,
    messages: [],
    summary: null,
    usage: null,
  };
  mockConversations.set(conversation.id, conversation);
  return structuredClone(conversation);
}

export async function apiChatRename(conversationId: string, title: string): Promise<ConversationInfo> {
  if (isTauri()) return tauriInvoke<ConversationInfo>("chat_rename", { conversationId, title });
  const clean = title.trim().slice(0, 120);
  if (!clean) throw new Error("the title cannot be empty");
  const conversation = mockConversation(conversationId);
  conversation.title = clean;
  return infoOf(conversation);
}

export async function apiChatDelete(conversationId: string): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("chat_delete", { conversationId });
  if (!mockConversations.delete(conversationId)) {
    throw new Error(`Conversation '${conversationId}' was not found`);
  }
}

export interface HfTokenStatus {
  set: boolean;

  hint: string | null;
}

let mockHfToken: string | null = null;

function mockTokenStatus(): HfTokenStatus {
  return mockHfToken
    ? { set: true, hint: `${mockHfToken.slice(0, 3)}…${mockHfToken.slice(-4)}` }
    : { set: false, hint: null };
}

export async function apiHfTokenStatus(): Promise<HfTokenStatus> {
  if (isTauri()) return tauriInvoke<HfTokenStatus>("hf_token_status");
  return mockTokenStatus();
}

export async function apiSetHfToken(token: string | null): Promise<HfTokenStatus> {
  if (isTauri()) return tauriInvoke<HfTokenStatus>("set_hf_token", { token });
  const clean = token?.trim() ?? "";
  if (!clean) {
    mockHfToken = null;
  } else if (!/^hf_[A-Za-z0-9_-]{8,250}$/.test(clean)) {
    throw new Error("That does not look like a Hugging Face access token (it starts with 'hf_').");
  } else {
    mockHfToken = clean;
  }
  return mockTokenStatus();
}

export interface ChatCapabilities {
  vision: boolean;
  audio: boolean;

  confirmed: boolean;
}

export function hasProjector(manifest: ModelPackageManifest): boolean {
  return (
    manifest.runtime.archetype === "llama_cpp_server" &&
    manifest.install.some(
      (s) => (s.step_type === "hf_download" || s.step_type === "copy_file") && (s.destination ?? "").endsWith("mmproj.gguf")
    )
  );
}

export async function apiChatCapabilities(modelId: string): Promise<ChatCapabilities> {
  if (isTauri()) return tauriInvoke<ChatCapabilities>("chat_capabilities", { modelId });
  const manifest = mockInstalled.get(modelId);
  if (!manifest) throw new Error(`Model '${modelId}' is not installed`);
  const projector = hasProjector(manifest);
  return { vision: projector, audio: projector, confirmed: mockStates[modelId] === "ready" };
}

async function invokeChatStream(
  command: string,
  modelId: string,
  args: Record<string, unknown>,
  handlers: InferenceHandlers
): Promise<Conversation> {
  const { signal, onEvent } = handlers;
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<InferenceEvent>();
  channel.onmessage = (event) => onEvent(event);

  let settled = false;
  let cancelTimer: ReturnType<typeof setInterval> | undefined;
  const requestCancel = () => {
    const ask = () => {
      if (!settled) void invoke("cancel_inference", { modelId }).catch(() => undefined);
    };
    ask();
    cancelTimer = setInterval(ask, 250);
  };
  signal?.addEventListener("abort", requestCancel, { once: true });
  if (signal?.aborted) requestCancel();
  try {
    return await invoke<Conversation>(command, { ...args, channel });
  } catch (err) {
    throw toError(err);
  } finally {
    settled = true;
    if (cancelTimer) clearInterval(cancelTimer);
    signal?.removeEventListener("abort", requestCancel);
  }
}

export async function apiChatSend(
  modelId: string,
  conversationId: string,
  text: string,
  params: Record<string, unknown>,
  handlers: InferenceHandlers
): Promise<Conversation> {
  if (handlers.signal?.aborted) throw abortError();
  if (isTauri()) {
    return invokeChatStream("chat_send", modelId, { conversationId, text, params }, handlers);
  }
  return mockChatSend(modelId, conversationId, text, params, handlers);
}

function mockPromptSize(c: Conversation): number {
  const visible = c.messages.slice(c.summary?.covers ?? 0);
  return (
    words(c.system_prompt ?? "") +
    words(c.summary?.text ?? "") +
    visible.reduce((sum, m) => sum + words(m.content) + 1, 0)
  );
}

async function mockChatSend(
  modelId: string,
  conversationId: string,
  text: string,
  params: Record<string, unknown>,
  { onEvent, signal }: InferenceHandlers
): Promise<Conversation> {
  const conversation = mockConversation(conversationId);
  if (conversation.model_id !== modelId) throw new Error("conversation belongs to another model");
  if (!text.trim()) throw new Error("the message is empty");
  if (mockState(modelId) !== "ready") throw new Error(`Model '${modelId}' is not running`);
  mockCancelled.delete(modelId);
  mockStates[modelId] = "inferring";

  const now = Date.now();
  if ("system_prompt" in params) {
    const prompt = params.system_prompt;
    conversation.system_prompt = typeof prompt === "string" && prompt.trim() ? prompt.trim() : null;
  }
  let mockResponseText = text.trim();
  if (mockResponseText.startsWith("[")) {
    try {
      const parsed = JSON.parse(mockResponseText);
      if (Array.isArray(parsed)) {
        const textPart = parsed.find(
          (p: unknown) => typeof p === "object" && p !== null && (p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string"
        ) as { type: "text"; text: string } | undefined;
        if (textPart) {
          mockResponseText = textPart.text;
        } else if (parsed.length > 0) {
          mockResponseText = "Media attachment";
        }
      }
    } catch {
      // not a JSON array
    }
  }

  if (!conversation.title) conversation.title = mockResponseText.split("\n")[0].slice(0, 60);
  conversation.messages.push({ id: mockId(16), role: "user", content: text.trim(), created_at: now });
  conversation.updated_at = now;

  const cancelled = () => Boolean(signal?.aborted) || mockCancelled.has(modelId);
  try {

    const ctxSize = mockModelContextSizes.get(modelId) ?? MOCK_CONTEXT_SIZE;
    const limit = ctxSize - ctxSize / 4;
    if (mockPromptSize(conversation) > limit * 0.8) {
      let covers = conversation.summary?.covers ?? 0;
      const before = covers;
      const last = conversation.messages.length - 1;
      do {
        covers += 1;
        while (covers < last && conversation.messages[covers].role !== "user") covers += 1;
        conversation.summary = {
          text: `Mock summary of ${covers} earlier messages.`,
          covers,
          updated_at: Date.now(),
        };
      } while (covers < last && mockPromptSize(conversation) > limit / 2);
      onEvent({ kind: "compacting", messages: covers - before });
      await delay(5);
      onEvent({ kind: "compacted", messages: covers - before, summary: conversation.summary.text });
    }
    const promptTokens = mockPromptSize(conversation);
    onEvent({
      kind: "usage",
      prompt_tokens: promptTokens,
      completion_tokens: 0,
      context_size: ctxSize,
    });

    let webSearchRecord: WebSearchRecord | null = null;
    if (params.web_search === true) {
      const mockQuery = mockResponseText.slice(0, 80).trim() || "web search query";
      onEvent({ kind: "web_searching", stage: "planning" });
      await delay(5);
      if (cancelled()) throw abortError();
      onEvent({ kind: "web_searching", stage: "searching", queries: [mockQuery] });
      await delay(5);
      if (cancelled()) throw abortError();
      onEvent({ kind: "web_searching", stage: "reading", queries: [mockQuery] });
      await delay(5);
      if (cancelled()) throw abortError();
      const sources: WebSearchSource[] = [
        {
          index: 1,
          title: `Reference Guide: ${mockQuery}`,
          url: "https://example.org/guide",
          domain: "example.org",
          snippet: "Practical reference notes gathered from web search.",
          page_fetched: true,
        },
        {
          index: 2,
          title: "Additional Context Overview",
          url: "https://docs.example.com/overview",
          domain: "docs.example.com",
          snippet: "Secondary background snippet for verification.",
          page_fetched: false,
        },
      ];
      webSearchRecord = { queries: [mockQuery], sources, warning: null };
      onEvent({
        kind: "web_search_results",
        queries: [mockQuery],
        sources,
        warning: null,
      });
    }

    let reasoning = "";
    if (params.thinking === true) {
      reasoning = "Mock reasoning about the question.";
      onEvent({ kind: "reasoning", text: reasoning });
      await delay(5);
    }
    const turn = conversation.messages.filter((m) => m.role === "user").length;
    const reply = webSearchRecord
      ? `Mock answer ${turn} with web sources [1] to: ${mockResponseText.slice(0, 80)}`
      : `Mock answer ${turn} to: ${mockResponseText.slice(0, 80)}`;
    let content = "";
    let interrupted = false;
    for (const piece of reply.split(/(?<= )/)) {
      if (cancelled()) {
        interrupted = true;
        break;
      }
      content += piece;
      onEvent({ kind: "token", text: piece });
      await delay(5);
    }
    if (content) {
      conversation.messages.push({
        id: mockId(16),
        role: "assistant",
        content: content.trimEnd(),
        reasoning: reasoning || null,
        created_at: Date.now(),
        tokens: words(content),
        interrupted,
        web_search: webSearchRecord,
      });
    }
    conversation.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: words(content),
      context_size: ctxSize,
    };
    conversation.updated_at = Date.now();
    onEvent({ kind: "usage", ...conversation.usage });
    onEvent({ kind: "done" });
    return structuredClone(conversation);
  } finally {
    mockStates[modelId] = "ready";
    mockCancelled.delete(modelId);
  }
}

export type ComfyDevice = "nvidia" | "nvidia_legacy" | "amd" | "intel" | "apple" | "cpu";
export type ComfyFlavor = "portable" | "source";
export type ComfyStage =
  | "release"
  | "download"
  | "verify"
  | "extract"
  | "python"
  | "git"
  | "manager"
  | "custom_nodes"
  | "check"
  | "move"
  | "done";

export const COMFY_DEVICE_LABELS: Record<ComfyDevice, string> = {
  nvidia: "NVIDIA (RTX 20 i nowsze)",
  nvidia_legacy: "NVIDIA (GTX 10 i starsze)",
  amd: "AMD Radeon",
  intel: "Intel Arc",
  apple: "Apple silicon",
  cpu: "Tylko procesor (wolno)",
};

export interface ComfyInstalled {
  version: string;
  flavor: ComfyFlavor;
  device: ComfyDevice;
  asset?: string | null;
  manager?: string | null;
  installed_at: number;
  warnings: string[];
}

export type ComfyStopReason = { kind: "evicted" } | { kind: "exited"; status: string };

export interface ComfyServerStatus {
  state: "stopped" | "starting" | "running";
  port: number | null;
  url: string | null;
  stop_reason?: ComfyStopReason | null;
}

export interface ComfyStatus {
  installed: ComfyInstalled | null;
  server: ComfyServerStatus;
  flavor: ComfyFlavor;
  recommended: { device: ComfyDevice; reason: string; warnings: string[] };
  install_dir: string;
  data_dir: string;

  root: string;
  free_bytes: number | null;
}

export interface ComfyLocationInfo {
  root: string;
  default_root: string;
  is_default: boolean;
  free_bytes: number | null;
  size_bytes: number | null;
  existing_install: string | null;
  writable: boolean;
}

export interface ComfyProgress {
  stage: ComfyStage;
  message: string;
  bytes_done?: number | null;
  bytes_total?: number | null;
}

export interface ComfyReleaseInfo {
  latest: string;
  published_at: string | null;
  notes_url: string | null;
  installed: string | null;
  update_available: boolean;
}

const MOCK_COMFY_LATEST = "v0.45.4";
const MOCK_COMFY_DEFAULT_ROOT = "C:\\Users\\you\\AppData\\Roaming\\LemonAI\\comfyui";
let mockComfyRoot = MOCK_COMFY_DEFAULT_ROOT;
let mockComfyStopReason: ComfyStopReason | null = null;
let mockComfyInstalled: ComfyInstalled | null = null;
let mockComfyServer: ComfyServerStatus = { state: "stopped", port: null, url: null };
let mockComfyCancel = false;
const mockComfyLogs: string[] = [];

export async function apiComfyStatus(): Promise<ComfyStatus> {
  if (isTauri()) return tauriInvoke<ComfyStatus>("comfyui_status");
  return {
    installed: mockComfyInstalled ? { ...mockComfyInstalled } : null,
    server: { ...mockComfyServer, stop_reason: mockComfyServer.state === "stopped" ? mockComfyStopReason : null },
    flavor: "portable",
    recommended: { device: "nvidia", reason: "NVIDIA GPU", warnings: [] },
    install_dir: `${mockComfyRoot}\\app`,
    data_dir: `${mockComfyRoot}\\data`,
    root: mockComfyRoot,
    free_bytes: 412_000_000_000,
  };
}

export async function apiComfyCheckUpdate(force = true): Promise<ComfyReleaseInfo> {
  if (isTauri()) return tauriInvoke<ComfyReleaseInfo>("comfyui_check_update", { force });
  const installed = mockComfyInstalled?.version ?? null;
  return {
    latest: MOCK_COMFY_LATEST,
    published_at: "2026-11-15T12:00:00Z",
    notes_url: `https://github.com/comfyanonymous/ComfyUI/releases/tag/${MOCK_COMFY_LATEST}`,
    installed,
    update_available: installed !== null && installed !== MOCK_COMFY_LATEST,
  };
}

export type ManagedApp = "comfyui";

const mockAutoUpdate: Partial<Record<ManagedApp, boolean>> = {};

export async function apiAppAutoUpdate(app: ManagedApp): Promise<boolean> {
  if (isTauri()) return tauriInvoke<boolean>("app_auto_update", { app });
  return mockAutoUpdate[app] ?? true;
}

export async function apiSetAppAutoUpdate(app: ManagedApp, enabled: boolean): Promise<boolean> {
  if (isTauri()) return tauriInvoke<boolean>("set_app_auto_update", { app, enabled });
  mockAutoUpdate[app] = enabled;
  return enabled;
}

export async function apiComfyInstall(
  device: ComfyDevice | null,
  onProgress?: (progress: ComfyProgress) => void
): Promise<ComfyInstalled> {
  if (isTauri()) {
    const { Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<ComfyProgress>();
    channel.onmessage = (message) => onProgress?.(message);
    return tauriInvoke<ComfyInstalled>("comfyui_install", { device, onProgress: channel });
  }
  mockComfyCancel = false;
  mockComfyServer = { state: "stopped", port: null, url: null };
  const size = 2_400_000_000;
  const steps: ComfyProgress[] = [
    { stage: "release", message: "Looking up the newest ComfyUI release" },
    ...[1, 2, 3, 4].map((i) => ({
      stage: "download" as const,
      message: `Downloading ComfyUI_windows_portable_nvidia.7z (${i * 25}%)`,
      bytes_done: (size * i) / 4,
      bytes_total: size,
    })),
    { stage: "extract", message: "Unpacking ComfyUI", bytes_done: size, bytes_total: size },
    { stage: "manager", message: "Installing comfyui_manager==4.2.2" },
    { stage: "check", message: "Checking that ComfyUI starts" },
  ];
  for (const step of steps) {
    if (mockComfyCancel) throw new Error("Installation cancelled");
    onProgress?.(step);
    mockComfyLogs.push(`[mock] ${step.message}`);
    await delay(10);
  }
  mockComfyInstalled = {
    version: MOCK_COMFY_LATEST,
    flavor: "portable",
    device: device ?? mockComfyInstalled?.device ?? "nvidia",
    asset: "ComfyUI_windows_portable_nvidia.7z",
    manager: "comfyui_manager==4.2.2",
    installed_at: Math.floor(Date.now() / 1000),
    warnings: [],
  };
  onProgress?.({ stage: "done", message: `ComfyUI ${MOCK_COMFY_LATEST} is ready` });
  return { ...mockComfyInstalled };
}

export async function apiComfyCancelInstall(): Promise<boolean> {
  if (isTauri()) return tauriInvoke<boolean>("comfyui_cancel_install");
  mockComfyCancel = true;
  return true;
}

export async function apiComfyStart(): Promise<number> {
  if (isTauri()) return tauriInvoke<number>("comfyui_start");
  if (!mockComfyInstalled) throw new Error("ComfyUI is not installed");
  mockComfyStopReason = null;
  mockComfyServer = { state: "running", port: 8188, url: "http://127.0.0.1:8188/" };
  mockComfyLogs.push("To see the GUI go to: http://127.0.0.1:8188");
  return 8188;
}

export async function apiComfyStop(): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("comfyui_stop");
  mockComfyStopReason = null;
  mockComfyServer = { state: "stopped", port: null, url: null };
}

export interface EmbedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const canEmbedComfy = (): boolean => isTauri();

export async function apiComfyEmbedShow(rect: EmbedRect): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("comfyui_embed_show", { ...rect });
}

export async function apiComfyEmbedHide(): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("comfyui_embed_hide");
}

export async function apiComfyOpenExternal(): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("comfyui_open_external");
  if (mockComfyServer.url && typeof window !== "undefined" && typeof window.open === "function") {
    window.open(mockComfyServer.url, "_blank", "noopener");
  }
}

export async function apiComfyOpen(): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("comfyui_open");
  if (mockComfyServer.url && typeof window !== "undefined" && typeof window.open === "function") {
    window.open(mockComfyServer.url, "_blank", "noopener");
  }
}

export async function apiComfyLogs(lines = 300): Promise<string[]> {
  if (isTauri()) return tauriInvoke<string[]>("comfyui_logs", { lines });
  return mockComfyLogs.slice(-lines);
}

export async function apiComfyUninstall(keepData: boolean): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("comfyui_uninstall", { keepData });
  mockComfyServer = { state: "stopped", port: null, url: null };
  mockComfyInstalled = null;
}

export async function apiComfyLocation(path: string | null = null): Promise<ComfyLocationInfo> {
  if (isTauri()) return tauriInvoke<ComfyLocationInfo>("comfyui_location", { path });
  const root = path === null ? mockComfyRoot : /LemonAI-ComfyUI$/.test(path) ? path : `${path}\\LemonAI-ComfyUI`;
  if (path !== null && !/^([A-Za-z]:\\|\/)/.test(path)) throw new Error("Choose a full folder path (for example D:\\AI)");
  return {
    root,
    default_root: MOCK_COMFY_DEFAULT_ROOT,
    is_default: root === MOCK_COMFY_DEFAULT_ROOT,
    free_bytes: 900_000_000_000,
    size_bytes: path === null ? (mockComfyInstalled ? 8_200_000_000 : 0) : null,
    existing_install: null,
    writable: true,
  };
}

export async function apiComfySetLocation(
  path: string | null,
  moveExisting: boolean,
  onProgress?: (progress: ComfyProgress) => void
): Promise<ComfyStatus> {
  if (isTauri()) {
    const { Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<ComfyProgress>();
    channel.onmessage = (message) => onProgress?.(message);
    return tauriInvoke<ComfyStatus>("comfyui_set_location", { path, moveExisting, onProgress: channel });
  }
  const info = await apiComfyLocation(path);
  mockComfyServer = { state: "stopped", port: null, url: null };
  if (moveExisting && mockComfyInstalled) {
    for (const part of [1, 2, 3, 4]) {
      onProgress?.({ stage: "move", message: `Moving ComfyUI (${part * 25}%)`, bytes_done: part * 2e9, bytes_total: 8e9 });
      await delay(5);
    }
  } else if (!moveExisting) {
    mockComfyInstalled = null;
  }
  mockComfyRoot = path === null ? MOCK_COMFY_DEFAULT_ROOT : info.root;
  return apiComfyStatus();
}

export async function pickFolder(title: string): Promise<string | null> {
  if (isTauri()) {
    return tauriInvoke<string | null>("pick_folder", { title });
  }
  if (typeof window === "undefined" || typeof window.prompt !== "function") return null;
  const answer = window.prompt(title, "D:\\AI");
  return answer && answer.trim() ? answer.trim() : null;
}

export function mockComfyEvicted(): void {
  mockComfyServer = { state: "stopped", port: null, url: null };
  mockComfyStopReason = { kind: "evicted" };
}

export function resetMockComfy(): void {
  mockComfyRoot = MOCK_COMFY_DEFAULT_ROOT;
  mockComfyStopReason = null;
  mockComfyInstalled = null;
  mockComfyServer = { state: "stopped", port: null, url: null };
  mockComfyCancel = false;
  mockComfyLogs.length = 0;
  delete mockAutoUpdate.comfyui;
}

export interface ModelsLocationInfo {
  dir: string;
  default_dir: string;
  is_default: boolean;
  free_bytes: number | null;
  size_bytes: number | null;
  models: number;
  writable: boolean;

  restart_required: boolean;
}

export interface MoveProgress {
  message: string;
  bytes_done?: number | null;
  bytes_total?: number | null;
}

const MOCK_MODELS_DEFAULT = "C:\\Users\\you\\AppData\\Roaming\\LemonAI\\models";
let mockModelsDir = MOCK_MODELS_DEFAULT;
let mockModelsSaved = MOCK_MODELS_DEFAULT;

export async function apiModelsLocation(path: string | null = null): Promise<ModelsLocationInfo> {
  if (isTauri()) return tauriInvoke<ModelsLocationInfo>("models_location", { path });
  if (path !== null && !/^([A-Za-z]:\\|\/)/.test(path)) throw new Error("Choose a full folder path (for example D:\\AI)");
  const dir = path === null ? mockModelsDir : /LemonAI-Models$/.test(path) ? path : `${path}\\LemonAI-Models`;
  return {
    dir,
    default_dir: MOCK_MODELS_DEFAULT,
    is_default: dir === MOCK_MODELS_DEFAULT,
    free_bytes: 1_200_000_000_000,
    size_bytes: path === null ? 21_500_000_000 : null,
    models: path === null ? 3 : 0,
    writable: true,
    restart_required: path === null && mockModelsSaved !== mockModelsDir,
  };
}

export async function apiModelsSetLocation(
  path: string | null,
  moveExisting: boolean,
  onProgress?: (progress: MoveProgress) => void
): Promise<ModelsLocationInfo> {
  if (isTauri()) {
    const { Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<MoveProgress>();
    channel.onmessage = (message) => onProgress?.(message);
    return tauriInvoke<ModelsLocationInfo>("models_set_location", { path, moveExisting, onProgress: channel });
  }
  const info = await apiModelsLocation(path);
  if (moveExisting) {
    for (const part of [1, 2, 3, 4]) {
      onProgress?.({ message: `Moving models (${part * 25}%)`, bytes_done: part * 5e9, bytes_total: 20e9 });
      await delay(5);
    }
  }
  mockModelsSaved = path === null ? MOCK_MODELS_DEFAULT : info.dir;
  return { ...info, dir: mockModelsSaved, is_default: path === null, models: moveExisting ? 3 : 0, restart_required: true };
}

export async function apiAppRestart(): Promise<void> {
  if (isTauri()) {
    await tauriInvoke<void>("app_restart");
    return;
  }
  mockModelsDir = mockModelsSaved;
}

export function resetMockModelsLocation(): void {
  mockModelsDir = MOCK_MODELS_DEFAULT;
  mockModelsSaved = MOCK_MODELS_DEFAULT;
}

export interface ModelUpdateInfo {
  model_id: string;
  installed_version: string;
  available_version: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function apiCheckModelUpdates(candidates: ModelPackageManifest[]): Promise<ModelUpdateInfo[]> {
  if (isTauri()) return tauriInvoke<ModelUpdateInfo[]>("check_model_updates", { candidates });
  const updates: ModelUpdateInfo[] = [];
  for (const candidate of candidates) {
    const installed = mockInstalled.get(candidate.id);
    if (installed && canonicalJson(installed) !== canonicalJson(candidate)) {
      updates.push({ model_id: candidate.id, installed_version: installed.version, available_version: candidate.version });
    }
  }
  return updates.sort((a, b) => a.model_id.localeCompare(b.model_id));
}

export interface HfRepoFile {
  path: string;
  size: number;
  sha256: string | null;
}

export interface HfRepoInfo {
  repo_id: string;
  gated: boolean;
  files: HfRepoFile[];
}

export async function apiHfRepoFiles(repoId: string): Promise<HfRepoInfo> {
  if (isTauri()) return tauriInvoke<HfRepoInfo>("hf_repo_files", { repoId });
  await delay(5);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoId.trim())) throw new Error(`'${repoId}' is not a Hugging Face repository id (expected owner/name)`);
  const sha = (seed: string) => seed.repeat(64).slice(0, 64);
  if (/gguf/i.test(repoId)) {
    return {
      repo_id: repoId,
      gated: false,
      files: [
        { path: "README.md", size: 4_000, sha256: null },
        { path: "model-Q4_K_M.gguf", size: 4_920_000_000, sha256: sha("a1") },
        { path: "model-Q8_0.gguf", size: 8_540_000_000, sha256: sha("b2") },
        { path: "split/model-00001-of-00002.gguf", size: 9_000_000_000, sha256: sha("c3") },
      ],
    };
  }
  return {
    repo_id: repoId,
    gated: false,
    files: [
      { path: "config.json", size: 700, sha256: null },
      { path: "model_index.json", size: 600, sha256: null },
      { path: "model.safetensors", size: 2_400_000_000, sha256: sha("d4") },
      { path: "pytorch_model.bin", size: 2_400_000_000, sha256: sha("e5") },
    ],
  };
}

export async function apiChatRegenerate(
  modelId: string,
  conversationId: string,
  text: string | null,
  params: Record<string, unknown>,
  handlers: InferenceHandlers
): Promise<Conversation> {
  if (handlers.signal?.aborted) throw abortError();
  if (isTauri()) {
    return invokeChatStream("chat_regenerate", modelId, { conversationId, text, params }, handlers);
  }
  const conversation = mockConversation(conversationId);
  if (mockState(modelId) !== "ready") throw new Error(`Model '${modelId}' is not running`);
  const backup = [...conversation.messages];
  while (conversation.messages.at(-1)?.role === "assistant") conversation.messages.pop();
  const question = conversation.messages.pop();
  if (!question) {
    conversation.messages = backup;
    throw new Error("There is no message to send again");
  }
  try {
    return await mockChatSend(modelId, conversationId, text?.trim() || question.content, params, handlers);
  } catch (err) {
    conversation.messages = backup;
    throw err;
  }
}

export async function apiChatContinue(
  modelId: string,
  conversationId: string,
  params: Record<string, unknown>,
  handlers: InferenceHandlers
): Promise<Conversation> {
  const { signal, onEvent } = handlers;
  if (signal?.aborted) throw abortError();
  if (isTauri()) {
    return invokeChatStream("chat_continue", modelId, { conversationId, params }, handlers);
  }
  const conversation = mockConversation(conversationId);
  if (mockState(modelId) !== "ready") throw new Error(`Model '${modelId}' is not running`);
  const last = conversation.messages.at(-1);
  if (!last || last.role !== "assistant") throw new Error("There is no assistant message to continue");
  mockCancelled.delete(modelId);
  mockStates[modelId] = "inferring";
  const nextPart = (last.parts ?? 1) + 1;
  onEvent({ kind: "continuing", part: nextPart, max_parts: nextPart });
  const ctxSize = mockModelContextSizes.get(modelId) ?? MOCK_CONTEXT_SIZE;
  const cancelled = () => Boolean(signal?.aborted) || mockCancelled.has(modelId);
  let addition = "";
  let interrupted = false;
  try {
    const piece = " ...continued cleanly.";
    if (cancelled()) {
      interrupted = true;
    } else {
      addition = piece;
      onEvent({ kind: "token", text: piece });
      await delay(5);
    }
    if (addition.trim()) {
      last.content = `${last.content}${addition}`;
      last.parts = nextPart;
      last.truncated = false;
      last.truncation_reason = null;
      last.interrupted = interrupted;
      last.tokens = (last.tokens ?? 0) + words(addition);
    }
    const promptTokens = mockPromptSize(conversation);
    conversation.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: words(addition),
      context_size: ctxSize,
    };
    conversation.updated_at = Date.now();
    onEvent({ kind: "usage", ...conversation.usage });
    onEvent({ kind: "done" });
    return structuredClone(conversation);
  } finally {
    mockStates[modelId] = "ready";
    mockCancelled.delete(modelId);
  }
}

const MOCK_LOGS_DIR = "C:\\Users\\demo\\AppData\\Roaming\\com.lemonai.desktop\\logs";

export async function apiGetLogsFolder(): Promise<string> {
  if (isTauri()) return tauriInvoke<string>("get_logs_folder");
  return MOCK_LOGS_DIR;
}

export async function apiOpenLogsFolder(): Promise<string> {
  if (isTauri()) return tauriInvoke<string>("open_logs_folder");
  return MOCK_LOGS_DIR;
}

export async function saveTextFile(defaultName: string, contents: string, extension: "md" | "txt" | "json"): Promise<boolean> {
  const suggestedName = defaultName.toLowerCase().endsWith(`.${extension}`)
    ? defaultName
    : `${defaultName}.${extension}`;
  if (isTauri()) {
    return tauriInvoke<boolean>("save_text_file", { suggestedName, contents });
  }
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

export interface HistoryEntry {
  id: string;
  model_id: string;
  model_name: string;
  kind: "image" | "audio" | string;
  mime: string;
  created_at: number;
  bytes: number;
  params: Record<string, unknown> | null;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  dir: string;
}

const mockHistory: { entry: HistoryEntry; dataUrl: string }[] = [];

export async function apiHistorySave(
  modelId: string,
  modelName: string,
  dataUrl: string,
  params: Record<string, unknown>
): Promise<HistoryEntry> {
  if (isTauri()) return tauriInvoke<HistoryEntry>("history_save", { modelId, modelName, dataUrl, params });
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "application/octet-stream";
  const now = Date.now() + mockHistory.length;
  const entry: HistoryEntry = {
    id: `${now}-${(mockHistory.length % 65536).toString(16).padStart(4, "0")}`,
    model_id: modelId,
    model_name: modelName,
    kind: mime.startsWith("audio/") ? "audio" : "image",
    mime,
    created_at: now,
    bytes: dataUrl.length,
    params,
  };
  mockHistory.unshift({ entry, dataUrl });
  return entry;
}

export async function apiHistoryList(modelId: string | null = null, offset = 0, limit = 48): Promise<HistoryPage> {
  if (isTauri()) return tauriInvoke<HistoryPage>("history_list", { modelId, offset, limit });
  const all = mockHistory.map((h) => h.entry).filter((e) => !modelId || e.model_id === modelId);
  return { entries: all.slice(offset, offset + limit), total: all.length, dir: "C:\\Users\\you\\AppData\\Roaming\\LemonAI\\outputs" };
}

export async function apiHistoryRead(id: string): Promise<string> {
  if (isTauri()) return tauriInvoke<string>("history_read", { id });
  const found = mockHistory.find((h) => h.entry.id === id);
  if (!found) throw new Error("This result no longer exists");
  return found.dataUrl;
}

export async function apiHistoryReveal(id: string): Promise<void> {
  if (isTauri()) await tauriInvoke<void>("history_reveal", { id });
}

export async function apiHistoryDelete(ids: string[]): Promise<number> {
  if (isTauri()) return tauriInvoke<number>("history_delete", { ids });
  let removed = 0;
  for (const id of ids) {
    const index = mockHistory.findIndex((h) => h.entry.id === id);
    if (index >= 0) {
      mockHistory.splice(index, 1);
      removed++;
    }
  }
  return removed;
}

export function resetMockHistory(): void {
  mockHistory.length = 0;
}

export async function saveHistoryFile(entry: HistoryEntry): Promise<boolean> {
  const ext = (entry.mime.split("/")[1] ?? "bin").replace("x-wav", "wav").replace("wave", "wav").replace("jpeg", "jpg").replace("mpeg", "mp3");
  const name = `lemonai-${entry.model_id}-${entry.id}.${ext}`;
  if (isTauri()) {
    return tauriInvoke<boolean>("history_export", { id: entry.id, suggestedName: name });
  }
  const data = await apiHistoryRead(entry.id);
  if (typeof document === "undefined") return false;
  const link = document.createElement("a");
  link.href = data;
  link.download = name;
  link.click();
  return true;
}

export async function apiHubGetRefreshToken(): Promise<string | null> {
  if (isTauri()) return tauriInvoke<string | null>("hub_get_refresh_token");
  return null;
}

export async function apiHubSetRefreshToken(token: string): Promise<void> {
  if (isTauri()) {
    await tauriInvoke<void>("hub_set_refresh_token", { token });
  }
}

export async function apiHubClearRefreshToken(): Promise<void> {
  if (isTauri()) {
    await tauriInvoke<void>("hub_clear_refresh_token");
  }
}

export interface AppUpdateInfo {

  configured: boolean;
  current_version: string;
  available: { version: string; notes: string | null; date: string | null } | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  finished: boolean;
}

let mockAppUpdate: AppUpdateInfo["available"] = null;

export async function apiAppUpdateCheck(hubUrl: string): Promise<AppUpdateInfo> {
  if (isTauri()) return tauriInvoke<AppUpdateInfo>("app_update_check", { hubUrl });
  return { configured: mockAppUpdate !== null, current_version: "0.1.0", available: mockAppUpdate };
}

export async function apiAppUpdateInstall(hubUrl: string, onProgress?: (p: UpdateProgress) => void): Promise<void> {
  if (isTauri()) {
    const { Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<UpdateProgress>();
    channel.onmessage = (message) => onProgress?.(message);
    await tauriInvoke<void>("app_update_install", { hubUrl, onProgress: channel });
    return;
  }
  for (const part of [1, 2, 3, 4]) {
    onProgress?.({ downloaded: part * 2_500_000, total: 10_000_000, finished: false });
    await delay(5);
  }
  onProgress?.({ downloaded: 0, total: null, finished: true });
  mockAppUpdate = null;
}

export function mockAppUpdateAvailable(version: string | null, notes: string | null = null): void {
  mockAppUpdate = version ? { version, notes, date: null } : null;
}

export type AiProviderKind =
  | "google_ai_studio"
  | "openai"
  | "anthropic"
  | "xai"
  | "vertex_ai"
  | "custom_openai"
  | "local_model";

export interface AiModelInfo {
  id: string;
  display_name: string;
}

export interface AiProviderPublic {
  id: string;
  kind: AiProviderKind;
  label: string;
  has_key: boolean;
  key_hint: string | null;
  base_url: string | null;
  project_id: string | null;
  region: string | null;
  default_model: string | null;
  cached_models: AiModelInfo[];
  is_default: boolean;
}

export interface SaveAiProviderInput {
  id?: string | null;
  kind: AiProviderKind;
  label: string;
  api_key?: string | null;
  base_url?: string | null;
  project_id?: string | null;
  region?: string | null;
  default_model?: string | null;
  is_default?: boolean | null;
}

interface MockStoredAiProvider {
  id: string;
  kind: AiProviderKind;
  label: string;
  api_key: string | null;
  base_url: string | null;
  project_id: string | null;
  region: string | null;
  default_model: string | null;
  cached_models: AiModelInfo[];
  is_default: boolean;
}

const mockAiProviders: MockStoredAiProvider[] = [];

function maskSecretMock(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function toPublicAiProvider(p: MockStoredAiProvider): AiProviderPublic {
  const key = p.api_key?.trim() || null;
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    has_key: key !== null,
    key_hint: key ? maskSecretMock(key) : null,
    base_url: p.base_url,
    project_id: p.project_id,
    region: p.region,
    default_model: p.default_model,
    cached_models: [...p.cached_models],
    is_default: p.is_default,
  };
}

const MOCK_PROVIDER_MODELS: Record<Exclude<AiProviderKind, "local_model">, AiModelInfo[]> = {
  google_ai_studio: [
    { id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", display_name: "Gemini 2.5 Flash" },
  ],
  openai: [
    { id: "gpt-4.1", display_name: "GPT-4.1" },
    { id: "gpt-4.1-mini", display_name: "GPT-4.1 Mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
    { id: "claude-3-5-haiku-20241022", display_name: "Claude 3.5 Haiku" },
  ],
  xai: [
    { id: "grok-3", display_name: "Grok 3" },
    { id: "grok-3-mini", display_name: "Grok 3 Mini" },
  ],
  vertex_ai: [
    { id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", display_name: "Gemini 2.5 Flash" },
  ],
  custom_openai: [
    { id: "llama-3.3-70b", display_name: "Llama 3.3 70B" },
    { id: "qwen2.5-32b", display_name: "Qwen 2.5 32B" },
  ],
};

export async function apiAiProvidersList(): Promise<AiProviderPublic[]> {
  if (isTauri()) return tauriInvoke<AiProviderPublic[]>("ai_providers_list");
  return mockAiProviders.map(toPublicAiProvider);
}

export async function apiAiProviderSave(input: SaveAiProviderInput): Promise<AiProviderPublic> {
  if (isTauri()) return tauriInvoke<AiProviderPublic>("ai_provider_save", { input });
  const label = input.label.trim();
  if (!label) throw new Error("provider label cannot be empty");
  const baseUrl = input.base_url?.trim() || null;
  if (input.kind === "custom_openai" && !baseUrl) {
    throw new Error("custom_openai provider requires a valid base_url");
  }
  const projectId = input.project_id?.trim() || null;
  const region = input.region?.trim() || null;
  const defaultModel = input.default_model?.trim() || null;
  const reqId = input.id?.trim() || null;

  let idx = reqId ? mockAiProviders.findIndex((p) => p.id === reqId) : -1;
  if (idx >= 0) {
    const existing = mockAiProviders[idx];
    existing.kind = input.kind;
    existing.label = label;
    if (input.api_key !== undefined && input.api_key !== null) {
      const trimmedKey = input.api_key.trim();
      existing.api_key = trimmedKey || null;
    }
    existing.base_url = baseUrl;
    existing.project_id = projectId;
    existing.region = region;
    existing.default_model = defaultModel;
  } else {
    const id = reqId ?? `${input.kind}-${mockId(8)}`;
    const isFirst = mockAiProviders.length === 0;
    const apiKey = input.api_key?.trim() || null;
    mockAiProviders.push({
      id,
      kind: input.kind,
      label,
      api_key: apiKey,
      base_url: baseUrl,
      project_id: projectId,
      region,
      default_model: defaultModel,
      cached_models: [],
      is_default: isFirst,
    });
    idx = mockAiProviders.length - 1;
  }

  if (input.is_default === true) {
    mockAiProviders.forEach((p, i) => {
      p.is_default = i === idx;
    });
  } else if (!mockAiProviders.some((p) => p.is_default)) {
    mockAiProviders[0].is_default = true;
  }

  return toPublicAiProvider(mockAiProviders[idx]);
}

export async function apiAiProviderDelete(id: string): Promise<AiProviderPublic[]> {
  if (isTauri()) return tauriInvoke<AiProviderPublic[]>("ai_provider_delete", { id });
  const pos = mockAiProviders.findIndex((p) => p.id === id);
  if (pos >= 0) {
    const wasDefault = mockAiProviders[pos].is_default;
    mockAiProviders.splice(pos, 1);
    if (wasDefault && mockAiProviders.length > 0) {
      mockAiProviders.forEach((p, i) => {
        p.is_default = i === 0;
      });
    }
  }
  return mockAiProviders.map(toPublicAiProvider);
}

export async function apiAiProviderSetDefault(
  id: string,
  defaultModel?: string | null
): Promise<AiProviderPublic[]> {
  if (isTauri()) {
    return tauriInvoke<AiProviderPublic[]>("ai_provider_set_default", {
      id,
      defaultModel: defaultModel ?? null,
    });
  }
  const idx = mockAiProviders.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`AI provider '${id}' not found`);
  mockAiProviders.forEach((p, i) => {
    p.is_default = i === idx;
  });
  if (defaultModel !== undefined && defaultModel !== null) {
    const trimmed = defaultModel.trim();
    mockAiProviders[idx].default_model = trimmed || null;
  }
  return mockAiProviders.map(toPublicAiProvider);
}

export async function apiAiProviderFetchModels(id: string): Promise<AiModelInfo[]> {
  if (isTauri()) return tauriInvoke<AiModelInfo[]>("ai_provider_fetch_models", { id });
  const provider = mockAiProviders.find((p) => p.id === id);
  if (!provider) throw new Error(`AI provider '${id}' not found`);
  let models: AiModelInfo[];
  if (provider.kind === "local_model") {
    models = [...mockInstalled.values()]
      .filter((m) => supportsChat(m))
      .map((m) => ({ id: m.id, display_name: m.name }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } else {
    models = [...MOCK_PROVIDER_MODELS[provider.kind]];
  }
  provider.cached_models = models;
  return models;
}

export function resetMockAiProviders(): void {
  mockAiProviders.length = 0;
}

export interface CivitaiGenerationMeta {
  sampler: string | null;
  cfg_scale: number | null;
  steps: number | null;
  width: number | null;
  height: number | null;
  negative_prompt: string | null;
}

export interface CivitaiFileInfo {
  name: string;
  size_bytes: number;
  sha256: string | null;
  download_url: string;
  primary: boolean;
}

export interface CivitaiModelInfo {
  model_id: number;
  version_id: number;
  name: string;
  description_text: string;
  model_type: string;
  base_model: string | null;
  nsfw: boolean;
  trained_words: string[];
  files: CivitaiFileInfo[];
  recommended_params: CivitaiGenerationMeta | null;
}

let mockCivitaiToken: string | null = null;

function mockCivitaiStatus(): HfTokenStatus {
  return mockCivitaiToken
    ? { set: true, hint: maskSecretMock(mockCivitaiToken) }
    : { set: false, hint: null };
}

export async function apiCivitaiTokenStatus(): Promise<HfTokenStatus> {
  if (isTauri()) return tauriInvoke<HfTokenStatus>("civitai_token_status");
  return mockCivitaiStatus();
}

export async function apiSetCivitaiToken(token: string): Promise<HfTokenStatus> {
  if (isTauri()) return tauriInvoke<HfTokenStatus>("set_civitai_token", { token });
  const trimmed = token.trim();
  mockCivitaiToken = trimmed || null;
  return mockCivitaiStatus();
}

export async function apiClearCivitaiToken(): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("clear_civitai_token");
  mockCivitaiToken = null;
}

export async function apiCivitaiFetchInfo(urlOrId: string): Promise<CivitaiModelInfo> {
  if (isTauri()) return tauriInvoke<CivitaiModelInfo>("civitai_fetch_info", { urlOrId });
  const trimmed = urlOrId.trim();
  const idMatch = trimmed.match(/(?:models\/)?(\d+)/);
  if (!idMatch) throw new Error(`Invalid CivitAI URL or model ID '${trimmed}'`);
  const modelId = Number(idMatch[1]);
  const versionMatch = trimmed.match(/modelVersionId=(\d+)/);
  const versionId = versionMatch ? Number(versionMatch[1]) : modelId * 10 + 1;
  return {
    model_id: modelId,
    version_id: versionId,
    name: `DreamShaper XL #${modelId}`,
    description_text: "High-detail SDXL checkpoint with cinematic lighting.",
    model_type: "Checkpoint",
    base_model: "SDXL 1.0",
    nsfw: false,
    trained_words: ["dreamshaper", "cinematic lighting"],
    files: [
      {
        name: `dreamshaper_xl_${versionId}.safetensors`,
        size_bytes: 6_800_000_000,
        sha256: "a".repeat(64),
        download_url: `https://civitai.com/api/download/models/${versionId}`,
        primary: true,
      },
    ],
    recommended_params: {
      sampler: "DPM++ 2M Karras",
      cfg_scale: 6.5,
      steps: 28,
      width: 832,
      height: 1216,
      negative_prompt: "blurry, watermark, lowres",
    },
  };
}

export function resetMockCivitaiToken(): void {
  mockCivitaiToken = null;
}

export interface SourceSummary {
  source: string;
  identifier: string;
  title: string;
  file_count: number;
  base_model: string | null;
  trained_words: string[];
}

export interface ExtractedManifestResult {
  manifest: ModelPackageManifest;
  source_summary: SourceSummary;
  warnings: string[];
}

export async function apiManifestExtractFromUrl(
  url: string,
  providerId?: string | null,
  modelOverride?: string | null
): Promise<ExtractedManifestResult> {
  if (isTauri()) {
    return tauriInvoke<ExtractedManifestResult>("manifest_extract_from_url", {
      url,
      providerId: providerId ?? null,
      modelOverride: modelOverride ?? null,
    });
  }
  const trimmed = url.trim();
  if (!trimmed) throw new Error("URL cannot be empty");
  const isCivitai = trimmed.includes("civitai.com");
  if (isCivitai) {
    const info = await apiCivitaiFetchInfo(trimmed);
    const file = info.files[0];
    const manifest: ModelPackageManifest = {
      schema_version: "1.0.0",
      id: `civitai-${info.model_id}`,
      name: info.name,
      version: "1.0.0",
      description: info.description_text,
      category: "image",
      content_rating: info.nsfw ? "adult" : "general",
      engine: "python_uv",
      hardware_requirements: {
        min_vram_gb: 8,
        min_ram_gb: 16,
        supported_accelerators: ["cuda", "cpu"],
      },
      install: [
        { step_type: "setup_venv", python_version: "3.11" },
        {
          step_type: "uv_pip_install",
          packages: ["torch>=2.4.0", "diffusers>=0.30.0", "transformers>=4.45.0", "accelerate>=0.34.0", "fastapi", "uvicorn", "pydantic"],
        },
        {
          step_type: "civitai_download",
          civitai_model_id: info.model_id,
          civitai_version_id: info.version_id,
          filename: file.name,
          destination: `weights/${file.name}`,
          sha256: file.sha256,
        },
      ],
      runtime: {
        archetype: "diffusers_pipeline",
        entrypoint: "diffusers_runner.py",
        arguments: [],
        transport: "loopback_http",
        health_endpoint: "/health",
        readiness_timeout_sec: 300,
      },
      ui: {
        title: info.name,
        description: info.description_text,
        columns: 2,
        presets: info.recommended_params
          ? [
              {
                id: "author_recommended",
                label: "Author Recommended",
                values: {
                  steps: info.recommended_params.steps ?? 28,
                  guidance_scale: info.recommended_params.cfg_scale ?? 6.5,
                  dimensions: `${info.recommended_params.width ?? 832}x${info.recommended_params.height ?? 1216}`,
                },
              },
            ]
          : undefined,
        inputs: [
          {
            name: "prompt",
            label: "Prompt",
            widget: "textarea",
            required: true,
            quick_chips: info.trained_words,
            grid_cols: 3,
          },
          {
            name: "steps",
            label: "Steps",
            widget: "slider",
            min: 1,
            max: 60,
            step: 1,
            default: info.recommended_params?.steps ?? 28,
            unit: "steps",
          },
          {
            name: "guidance_scale",
            label: "CFG Scale",
            widget: "slider",
            min: 1,
            max: 15,
            step: 0.5,
            default: info.recommended_params?.cfg_scale ?? 6.5,
          },
          {
            name: "dimensions",
            label: "Dimensions",
            widget: "dimensions",
            default: "832x1216",
          },
          {
            name: "seed",
            label: "Seed",
            widget: "seed",
            default: -1,
          },
        ],
        output: { type: "image", protocol: "ipc_stream" },
      },
    };
    return {
      manifest,
      source_summary: {
        source: "civitai",
        identifier: `civitai:${info.model_id}:${info.version_id}`,
        title: info.name,
        file_count: info.files.length,
        base_model: info.base_model,
        trained_words: info.trained_words,
      },
      warnings: [],
    };
  }

  const repoMatch = trimmed.match(/(?:huggingface\.co\/|hf\.co\/)?([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)/);
  if (!repoMatch) throw new Error(`Unrecognized model URL '${trimmed}'`);
  const repoId = repoMatch[1];
  const shortName = repoId.split("/")[1] ?? repoId;
  const slug = shortName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "extracted-model";
  const manifest: ModelPackageManifest = {
    schema_version: "1.0.0",
    id: slug,
    name: shortName,
    version: "1.0.0",
    description: `Extracted from Hugging Face repository ${repoId}`,
    category: "llm",
    content_rating: "general",
    engine: "standalone_binary",
    hardware_requirements: {
      min_vram_gb: 4,
      min_ram_gb: 8,
      supported_accelerators: ["cuda", "rocm", "metal", "cpu"],
    },
    install: [
      {
        step_type: "hf_download",
        repo_id: repoId,
        filename: `${shortName}-Q4_K_M.gguf`,
        destination: "weights/model.gguf",
        sha256: "b".repeat(64),
      },
    ],
    runtime: {
      archetype: "llama_cpp_server",
      entrypoint: "llama-server",
      arguments: [],
      context_window: { recommended: 8192, max_supported: 131072 },
      output_tokens: { recommended: 4096, max_supported: 131072 },
      transport: "loopback_http",
      health_endpoint: "/health",
      readiness_timeout_sec: 120,
    },
    ui: {
      title: shortName,
      description: `Extracted from ${repoId}`,
      columns: 2,
      inputs: [
        { name: "prompt", label: "Prompt", widget: "textarea", required: true, grid_cols: 3 },
        { name: "temperature", label: "Temperature", widget: "slider", min: 0, max: 2, step: 0.05, default: 0.7 },
        { name: "max_tokens", label: "Max Tokens", widget: "number", min: 1, max: 8192, step: 1, default: 1024, unit: "tokens" },
      ],
      output: { type: "markdown", protocol: "ipc_stream" },
    },
  };
  return {
    manifest,
    source_summary: {
      source: "huggingface",
      identifier: repoId,
      title: shortName,
      file_count: 3,
      base_model: "text-generation",
      trained_words: [],
    },
    warnings: [],
  };
}

export interface VaultEntry {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  updated_at_ms: number;
  manifest: ModelPackageManifest;
}

const mockVault = new Map<string, VaultEntry>();

export function mockValidateManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return ["Manifest schema error: expected a JSON object"];
  }
  const m = value as Partial<ModelPackageManifest>;
  if (!m.id || !/^[a-z0-9_-]{1,100}$/.test(m.id)) {
    errors.push(`Invalid vault manifest id '${String(m.id ?? "")}': must match ^[a-z0-9_-]+$ (1-100 chars)`);
  }
  if (!m.name || !String(m.name).trim()) {
    errors.push("Manifest name cannot be empty");
  }
  if (!m.version || !String(m.version).trim()) {
    errors.push("Manifest version cannot be empty");
  }
  if (!Array.isArray(m.install) || m.install.length === 0) {
    errors.push("Manifest must contain at least one install step");
  }
  if (!m.ui || !Array.isArray(m.ui.inputs)) {
    errors.push("Manifest must define ui.inputs");
  }
  const validateRangePair = (
    pair: unknown,
    path: string,
    minVal: number,
    maxVal: number
  ): { max_supported?: number } | null => {
    if (pair === undefined || pair === null) return null;
    if (typeof pair !== "object" || Array.isArray(pair)) {
      errors.push(`${path} must be an object`);
      return null;
    }
    const { recommended, max_supported } = pair as { recommended?: unknown; max_supported?: unknown };
    if (
      typeof recommended !== "number" ||
      !Number.isInteger(recommended) ||
      recommended < minVal ||
      recommended > maxVal
    ) {
      errors.push(`${path}.recommended must be an integer between ${minVal} and ${maxVal}`);
    }
    if (
      typeof max_supported !== "number" ||
      !Number.isInteger(max_supported) ||
      max_supported < minVal ||
      max_supported > maxVal
    ) {
      errors.push(`${path}.max_supported must be an integer between ${minVal} and ${maxVal}`);
    }
    if (typeof recommended === "number" && typeof max_supported === "number" && recommended > max_supported) {
      errors.push(`${path}.recommended cannot exceed max_supported`);
    }
    return typeof max_supported === "number" ? { max_supported } : {};
  };
  const rt = m.runtime as { context_window?: unknown; output_tokens?: unknown } | undefined;
  const baseCw = validateRangePair(rt?.context_window, "runtime.context_window", MIN_CONTEXT_WINDOW, MAX_CONTEXT_WINDOW);
  const baseOt = validateRangePair(rt?.output_tokens, "runtime.output_tokens", MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
  if (baseOt?.max_supported !== undefined && baseCw?.max_supported !== undefined && baseOt.max_supported > baseCw.max_supported) {
    errors.push("runtime.output_tokens.max_supported cannot exceed runtime.context_window.max_supported");
  }
  if (Array.isArray(m.variants)) {
    m.variants.forEach((v, idx) => {
      if (v && typeof v === "object") {
        const vo = v as { context_window?: unknown; output_tokens?: unknown };
        const vCw = validateRangePair(vo.context_window, `variants[${idx}].context_window`, MIN_CONTEXT_WINDOW, MAX_CONTEXT_WINDOW);
        const vOt = validateRangePair(vo.output_tokens, `variants[${idx}].output_tokens`, MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
        const effMaxCtx = vCw?.max_supported ?? baseCw?.max_supported;
        if (vOt?.max_supported !== undefined && effMaxCtx !== undefined && vOt.max_supported > effMaxCtx) {
          errors.push(`variants[${idx}].output_tokens.max_supported cannot exceed context_window.max_supported`);
        }
      }
    });
  }
  return errors;
}

export async function apiVaultList(): Promise<VaultEntry[]> {
  if (isTauri()) return tauriInvoke<VaultEntry[]>("vault_list");
  return [...mockVault.values()].sort(
    (a, b) => b.updated_at_ms - a.updated_at_ms || a.id.localeCompare(b.id)
  );
}

export async function apiVaultGet(id: string): Promise<VaultEntry> {
  if (isTauri()) return tauriInvoke<VaultEntry>("vault_get", { id });
  const entry = mockVault.get(id);
  if (!entry) throw new Error(`Vault manifest '${id}' not found`);
  return structuredClone(entry);
}

export async function apiVaultSave(manifest: ModelPackageManifest): Promise<VaultEntry> {
  if (isTauri()) return tauriInvoke<VaultEntry>("vault_save", { manifest });
  const errors = mockValidateManifest(manifest);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const entry: VaultEntry = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? null,
    category: manifest.category ?? null,
    updated_at_ms: Date.now(),
    manifest: structuredClone(manifest),
  };
  mockVault.set(manifest.id, entry);
  return structuredClone(entry);
}

export async function apiVaultDelete(id: string): Promise<void> {
  if (isTauri()) return tauriInvoke<void>("vault_delete", { id });
  mockVault.delete(id);
}

export async function apiVaultValidate(manifest: unknown): Promise<string[]> {
  if (isTauri()) return tauriInvoke<string[]>("vault_validate", { manifest });
  return mockValidateManifest(manifest);
}

export function resetMockVault(): void {
  mockVault.clear();
}

export type WebSearchProviderKind = "duckduckgo" | "brave" | "tavily" | "searxng";

export interface WebSearchConfigPublic {
  provider: WebSearchProviderKind;
  has_key: boolean;
  key_hint: string | null;
  base_url: string | null;
  max_results: number;
  fetch_pages: boolean;
}

export interface SaveWebSearchConfigInput {
  provider: WebSearchProviderKind;
  api_key?: string | null;
  base_url?: string | null;
  max_results?: number | null;
  fetch_pages?: boolean | null;
}

interface MockWebSearchConfig {
  provider: WebSearchProviderKind;
  api_key: string | null;
  base_url: string | null;
  max_results: number;
  fetch_pages: boolean;
}

let mockWebSearchConfig: MockWebSearchConfig = {
  provider: "duckduckgo",
  api_key: null,
  base_url: null,
  max_results: 5,
  fetch_pages: true,
};

function toPublicWebSearchConfig(cfg: MockWebSearchConfig): WebSearchConfigPublic {
  return {
    provider: cfg.provider,
    has_key: Boolean(cfg.api_key),
    key_hint: cfg.api_key ? maskSecretMock(cfg.api_key) : null,
    base_url: cfg.base_url,
    max_results: cfg.max_results,
    fetch_pages: cfg.fetch_pages,
  };
}

function validateMockEndpointUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`invalid endpoint URL '${trimmed}'`);
  }
  const ok =
    (parsed.protocol === "https:" && Boolean(parsed.hostname)) ||
    (parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  if (!ok) {
    throw new Error(`endpoint URL '${trimmed}' must use https:// or loopback http://`);
  }
  return trimmed.replace(/\/+$/, "");
}

export async function apiGetWebSearchConfig(): Promise<WebSearchConfigPublic> {
  if (isTauri()) return tauriInvoke<WebSearchConfigPublic>("web_search_config_get");
  return toPublicWebSearchConfig(mockWebSearchConfig);
}

export async function apiSaveWebSearchConfig(input: SaveWebSearchConfigInput): Promise<WebSearchConfigPublic> {
  if (isTauri()) return tauriInvoke<WebSearchConfigPublic>("web_search_config_save", { input });
  const rawBase = input.base_url?.trim() || null;
  const baseUrl = rawBase ? validateMockEndpointUrl(rawBase) : null;
  if (input.provider === "searxng" && !baseUrl) {
    throw new Error("SearXNG provider requires a valid base_url");
  }
  let nextKey = mockWebSearchConfig.api_key;
  if (input.api_key !== undefined && input.api_key !== null) {
    const trimmedKey = input.api_key.trim();
    nextKey = trimmedKey || null;
  }
  const maxResults =
    typeof input.max_results === "number" ? Math.max(1, Math.min(10, Math.round(input.max_results))) : mockWebSearchConfig.max_results;
  const fetchPages =
    typeof input.fetch_pages === "boolean" ? input.fetch_pages : mockWebSearchConfig.fetch_pages;

  mockWebSearchConfig = {
    provider: input.provider,
    api_key: nextKey,
    base_url: baseUrl,
    max_results: maxResults,
    fetch_pages: fetchPages,
  };
  return toPublicWebSearchConfig(mockWebSearchConfig);
}

export function resetMockWebSearchConfig(): void {
  mockWebSearchConfig = {
    provider: "duckduckgo",
    api_key: null,
    base_url: null,
    max_results: 5,
    fetch_pages: true,
  };
}
