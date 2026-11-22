

export type Accelerator = "cuda" | "rocm" | "metal" | "cpu";

export type ContentRating = "general" | "adult";

export interface ContextWindowConfig {
  max_supported: number;
  recommended: number;
}

export type ExecutionEngine = "python_uv" | "standalone_binary";

export interface ModelFamily {
  id: string;
  name: string;
  order?: number;
  variant: string;
}

export interface OutputTokensConfig {
  max_supported: number;
  recommended: number;
}

export type RuntimeArchetype =
  | "diffusers_pipeline"
  | "transformers_pipeline"
  | "audio_pipeline"
  | "llama_cpp_server";

export type RuntimeTransport = "unix_domain_socket" | "loopback_http";

export type StepType =
  | "setup_venv"
  | "uv_pip_install"
  | "hf_download"
  | "civitai_download"
  | "copy_file";

export interface UICondition {
  equals?: unknown;
  field: string;
  in?: unknown[];
  not_equals?: unknown;
}

export interface UIFormPreset {
  description?: string;
  id: string;
  label: string;
  values: Record<string, unknown>;
}

export type UIOptionValue = string | number | boolean;

export type UIOutputProtocol = "ipc_stream" | "sse_stream" | "json_rpc";

export type UIOutputType = "text" | "markdown" | "image" | "audio" | "json";

export type UIWidgetType =
  | "text"
  | "textarea"
  | "slider"
  | "switch"
  | "select"
  | "file_upload"
  | "number"
  | "color_picker"
  | "radio_group"
  | "checkbox_group"
  | "json_editor"
  | "tags_input"
  | "seed"
  | "dimensions";

export interface HardwareRequirements {
  min_ram_gb: number;
  min_vram_gb: number;
  supported_accelerators?: Accelerator[];
}

export interface InstallStep {
  civitai_model_id?: number | null;
  civitai_version_id?: number | null;
  destination?: string | null;
  extra_index_urls?: string[] | null;
  filename?: string | null;
  packages?: string[] | null;
  python_version?: string | null;
  repo_id?: string | null;
  sha256?: string | null;
  step_type: StepType;
}

export interface RuntimeConfig {
  archetype: RuntimeArchetype;
  arguments?: string[];
  context_window?: ContextWindowConfig | null;
  entrypoint: string;
  health_endpoint?: string;
  output_tokens?: OutputTokensConfig | null;
  readiness_timeout_sec?: number;
  transport?: RuntimeTransport;
}

export type UIInputOption = string | { label: string; value: UIOptionValue };

export interface UIOutputDefinition {
  protocol: UIOutputProtocol;
  type: UIOutputType;
}

export interface ModelVariant {
  context_window?: ContextWindowConfig | null;
  description?: string | null;
  hardware_requirements?: HardwareRequirements | null;
  id: string;
  install?: InstallStep[] | null;
  name: string;
  output_tokens?: OutputTokensConfig | null;
  runtime?: RuntimeConfig | null;
}

export interface UIInputDefinition {
  accept?: string;
  default?: unknown;
  depends_on?: UICondition;
  description?: string;
  grid_cols?: 1 | 2 | 3;
  label: string;
  max?: number;
  min?: number;
  name: string;
  options?: UIInputOption[];
  placeholder?: string;
  quick_chips?: string[];
  required?: boolean;
  step?: number;
  unit?: string;
  widget: UIWidgetType;
}

export interface UISection {
  default_open?: boolean;
  description?: string;
  id: string;
  input_names?: string[];
  inputs?: UIInputDefinition[];
  title: string;
}

export interface UIConfig {
  columns?: 1 | 2;
  description?: string;
  inputs: UIInputDefinition[];
  output: UIOutputDefinition;
  presets?: UIFormPreset[];
  sections?: UISection[];
  title: string;
}

export interface ModelPackageManifest {
  author?: string | null;
  category?: string | null;
  content_rating?: ContentRating;
  description?: string | null;
  engine: ExecutionEngine;
  family?: ModelFamily | null;
  hardware_requirements: HardwareRequirements;
  id: string;
  install: InstallStep[];
  license?: string | null;
  name: string;
  runtime: RuntimeConfig;
  schema_version: string;
  ui: UIConfig;
  variants?: ModelVariant[] | null;
  version: string;
}
