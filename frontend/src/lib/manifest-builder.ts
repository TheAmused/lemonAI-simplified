import type {
  Accelerator,
  ContextWindowConfig,
  ModelPackageManifest,
  OutputTokensConfig,
  RuntimeArchetype,
  UIInputDefinition,
} from "@/types/manifest";

export type RunnerKind = "transformers" | "gguf" | "diffusers" | "audio";

export interface ManifestDraft {
  name: string;

  slug?: string;
  description: string;
  category: string;
  runner: RunnerKind;

  repoId: string;

  filename?: string;

  sha256?: string;
  minVramGb: number;
  minRamGb: number;
  recommendedCtxSize?: number;
  maxSupportedCtxSize?: number;
  recommendedOutputTokens?: number;
  maxSupportedOutputTokens?: number;
}

const MIN_CTX_WINDOW = 256;
const MAX_CTX_WINDOW = 2_097_152;
const MIN_OUT_TOKENS = 64;
const MAX_OUT_TOKENS = 2_097_152;

function defaultContextWindow(runner: RunnerKind): ContextWindowConfig | undefined {
  if (runner === "gguf") return { recommended: 8192, max_supported: 131072 };
  if (runner === "transformers") return { recommended: 8192, max_supported: 32768 };
  return undefined;
}

function defaultOutputTokens(runner: RunnerKind): OutputTokensConfig | undefined {
  if (runner === "gguf") return { recommended: 4096, max_supported: 131072 };
  if (runner === "transformers") return { recommended: 4096, max_supported: 32768 };
  return undefined;
}

function buildContextWindow(
  runner: RunnerKind,
  recommended?: number,
  maxSupported?: number
): ContextWindowConfig | undefined {
  const defaults = defaultContextWindow(runner);
  if (!defaults) return undefined;
  const checkBound = (n: number, label: string) => {
    if (!Number.isInteger(n) || n < MIN_CTX_WINDOW || n > MAX_CTX_WINDOW) {
      throw new DraftError(`${label} musi być liczbą całkowitą od ${MIN_CTX_WINDOW} do ${MAX_CTX_WINDOW}.`);
    }
  };
  const rec = recommended !== undefined ? recommended : defaults.recommended;
  checkBound(rec, "Zalecane okno kontekstu");
  if (maxSupported !== undefined) {
    checkBound(maxSupported, "Maksymalne obsługiwane okno kontekstu");
    if (rec > maxSupported) {
      throw new DraftError("Zalecane okno kontekstu nie może przekraczać maksymalnego obsługiwanego.");
    }
    return { recommended: rec, max_supported: maxSupported };
  }
  return {
    recommended: rec,
    max_supported: Math.max(defaults.max_supported, rec),
  };
}

function buildOutputTokens(
  runner: RunnerKind,
  maxContext: number | undefined,
  recommended?: number,
  maxSupported?: number
): OutputTokensConfig | undefined {
  const defaults = defaultOutputTokens(runner);
  if (!defaults) return undefined;
  const checkBound = (n: number, label: string) => {
    if (!Number.isInteger(n) || n < MIN_OUT_TOKENS || n > MAX_OUT_TOKENS) {
      throw new DraftError(`${label} musi być liczbą całkowitą od ${MIN_OUT_TOKENS} do ${MAX_OUT_TOKENS}.`);
    }
  };
  const ctxCap = maxContext ?? defaults.max_supported;
  const rawRec = recommended !== undefined ? recommended : Math.min(defaults.recommended, ctxCap);
  checkBound(rawRec, "Zalecany limit wyjścia");
  if (maxSupported !== undefined) {
    checkBound(maxSupported, "Maksymalny obsługiwany limit wyjścia");
    if (rawRec > maxSupported) {
      throw new DraftError("Zalecany limit wyjścia nie może przekraczać maksymalnego obsługiwanego.");
    }
    if (maxSupported > ctxCap) {
      throw new DraftError("Maksymalny limit wyjścia nie może przekraczać maksymalnego okna kontekstu.");
    }
    return { recommended: rawRec, max_supported: maxSupported };
  }
  const effectiveMax = Math.min(ctxCap, Math.max(defaults.max_supported, rawRec));
  return {
    recommended: Math.min(rawRec, effectiveMax),
    max_supported: effectiveMax,
  };
}

export class DraftError extends Error {}

export function slugify(input: string, maxLength = 80): string {
  const folded = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/gi, "l")
    .toLowerCase();
  return folded
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, maxLength)
    .replace(/[-_]+$/g, "");
}

const HF_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export function isValidRepoId(value: string): boolean {
  return HF_REPO.test(value) && !value.includes("..");
}

