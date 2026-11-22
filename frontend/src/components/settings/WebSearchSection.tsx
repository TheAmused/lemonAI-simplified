import { useEffect, useState } from "react";
import {
  apiGetWebSearchConfig,
  apiSaveWebSearchConfig,
  type WebSearchConfigPublic,
  type WebSearchProviderKind,
} from "@/lib/ipc";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Field, SettingsSection, SwitchRow, fieldInput, fieldSelect, linkButton, outlineButton } from "./parts";

export function WebSearchSection() {
  const { t } = useI18n();
  const [config, setConfig] = useState<WebSearchConfigPublic>({
    provider: "duckduckgo",
    has_key: false,
    key_hint: null,
    base_url: null,
    max_results: 5,
    fetch_pages: true,
  });
  const [provider, setProvider] = useState<WebSearchProviderKind>("duckduckgo");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [maxResults, setMaxResults] = useState(5);
  const [fetchPages, setFetchPages] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiGetWebSearchConfig()
      .then((loaded) => {
        if (!active) return;
        setConfig(loaded);
        setProvider(loaded.provider);
        setBaseUrlInput(loaded.base_url ?? "");
        setMaxResults(loaded.max_results);
        setFetchPages(loaded.fetch_pages);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const needsKey = provider === "brave" || provider === "tavily";
  const needsUrl = provider === "searxng";

  const save = async (overrideApiKey?: string | null) => {
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    try {
      const apiKeyPayload =
        overrideApiKey !== undefined
          ? overrideApiKey
          : apiKeyInput.trim()
            ? apiKeyInput.trim()
            : null;
      const updated = await apiSaveWebSearchConfig({
        provider,
        api_key: apiKeyPayload,
        base_url: needsUrl ? baseUrlInput.trim() || null : null,
        max_results: maxResults,
        fetch_pages: fetchPages,
      });
      setConfig(updated);
      setApiKeyInput("");
      setBaseUrlInput(updated.base_url ?? "");
      setSavedNotice(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection id="sieci" title={t("webSearchSettingsTitle")} tip={t("webSearchTip")}>
      <form
        id="settings-web-search-section"
        className="flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t("webSearchProviderLabel")} htmlFor="web-search-provider">
          <select
            id="web-search-provider"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as WebSearchProviderKind);
              setSavedNotice(false);
              setError(null);
            }}
            className={fieldSelect}
          >
            <option value="duckduckgo">{t("webSearchProviderDuckDuckGo")}</option>
            <option value="brave">{t("webSearchProviderBrave")}</option>
            <option value="tavily">{t("webSearchProviderTavily")}</option>
            <option value="searxng">{t("webSearchProviderSearxng")}</option>
          </select>
        </Field>

        <Field
          label={t("webSearchApiKeyLabel")}
          htmlFor="web-search-api-key"
          tip={t("webSearchKeyTip")}
          help={config.has_key ? `${t("settingsTokenSet")} (${config.key_hint ?? "••••"}). ${t("webSearchApiKeyHint")}` : t("webSearchApiKeyHint")}
        >
          <input
            id="web-search-api-key"
            aria-label={t("webSearchApiKeyLabel")}
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={!needsKey}
            value={apiKeyInput}
            onChange={(e) => {
              setApiKeyInput(e.target.value);
              setSavedNotice(false);
            }}
            placeholder={t("webSearchApiKeyPlaceholder")}
            className={cn(fieldInput, "font-mono")}
          />
        </Field>

        <Field label={t("webSearchBaseUrlLabel")} htmlFor="web-search-base-url">
          <input
            id="web-search-base-url"
            type="url"
            disabled={!needsUrl}
            value={baseUrlInput}
            onChange={(e) => {
              setBaseUrlInput(e.target.value);
              setSavedNotice(false);
            }}
            placeholder="https://searx.example.org"
            className={cn(fieldInput, "font-mono")}
          />
        </Field>

        <SwitchRow
          checked={fetchPages}
          onChange={(next) => {
            setFetchPages(next);
            setSavedNotice(false);
          }}
          title={t("webSearchFetchPagesLabel")}
          description={t("webSearchFetchPagesHint")}
        />

        <Field label={t("webSearchMaxResultsLabel")} htmlFor="web-search-max-results" className="max-w-[200px]">
          <select
            id="web-search-max-results"
            value={maxResults}
            onChange={(e) => {
              setMaxResults(Number(e.target.value));
              setSavedNotice(false);
            }}
            className={cn(fieldSelect, "font-mono")}
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={8}>8</option>
          </select>
        </Field>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {savedNotice && !error && (
          <p role="status" className="text-sm font-medium text-ok">
            {t("webSearchSaved")}
          </p>
        )}

        <div className="flex items-center gap-3.5">
          <button type="submit" disabled={saving} className={cn(outlineButton, "h-11 rounded-xl")}>
            {t("webSearchSaveButton")}
          </button>
          {config.has_key && (
            <button type="button" disabled={saving} className={cn(linkButton, "h-11 text-[13px] text-muted-foreground")} onClick={() => void save("")}>
              {t("webSearchClearKey")}
            </button>
          )}
        </div>
      </form>
    </SettingsSection>
  );
}
