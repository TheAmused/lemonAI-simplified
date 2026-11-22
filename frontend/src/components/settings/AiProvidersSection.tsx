import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiAiProviderDelete,
  apiAiProviderFetchModels,
  apiAiProviderSave,
  apiAiProviderSetDefault,
  apiAiProvidersList,
  apiListModels,
  supportsChat,
  type AiModelInfo,
  type AiProviderKind,
  type AiProviderPublic,
} from "@/lib/ipc";
import { useI18n, type Translations } from "@/lib/i18n";
import { Field, SettingsSection, fieldInput, fieldSelect, linkButton, outlineButton, primaryButton } from "./parts";
import { cn } from "@/lib/utils";

const PROVIDER_KINDS: AiProviderKind[] = [
  "google_ai_studio",
  "openai",
  "anthropic",
  "xai",
  "vertex_ai",
  "custom_openai",
  "local_model",
];

export function providerKindLabelKey(kind: AiProviderKind): keyof Translations {
  switch (kind) {
    case "google_ai_studio":
      return "aiProviderKindGoogleAiStudio";
    case "openai":
      return "aiProviderKindOpenAi";
    case "anthropic":
      return "aiProviderKindAnthropic";
    case "xai":
      return "aiProviderKindXai";
    case "vertex_ai":
      return "aiProviderKindVertexAi";
    case "custom_openai":
      return "aiProviderKindCustomOpenAi";
    case "local_model":
      return "aiProviderKindLocalModel";
  }
}

interface ProviderFormState {
  id: string | null;
  kind: AiProviderKind;
  label: string;
  apiKey: string;
  baseUrl: string;
  projectId: string;
  region: string;
  defaultModel: string;
  isDefault: boolean;
}

const EMPTY_FORM: ProviderFormState = {
  id: null,
  kind: "google_ai_studio",
  label: "",
  apiKey: "",
  baseUrl: "",
  projectId: "",
  region: "us-central1",
  defaultModel: "",
  isDefault: false,
};