const PY_COMMON = ["torch>=2.4.0", "transformers>=4.45.0", "accelerate>=0.34.0"];
const SERVER = ["fastapi", "uvicorn", "pydantic"];

const RUNNERS: Record<
  RunnerKind,
  { archetype: RuntimeArchetype; entrypoint: string; packages: string[]; output: "markdown" | "image" | "text" }
> = {
  transformers: {
    archetype: "transformers_pipeline",
    entrypoint: "transformers_runner.py",
    packages: [...PY_COMMON, ...SERVER],
    output: "markdown",
  },
  gguf: { archetype: "llama_cpp_server", entrypoint: "llama-server", packages: [], output: "markdown" },
  diffusers: {
    archetype: "diffusers_pipeline",
    entrypoint: "diffusers_runner.py",
    packages: [...PY_COMMON, "diffusers>=0.30.0", "sentencepiece", "protobuf", ...SERVER],
    output: "image",
  },
  audio: {
    archetype: "audio_pipeline",
    entrypoint: "audio_runner.py",
    packages: [...PY_COMMON, "torchaudio>=2.4.0", "numpy", "soundfile", ...SERVER],
    output: "text",
  },
};

function inputsFor(runner: RunnerKind): UIInputDefinition[] {
  switch (runner) {
    case "diffusers":
      return [
        { name: "prompt", label: "Prompt", widget: "textarea", required: true },
        { name: "steps", label: "Inference steps", widget: "slider", min: 1, max: 50, step: 1, default: 20 },
        { name: "seed", label: "Seed", widget: "number", min: 0, max: 2147483647, step: 1, required: false },
      ];
    case "audio":
      return [{ name: "audio_file", label: "Audio file", widget: "file_upload", required: true, accept: "audio/*" }];
    default:
      return [
        { name: "prompt", label: "Prompt", widget: "textarea", required: true },
        { name: "temperature", label: "Temperature", widget: "slider", min: 0, max: 2, step: 0.05, default: 0.7 },
        { name: "max_tokens", label: "Max tokens", widget: "number", min: 1, max: 8192, step: 1, default: 512 },
      ];
  }
}

export function buildManifest(draft: ManifestDraft): ModelPackageManifest {
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (!name || !description) throw new DraftError("Nazwa i opis modelu są wymagane.");
  if (!isValidRepoId(draft.repoId.trim())) {
    throw new DraftError("Repozytorium Hugging Face musi mieć postać 'właściciel/nazwa'.");
  }
  if (!Number.isFinite(draft.minVramGb) || draft.minVramGb < 0 || draft.minVramGb > 1024) {
    throw new DraftError("Minimalny VRAM musi mieścić się w zakresie 0–1024 GB (0 = tylko CPU).");
  }
  if (!Number.isFinite(draft.minRamGb) || draft.minRamGb < 1 || draft.minRamGb > 4096) {
    throw new DraftError("Minimalny RAM musi mieścić się w zakresie 1–4096 GB.");
  }

  const spec = RUNNERS[draft.runner];
  const id = slugify(draft.slug?.trim() || name) || `model-${Math.random().toString(36).slice(2, 10)}`;
  const repoId = draft.repoId.trim();

  let install: ModelPackageManifest["install"];
  let accelerators: Accelerator[];
  if (draft.runner === "gguf") {
    const filename = draft.filename?.trim() ?? "";
    if (!filename.toLowerCase().endsWith(".gguf") || /[\\/]/.test(filename)) {
      throw new DraftError("Podaj nazwę jednego pliku .gguf z repozytorium.");
    }
    const sha256 = draft.sha256?.trim().toLowerCase() ?? "";
    if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new DraftError("Suma SHA-256 musi mieć 64 znaki szesnastkowe.");
    }
    install = [
      { step_type: "hf_download", repo_id: repoId, filename, destination: "weights/model.gguf", ...(sha256 ? { sha256 } : {}) },
    ];
    accelerators = ["cuda", "rocm", "metal", "cpu"];
  } else {
    install = [
      { step_type: "setup_venv", python_version: "3.11" },
      { step_type: "uv_pip_install", packages: spec.packages },
      { step_type: "hf_download", repo_id: repoId, destination: "weights/model" },
    ];
    accelerators = draft.runner === "diffusers" ? ["cuda"] : ["cuda", "cpu"];
  }

  const contextWindow = buildContextWindow(
    draft.runner,
    draft.recommendedCtxSize,
    draft.maxSupportedCtxSize
  );
  const outputTokens = buildOutputTokens(
    draft.runner,
    contextWindow?.max_supported,
    draft.recommendedOutputTokens,
    draft.maxSupportedOutputTokens
  );

  return {
    schema_version: "1.0.0",
    id,
    name,
    version: "1.0.0",
    description,
    category: draft.category,
    engine: draft.runner === "gguf" ? "standalone_binary" : "python_uv",
    hardware_requirements: {
      min_vram_gb: draft.minVramGb,
      min_ram_gb: draft.minRamGb,
      supported_accelerators: accelerators,
    },
    install,
    runtime: {
      archetype: spec.archetype,
      entrypoint: spec.entrypoint,
      arguments: [],
      ...(contextWindow ? { context_window: contextWindow } : {}),
      ...(outputTokens ? { output_tokens: outputTokens } : {}),
      transport: "loopback_http",
      health_endpoint: "/health",
      readiness_timeout_sec: draft.runner === "gguf" ? 120 : 300,
    },
    ui: {
      title: name,
      description,
      inputs: inputsFor(draft.runner),
      output: { type: spec.output, protocol: "ipc_stream" },
    },
  };
}

