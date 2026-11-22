from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field

Accelerator = Literal["cuda", "rocm", "metal", "cpu"]
ContentRating = Literal["general", "adult"]
ExecutionEngine = Literal["python_uv", "standalone_binary"]
RuntimeArchetype = Literal["diffusers_pipeline", "transformers_pipeline", "audio_pipeline", "llama_cpp_server"]
RuntimeTransport = Literal["unix_domain_socket", "loopback_http"]
StepType = Literal["setup_venv", "uv_pip_install", "hf_download", "civitai_download", "copy_file"]
UIOptionValue = str | float | bool
UIOutputProtocol = Literal["ipc_stream", "sse_stream", "json_rpc"]
UIOutputType = Literal["text", "markdown", "image", "audio", "json"]
UIWidgetType = Literal["text", "textarea", "slider", "switch", "select", "file_upload", "number", "color_picker", "radio_group", "checkbox_group", "json_editor", "tags_input", "seed", "dimensions"]


class ContextWindowConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_supported: int = Field(ge=256, le=2097152)
    recommended: int = Field(ge=256, le=2097152)


class ModelFamily(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100, pattern='^[a-z0-9_-]+$')
    name: str = Field(min_length=1, max_length=80)
    order: int = Field(default=0, ge=0, le=1000)
    variant: str = Field(min_length=1, max_length=40)


class OutputTokensConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_supported: int = Field(ge=64, le=2097152)
    recommended: int = Field(ge=64, le=2097152)


class UICondition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    equals: Any = None
    field: str
    in_: list[Any] | None = Field(default=None, alias='in')
    not_equals: Any = None


class UIFormPreset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str | None = None
    id: str
    label: str
    values: dict[str, Any]


class HardwareRequirements(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min_ram_gb: float = Field(ge=1.0)
    min_vram_gb: float = Field(ge=0.0)
    supported_accelerators: list[Accelerator] = Field(default_factory=lambda: ["cuda", "cpu"])


class InstallStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    civitai_model_id: int | None = Field(default=None, ge=0)
    civitai_version_id: int | None = Field(default=None, ge=0)
    destination: str | None = None
    extra_index_urls: list[Annotated[str, Field(pattern='^https://[^\\s@/?#-][^\\s@/?#]*([/?#]\\S*)?$')]] | None = None
    filename: str | None = None
    packages: list[Annotated[str, Field(pattern='^[A-Za-z0-9][A-Za-z0-9._-]*(\\[[A-Za-z0-9._,-]+\\])?((===|==|!=|>=|<=|~=|<|>)[A-Za-z0-9.*+!_-]+(,(===|==|!=|>=|<=|~=|<|>)[A-Za-z0-9.*+!_-]+)*)?$')]] | None = None
    python_version: str | None = Field(default='3.11', pattern='^\\d+(\\.\\d+){0,2}$')
    repo_id: str | None = None
    sha256: str | None = Field(default=None, pattern='^[a-fA-F0-9]{64}$')
    step_type: StepType


class RuntimeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    archetype: RuntimeArchetype
    arguments: list[str] = Field(default_factory=list)
    context_window: ContextWindowConfig | None = None
    entrypoint: str
    health_endpoint: str = Field(default='/health', pattern='^/\\S*$')
    output_tokens: OutputTokensConfig | None = None
    readiness_timeout_sec: int = Field(default=120, ge=5, le=600)
    transport: RuntimeTransport = 'loopback_http'


class UIInputOptionObject(BaseModel):
    label: str
    value: UIOptionValue


UIInputOption = str | UIInputOptionObject


class UIOutputDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol: UIOutputProtocol
    type: UIOutputType


class ModelVariant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context_window: ContextWindowConfig | None = None
    description: str | None = None
    hardware_requirements: HardwareRequirements | None = None
    id: str = Field(min_length=1, max_length=50, pattern='^[a-z0-9_-]+$')
    install: list[InstallStep] | None = None
    name: str = Field(min_length=1)
    output_tokens: OutputTokensConfig | None = None
    runtime: RuntimeConfig | None = None


class UIInputDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accept: str | None = None
    default: Any = None
    depends_on: UICondition | None = None
    description: str | None = None
    grid_cols: Literal[1, 2, 3] | None = None
    label: str
    max: float | None = None
    min: float | None = None
    name: str = Field(pattern='^[a-zA-Z0-9_]+$')
    options: list[UIInputOption] | None = None
    placeholder: str | None = None
    quick_chips: list[str] | None = None
    required: bool | None = None
    step: float | None = None
    unit: str | None = None
    widget: UIWidgetType


class UISection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_open: bool | None = None
    description: str | None = None
    id: str
    input_names: list[str] | None = None
    inputs: list[UIInputDefinition] | None = None
    title: str


class UIConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    columns: Literal[1, 2] | None = None
    description: str | None = None
    inputs: list[UIInputDefinition]
    output: UIOutputDefinition
    presets: list[UIFormPreset] | None = None
    sections: list[UISection] | None = None
    title: str


class ModelPackageManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    author: str | None = None
    category: str | None = None
    content_rating: ContentRating | None = None
    description: str | None = None
    engine: ExecutionEngine
    family: ModelFamily | None = None
    hardware_requirements: HardwareRequirements
    id: str = Field(min_length=1, max_length=100, pattern='^[a-z0-9_-]+$')
    install: list[InstallStep]
    license: str | None = None
    name: str = Field(min_length=1)
    runtime: RuntimeConfig
    schema_version: str = Field(pattern='^1\\.0\\.0$')
    ui: UIConfig
    variants: list[ModelVariant] | None = None
    version: str = Field(pattern='^\\d+\\.\\d+\\.\\d+$')