export function AiProvidersSection() {
  const { t } = useI18n();
  const [providers, setProviders] = useState<AiProviderPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [modelFilters, setModelFilters] = useState<Record<string, string>>({});

  const formRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localModels, setLocalModels] = useState<AiModelInfo[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      const list = await apiAiProvidersList();
      setProviders(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (form.kind !== "local_model") return;
    let active = true;
    setLoadingLocal(true);
    void apiListModels()
      .then((installed) => {
        if (!active) return;
        const chatModels = installed
          .filter((m) => supportsChat(m))
          .map((m) => ({ id: m.id, display_name: m.name }))
          .sort((a, b) => a.id.localeCompare(b.id));
        setLocalModels(chatModels);
        setForm((prev) => {
          if (prev.kind !== "local_model" || prev.defaultModel) return prev;
          return { ...prev, defaultModel: chatModels[0]?.id ?? "" };
        });
      })
      .catch(() => {
        if (active) setLocalModels([]);
      })
      .finally(() => {
        if (active) setLoadingLocal(false);
      });
    return () => {
      active = false;
    };
  }, [form.kind]);

  const resetForm = () => {
    setForm({
      ...EMPTY_FORM,
      label: t(providerKindLabelKey("google_ai_studio")),
      isDefault: false,
    });
    setFormError(null);
  };

  const openEditModal = (p: AiProviderPublic) => {
    setForm({
      id: p.id,
      kind: p.kind,
      label: p.label,
      apiKey: "",
      baseUrl: p.base_url ?? "",
      projectId: p.project_id ?? "",
      region: p.region ?? "us-central1",
      defaultModel: p.default_model ?? "",
      isDefault: p.is_default,
    });
    setFormError(null);
    formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const handleKindChange = (nextKind: AiProviderKind) => {
    setForm((prev) => {
      const prevDefaultLabel = t(providerKindLabelKey(prev.kind));
      const shouldUpdateLabel = !prev.id && (!prev.label.trim() || prev.label === prevDefaultLabel);
      return {
        ...prev,
        kind: nextKind,
        label: shouldUpdateLabel ? t(providerKindLabelKey(nextKind)) : prev.label,
        defaultModel: nextKind === "local_model" ? "" : prev.defaultModel,
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmedLabel = form.label.trim();
    if (!trimmedLabel) {
      setFormError("Label is required");
      return;
    }
    if (form.kind === "custom_openai" && !form.baseUrl.trim()) {
      setFormError("Base URL is required for custom OpenAI-compatible endpoints");
      return;
    }

    setSaving(true);
    try {
      const isEditing = Boolean(form.id);
      const apiKeyPayload =
        form.kind === "local_model"
          ? null
          : isEditing && !form.apiKey.trim()
            ? null
            : form.apiKey.trim() || null;

      await apiAiProviderSave({
        id: form.id,
        kind: form.kind,
        label: trimmedLabel,
        api_key: apiKeyPayload,
        base_url: form.kind === "custom_openai" ? form.baseUrl.trim() || null : null,
        project_id: form.kind === "vertex_ai" ? form.projectId.trim() || null : null,
        region: form.kind === "vertex_ai" ? form.region.trim() || null : null,
        default_model: form.defaultModel.trim() || null,
        is_default: form.isDefault ? true : null,
      });
      await loadProviders();
      resetForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      const updated = await apiAiProviderDelete(id);
      setProviders(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetDefault = async (id: string, defaultModel?: string | null) => {
    setError(null);
    try {
      const updated = await apiAiProviderSetDefault(id, defaultModel);
      setProviders(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectDefaultModel = async (provider: AiProviderPublic, modelId: string) => {
    setError(null);
    try {
      if (provider.is_default) {
        const updated = await apiAiProviderSetDefault(provider.id, modelId || null);
        setProviders(updated);
      } else {
        await apiAiProviderSave({
          id: provider.id,
          kind: provider.kind,
          label: provider.label,
          api_key: null,
          base_url: provider.base_url,
          project_id: provider.project_id,
          region: provider.region,
          default_model: modelId || null,
          is_default: null,
        });
        await loadProviders();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFetchModels = async (provider: AiProviderPublic) => {
    setError(null);
    setFetchingId(provider.id);
    try {
      const models = await apiAiProviderFetchModels(provider.id);
      setProviders((prev) =>
        prev.map((p) => (p.id === provider.id ? { ...p, cached_models: models } : p))
      );
      if (!provider.default_model && models.length > 0) {
        await handleSelectDefaultModel(provider, models[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingId(null);
    }
  };

  const isLocal = form.kind === "local_model";
  const isVertex = form.kind === "vertex_ai";
  const isCustom = form.kind === "custom_openai";
  const mono = "font-mono";

  const countLabel = loading
    ? t("loading")
    : providers.length === 1
      ? t("aiProvidersCountOne")
      : t("aiProvidersCount").replace("{n}", String(providers.length));

  return (
    <SettingsSection id="ai" title={t("aiProvidersTitle")} tip={t("aiProvidersTip")} className="gap-[18px]">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && providers.length === 0 && (
        <div className="rounded-[18px] border border-dashed border-border px-5 py-5 text-sm text-muted-foreground">{t("aiProvidersEmpty")}</div>
      )}

      {providers.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-[18px] p-0" aria-label={t("aiProvidersTitle")}>
          {providers.map((provider) => {
            const filter = (modelFilters[provider.id] ?? "").trim().toLowerCase();
            const filteredModels = provider.cached_models.filter(
              (m) => !filter || m.id.toLowerCase().includes(filter) || m.display_name.toLowerCase().includes(filter)
            );
            const isFetching = fetchingId === provider.id;
            const hasModels = provider.cached_models.length > 0;
            const status =
              provider.kind === "local_model"
                ? [provider.default_model, t("aiProvidersLocalRuntime")].filter(Boolean).join(" · ")
                : provider.has_key
                  ? `${t("settingsTokenSet")} (${provider.key_hint ?? "••••"})`
                  : t("settingsNoToken");

            return (
              <li key={provider.id} className="flex flex-col gap-3.5 rounded-[18px] border border-border bg-card px-5 py-[18px]">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-base font-bold">{provider.label}</span>
                  {provider.is_default && (
                    <span className="rounded-md border-[1.5px] border-ink px-2 py-0.5 text-[11.5px] font-bold">{t("aiProvidersDefaultBadge")}</span>
                  )}
                  <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                    {status}
                    {provider.base_url ? ` · ${provider.base_url}` : ""}
                    {provider.project_id ? ` · ${provider.project_id}` : ""}
                  </span>
                  {!provider.is_default && (
                    <button type="button" className={cn(linkButton, "h-9 text-[13px]")} onClick={() => void handleSetDefault(provider.id, provider.default_model)}>
                      {t("aiProvidersSetDefault")}
                    </button>
                  )}
                  <button type="button" className={cn(linkButton, "h-9 text-[13px] text-ink")} onClick={() => openEditModal(provider)}>
                    {t("aiProvidersEdit")}
                  </button>
                  <button type="button" className={cn(linkButton, "h-9 text-[13px] text-destructive")} onClick={() => void handleDelete(provider.id)}>
                    {t("delete")}
                  </button>
                </div>

                {provider.kind !== "local_model" && (
                  <div className="flex flex-wrap items-end gap-2.5">
                    <label className="block min-w-[260px] flex-1">
                      <span className="mb-1 block text-[12.5px] font-bold">
                        {t("aiProvidersDefaultModel")} — {provider.label}
                      </span>
                      {hasModels ? (
                        <div className="flex gap-2">
                          {provider.cached_models.length > 5 && (
                            <input
                              type="search"
                              value={modelFilters[provider.id] ?? ""}
                              onChange={(e) => setModelFilters((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                              placeholder={t("aiProvidersFilterModels")}
                              aria-label={t("aiProvidersFilterModels")}
                              className={cn(fieldInput, "w-40 shrink-0 text-[13px]")}
                            />
                          )}
                          <select
                            id={`model-select-${provider.id}`}
                            aria-label={`${t("aiProvidersDefaultModel")} — ${provider.label}`}
                            value={provider.default_model ?? ""}
                            onChange={(e) => void handleSelectDefaultModel(provider, e.target.value)}
                            className={fieldSelect}
                          >
                            {provider.default_model && !provider.cached_models.some((m) => m.id === provider.default_model) && (
                              <option value={provider.default_model}>{provider.default_model}</option>
                            )}
                            {filteredModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.display_name !== m.id ? `${m.display_name} (${m.id})` : m.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className={cn(fieldInput, "flex items-center text-muted-foreground", provider.default_model && "font-mono text-foreground")}>
                          {provider.default_model || t("aiProvidersNoModelsFetched")}
                        </span>
                      )}
                    </label>
                    <button type="button" className={cn(outlineButton, "h-11 rounded-xl")} disabled={isFetching} onClick={() => void handleFetchModels(provider)}>
                      {isFetching ? t("aiProvidersFetchingModels") : t("aiProvidersFetchModels")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div
        ref={formRef}
        role="form"
        aria-label={form.id ? t("aiProviderModalEditTitle") : t("aiProvidersAdd")}
        className="flex flex-col gap-4 rounded-[18px] border-[1.5px] border-dashed border-border p-5"
      >
        <h3 className="m-0 text-[15px] font-extrabold">{form.id ? t("aiProviderModalEditTitle") : t("aiProvidersAdd")}</h3>
        <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("aiProviderKindLabel")}>
              <select
                aria-label={t("aiProviderKindLabel")}
                value={form.kind}
                onChange={(e) => handleKindChange(e.target.value as AiProviderKind)}
                className={fieldSelect}
              >
                {PROVIDER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(providerKindLabelKey(kind))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("aiProviderLabelField")}>
              <input
                type="text"
                aria-label={t("aiProviderLabelField")}
                value={form.label}
                onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                placeholder={t(providerKindLabelKey(form.kind))}
                className={fieldInput}
              />
            </Field>
          </div>

          <Field label={t("aiProviderApiKeyLabel")} tip={t("aiProviderApiKeyTip")} help={form.id && !isLocal ? t("aiProviderApiKeyEditHint") : undefined}>
            <input
              type="password"
              aria-label={t("aiProviderApiKeyLabel")}
              autoComplete="off"
              spellCheck={false}
              disabled={isLocal}
              value={form.apiKey}
              onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder={isLocal ? t("aiProviderNoKeyNeeded") : "••••••••"}
              className={cn(fieldInput, mono)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t("aiProviderBaseUrlLabel")}>
              <input
                type="url"
                aria-label={t("aiProviderBaseUrlLabel")}
                disabled={!isCustom}
                value={form.baseUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="https://openrouter.ai/api/v1"
                className={cn(fieldInput, mono)}
              />
            </Field>
            <Field label={t("aiProviderModelLabel")}>
              {isLocal ? (
                loadingLocal ? (
                  <p className="flex h-12 items-center text-[13px] text-muted-foreground">{t("aiProviderLocalModelsLoading")}</p>
                ) : localModels.length === 0 ? (
                  <p className="flex h-12 items-center text-[13px] text-muted-foreground">{t("aiProviderLocalModelsEmpty")}</p>
                ) : (
                  <select
                    aria-label={t("aiProvidersDefaultModel")}
                    value={form.defaultModel}
                    onChange={(e) => setForm((prev) => ({ ...prev, defaultModel: e.target.value }))}
                    className={cn(fieldSelect, mono)}
                  >
                    {localModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name} ({m.id})
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <input
                  type="text"
                  aria-label={t("aiProviderModelLabel")}
                  value={form.defaultModel}
                  onChange={(e) => setForm((prev) => ({ ...prev, defaultModel: e.target.value }))}
                  placeholder="gemini-2.5-flash / gpt-4.1 / claude-sonnet-4-20250514"
                  className={cn(fieldInput, mono)}
                />
              )}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t("aiProviderProjectIdLabel")}>
              <input
                type="text"
                aria-label={t("aiProviderProjectIdLabel")}
                disabled={!isVertex}
                value={form.projectId}
                onChange={(e) => setForm((prev) => ({ ...prev, projectId: e.target.value }))}
                placeholder="my-gcp-project"
                className={cn(fieldInput, mono)}
              />
            </Field>
            <Field label={t("aiProviderRegionLabel")}>
              <input
                type="text"
                aria-label={t("aiProviderRegionLabel")}
                disabled={!isVertex}
                value={form.region}
                onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))}
                placeholder="us-central1"
                className={cn(fieldInput, mono)}
              />
            </Field>
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className={primaryButton}>
              {form.id ? t("save") : t("aiProvidersAdd")}
            </button>
            {form.id ? (
              <button type="button" className={linkButton} onClick={resetForm}>
                {t("cancel")}
              </button>
            ) : (
              <span className="text-[13px] text-muted-foreground">{countLabel}</span>
            )}
          </div>
        </form>
      </div>
    </SettingsSection>
  );
}