export interface RepoAssessment {

  downloadBytes: number;
  problems: string[];

  suggestedVramGb: number;
  suggestedRamGb: number;
}

const roundUpHalf = (gb: number) => Math.ceil(gb * 2) / 2;

export function assessRepo(
  runner: RunnerKind,
  files: { path: string; size: number }[],
  ggufPath?: string
): RepoAssessment {
  const problems: string[] = [];
  let bytes = 0;
  if (runner === "gguf") {
    const file = files.find((f) => f.path === ggufPath);
    bytes = file?.size ?? 0;
  } else {
    const safetensors = files.filter((f) => f.path.endsWith(".safetensors"));
    bytes = safetensors.reduce((sum, f) => sum + f.size, 0);
    if (safetensors.length === 0) {
      problems.push(
        files.some((f) => /\.(bin|pt|pth|ckpt)$/.test(f.path))
          ? "Repozytorium ma tylko wagi w formacie pickle (.bin/.pt), których LemonAI nie instaluje. Potrzebne są pliki .safetensors."
          : "Repozytorium nie ma plików .safetensors."
      );
    }
    if (runner === "diffusers" && !files.some((f) => f.path === "model_index.json")) {
      problems.push("Brak model_index.json: to nie jest repozytorium w formacie diffusers.");
    }
    if ((runner === "transformers" || runner === "audio") && !files.some((f) => f.path === "config.json")) {
      problems.push("Brak config.json: to nie wygląda na model transformers.");
    }
  }
  const gb = bytes / 1e9;
  return {
    downloadBytes: bytes,
    problems,
    suggestedVramGb: bytes > 0 ? roundUpHalf(gb * 1.2 + 0.5) : 0,
    suggestedRamGb: bytes > 0 ? Math.max(4, roundUpHalf(gb + 2)) : 4,
  };
}

export function runnerKindFromArchetype(archetype: RuntimeArchetype): RunnerKind {
  switch (archetype) {
    case "llama_cpp_server":
      return "gguf";
    case "diffusers_pipeline":
      return "diffusers";
    case "audio_pipeline":
      return "audio";
    case "transformers_pipeline":
    default:
      return "transformers";
  }
}

export function defaultPackagesForRunner(runner: RunnerKind): string[] {
  return [...RUNNERS[runner].packages];
}

export function defaultCreatorInputsFor(runner: RunnerKind): UIInputDefinition[] {
  switch (runner) {
    case "diffusers":
      return [
        { name: "prompt", label: "Prompt", widget: "textarea", required: true, grid_cols: 3 },
        { name: "steps", label: "Steps", widget: "slider", min: 1, max: 60, step: 1, default: 24, unit: "steps" },
        { name: "guidance_scale", label: "CFG Scale", widget: "slider", min: 1, max: 15, step: 0.5, default: 7.0 },
        { name: "dimensions", label: "Dimensions", widget: "dimensions", default: "1024x1024" },
        { name: "seed", label: "Seed", widget: "seed", default: -1 },
      ];
    case "audio":
      return [
        { name: "audio_file", label: "Audio file", widget: "file_upload", required: true, accept: "audio/*", grid_cols: 3 },
      ];
    default:
      return [
        { name: "prompt", label: "Prompt", widget: "textarea", required: true, grid_cols: 3 },
        { name: "temperature", label: "Temperature", widget: "slider", min: 0, max: 2, step: 0.05, default: 0.7 },
        { name: "max_tokens", label: "Max tokens", widget: "number", min: 1, max: 8192, step: 1, default: 1024, unit: "tokens" },
      ];
  }
}

export function createDefaultManifest(runner: RunnerKind = "gguf"): ModelPackageManifest {
  const spec = RUNNERS[runner];
  const isGguf = runner === "gguf";
  const category = runner === "diffusers" ? "image" : runner === "audio" ? "audio" : "llm";
  const install: ModelPackageManifest["install"] = isGguf
    ? [
        {
          step_type: "hf_download",
          repo_id: "bartowski/Llama-3.2-1B-Instruct-GGUF",
          filename: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
          destination: "weights/model.gguf",
        },
      ]
    : [
        { step_type: "setup_venv", python_version: "3.11" },
        { step_type: "uv_pip_install", packages: [...spec.packages] },
        { step_type: "hf_download", repo_id: "owner/model", destination: "weights/model" },
      ];

  const defaultCw = defaultContextWindow(runner);
  const defaultOt = defaultOutputTokens(runner);
  return {
    schema_version: "1.0.0",
    id: "my-custom-model",
    name: "My Custom Model",
    version: "1.0.0",
    description: "Custom local model manifest.",
    category,
    content_rating: "general",
    engine: isGguf ? "standalone_binary" : "python_uv",
    hardware_requirements: {
      min_vram_gb: isGguf ? 4 : 8,
      min_ram_gb: 8,
      supported_accelerators: isGguf ? ["cuda", "rocm", "metal", "cpu"] : ["cuda", "cpu"],
    },
    install,
    runtime: {
      archetype: spec.archetype,
      entrypoint: spec.entrypoint,
      arguments: [],
      ...(defaultCw ? { context_window: defaultCw } : {}),
      ...(defaultOt ? { output_tokens: defaultOt } : {}),
      transport: "loopback_http",
      health_endpoint: "/health",
      readiness_timeout_sec: isGguf ? 120 : 300,
    },
    ui: {
      title: "My Custom Model",
      description: "Custom local model manifest.",
      columns: 2,
      inputs: defaultCreatorInputsFor(runner),
      output: { type: spec.output, protocol: "ipc_stream" },
    },
  };
}

export function applyRunnerToManifest(
  manifest: ModelPackageManifest,
  runner: RunnerKind
): ModelPackageManifest {
  const spec = RUNNERS[runner];
  const isGguf = runner === "gguf";
  const downloadSteps = manifest.install.filter(
    (s) => s.step_type === "hf_download" || s.step_type === "civitai_download" || s.step_type === "copy_file"
  );
  const effectiveDownloads: ModelPackageManifest["install"] =
    downloadSteps.length > 0
      ? downloadSteps
      : [
          isGguf
            ? { step_type: "hf_download", repo_id: "owner/repo", filename: "model.gguf", destination: "weights/model.gguf" }
            : { step_type: "hf_download", repo_id: "owner/repo", destination: "weights/model" },
        ];

  const install: ModelPackageManifest["install"] = isGguf
    ? effectiveDownloads
    : [
        { step_type: "setup_venv", python_version: "3.11" },
        { step_type: "uv_pip_install", packages: [...spec.packages] },
        ...effectiveDownloads,
      ];

  const { context_window: existingCw, output_tokens: existingOt, ...restRuntime } = manifest.runtime;
  const nextCw =
    runner === "gguf" || runner === "transformers"
      ? existingCw ?? defaultContextWindow(runner)
      : undefined;
  const rawOt =
    runner === "gguf" || runner === "transformers"
      ? existingOt ?? defaultOutputTokens(runner)
      : undefined;
  const nextOt =
    rawOt && nextCw
      ? {
          recommended: Math.min(rawOt.recommended, Math.min(rawOt.max_supported, nextCw.max_supported)),
          max_supported: Math.min(rawOt.max_supported, nextCw.max_supported),
        }
      : rawOt;

  return {
    ...manifest,
    engine: isGguf ? "standalone_binary" : "python_uv",
    hardware_requirements: {
      ...manifest.hardware_requirements,
      supported_accelerators: isGguf ? ["cuda", "rocm", "metal", "cpu"] : ["cuda", "cpu"],
    },
    install,
    runtime: {
      ...restRuntime,
      archetype: spec.archetype,
      entrypoint: spec.entrypoint,
      arguments: [],
      ...(nextCw ? { context_window: nextCw } : {}),
      ...(nextOt ? { output_tokens: nextOt } : {}),
      readiness_timeout_sec: isGguf ? 120 : 300,
    },
    ui: {
      ...manifest.ui,
      output: { ...manifest.ui.output, type: spec.output },
    },
  };
}
