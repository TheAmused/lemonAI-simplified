import { useState, useEffect, useCallback } from "react";

export type Language = "pl" | "en";

export interface Translations {

  close: string;
  cancel: string;
  refresh: string;
  save: string;
  delete: string;
  clear: string;
  search: string;

  workspace: string;
  modelHub: string;
  apps: string;
  admin: string;
  history: string;
  addScript: string;
  login: string;
  logout: string;
  themeToggle: string;

  installedModels: string;
  stopped: string;
  loading: string;
  ready: string;
  inferring: string;
  unloading: string;
  minVram: string;
  status: string;
  unloadVram: string;

  runModel: string;
  stopModel: string;
  processing: string;
  noActiveModel: string;

  modelOutput: string;
  noOutput: string;
  copy: string;
  copied: string;
  generating: string;
  telemetryConsole: string;
  idleLogs: string;
  ttft: string;
  speed: string;
  tokens: string;
  duration: string;

  downloadAudio: string;
  copyAudio: string;
  audioCopied: string;
  playbackSpeed: string;

  copyJson: string;
  downloadJson: string;
  searchJson: string;
  expandAll: string;
  collapseAll: string;
  jsonCopied: string;

  catalogTitle: string;
  searchModelsPlaceholder: string;
  allCategories: string;
  curatedOnly: string;
  curated: string;
  author: string;
  installed: string;
  openInWorkspace: string;
  uninstall: string;
  installing: string;
  cancelInstall: string;

  hardwareMonitor: string;
  vramUsage: string;
  safeBudget: string;
  allocatedVram: string;
  freeVram: string;
  hostRam: string;
  activeModelsInVram: string;
  noActiveModelsInVram: string;
  accelerator: string;
  installPrompt: string;
  noModelsFound: string;
  confirmUninstallTitle: string;
  confirmUninstallDesc: string;
  communityWarningTitle: string;
  communityWarningDesc: string;
  installAnyway: string;

  authModalTitle: string;
  loginTab: string;
  registerTab: string;
  identifierLabel: string;
  usernameLabel: string;
  emailLabel: string;
  passwordLabel: string;
  loginSubmit: string;
  registerSubmit: string;
  loginRequired: string;
  loginToUpload: string;

  uploadModalTitle: string;
  modelNameLabel: string;
  slugLabel: string;
  categoryLabel: string;
  runtimeEngineLabel: string;
  hfRepoLabel: string;
  hfFileLabel: string;
  minVramGbLabel: string;
  minRamGbLabel: string;
  uploadSubmit: string;
  uploadModalDesc: string;
  uploadReviewNote: string;
  uploadPublishNow: string;

  profileNav: string;
  myManifestsTab: string;
  security2faTab: string;
  accountSettingsTab: string;
  editManifest: string;
  deleteManifest: string;
  twoFactorEnabled: string;
  twoFactorDisabled: string;
  enable2fa: string;
  disable2fa: string;
  changePassword: string;
  revokeAllSessions: string;
  deleteAccount: string;

  chatNew: string;
  chatConversations: string;
  chatNoConversations: string;
  chatUntitled: string;
  chatEmptyTitle: string;
  chatEmptyHint: string;
  chatPlaceholder: string;
  chatSend: string;
  chatStop: string;
  chatMessageLabel: string;
  chatYou: string;
  chatThinking: string;
  chatSettings: string;
  chatContext: string;
  chatContextUnknown: string;
  chatTokensUsed: string;
  chatCompacting: string;
  chatCompacted: string;
  chatSummaryMarker: string;
  chatSummaryShow: string;
  chatSummaryLossy: string;
  chatInterrupted: string;
  chatTruncated: string;
  chatTruncatedMaxTokens: string;
  chatTruncatedContext: string;
  chatContinue: string;
  chatContinuingPart: string;
  chatPartBadge: string;
  chatNoAnswer: string;
  chatDelete: string;
  chatDeleteConfirm: string;
  chatRename: string;
  chatStarting: string;
  chatLogs: string;
  chatWebSearch: string;
  chatWebSearchHint: string;
  chatWebSearchingPlanning: string;
  chatWebSearchingQuery: string;
  chatWebSearchingReading: string;
  chatWebSources: string;
  chatWebSourceSingle: string;
  chatWebSearchUnavailable: string;
  chatWebQueries: string;
  chatWebPageRead: string;
  chatContextLimitLabel: string;
  chatContextRecommended: string;
  chatContextMaxSupported: string;
  chatContextApply: string;
  chatContextApplyRestart: string;
  chatContextRestarting: string;
  chatContextReset: string;
  chatContextAboveRecommended: string;
  chatContextUpdated: string;
  chatContextRestartNeeded: string;
  chatExtendedMaxTokens: string;
  chatExtendedMaxTokensHint: string;
  chatAutoContinue: string;
  chatAutoContinueHint: string;
  chatMaxTokensAutoPlaceholder: string;
  chatOutputRecommended: string;
  chatOutputMaxSupported: string;

  navStudio: string;
  hubConnectedShort: string;
  navBell: string;
  notificationsMarkRead: string;
  navCatalog: string;
  navApps: string;
  navHistory: string;
  navSettings: string;
  navSignIn: string;
  navAccount: string;
  mainNavigation: string;
  settingsTitle: string;
  settingsSubtitle: string;
  settingsLook: string;
  settingsLookHint: string;
  themeLemon: string;
  themeDark: string;
  themeLight: string;
  themeSystem: string;
  settingsLanguage: string;
  settingsMemory: string;
  settingsMemoryHint: string;
  memoryAuto: string;
  memoryAutoDesc: string;
  memoryGpuOnly: string;
  memoryGpuOnlyDesc: string;
  memoryAppliesNext: string;
  settingsFolder: string;
  settingsFolderHint: string;
  settingsChange: string;
  settingsLogs: string;
  settingsLogsHint: string;
  openLogsFolder: string;
  settingsHf: string;
  settingsHfHint: string;
  settingsHfButton: string;
  settingsAdult: string;
  settingsAdultHint: string;
  adultToggle: string;
  adultConfirmTitle: string;
  adultConfirmBody: string;
  adultConfirmYes: string;
  settingsAccount: string;
  settingsAccountHint: string;
  signedOutTitle: string;
  signedOutBody: string;
  createAccount: string;
  myModels: string;
  publishModel: string;
  hubUnavailableShort: string;
  ramModelUses: string;
  studioPickModel: string;
  studioNoModelsTitle: string;
  studioNoModelsHint: string;
  studioOpenCatalog: string;
  releaseMemory: string;
  placementGpu: string;
  placementRam: string;
  placementLayers: string;
  startsOnFirstRun: string;
  logToggle: string;
  generate: string;
  run: string;
  stageEmptyTitle: string;
  stageEmptyHint: string;
  catalogHeroKicker: string;
  catalogHeroInstall: string;
  catalogHeroOpen: string;
  catalogCompare: string;
  yourGpu: string;
  yourRam: string;
  modelNeeds: string;
  leftFree: string;
  onlyFitting: string;
  onlyOfficial: string;
  fitGpu: string;
  fitRam: string;
  fitNone: string;
  meterLegend: string;
  chooseVersion: string;
  openModel: string;
  installedTag: string;
  recommendedFor: string;
  newVersion: string;
  adultTag: string;
  moreOptions: string;
  pickerTitle: string;
  pickerHint: string;
  pickerYourCard: string;
  pickerRecommended: string;
  pickerInstalled: string;
  pickerAllowRam: string;
  pickerAllowRamDesc: string;
  pickerDetected: string;
  pickerWhyRecommended: string;
  pickerFitsGpu: string;
  pickerSpills: string;
  pickerTooBig: string;
  pickerGpuNeed: string;
  pickerRamNeed: string;
  pickerInstall: string;
  pickerOpen: string;
  hubUnavailableBanner: string;
  tryAgain: string;
  paramsToggle: string;
  settingsNavLabel: string;
  settingsNavAdult: string;
  settingsNavFiles: string;
  settingsNavAi: string;
  settingsNavWeb: string;
  settingsNavAccount: string;
  settingsAdultTitle: string;
  settingsAdultTip: string;
  settingsAdultDesc: string;
  settingsFiles: string;
  settingsFolderLabel: string;
  settingsFreeSpaceTail: string;
  settingsHfLabel: string;
  settingsHfHelp: string;
  settingsCivLabel: string;
  settingsCivTip: string;
  settingsCivHelp: string;
  settingsCivPlaceholder: string;
  settingsTokenRemove: string;
  settingsTokenSaved: string;
  aiProviderAddHeading: string;
  aiProviderEditHeading: string;
  aiProviderField: string;
  aiProviderLabelShort: string;
  aiProviderKeyTip: string;
  aiProviderBaseUrlCustom: string;
  aiProviderModelShort: string;
  aiProviderProjectShort: string;
  aiProviderRegionShort: string;
  aiProvidersCount: string;
  aiProvidersAddButton: string;
  aiProvidersSaveButton: string;
  aiProviderDelete: string;
  settingsAccountTitle: string;
  settingsAccountCta: string;
  settingsSignInButton: string;
  settingsSignOut: string;
  settingsMyProfile: string;
  stageAudioEmptyTitle: string;
  stageAudioEmptyHint: string;
  stageImageEmptyHint: string;
  stageGenerating: string;
  stageGeneratingNote: string;
  stageRecent: string;
  stageAllResults: string;
  stageSaveAs: string;
  stageCopy: string;
  stageShowInHistory: string;
  stageSearchResult: string;
  stageTabText: string;
  stageTelemetry: string;
  stageLogAll: string;
  stageLogWarn: string;
  stageLogError: string;
  stageMetricTime: string;
  studioQuality: string;
  studioQualityFast: string;
  studioQualityExact: string;
  cancelRun: string;
  fieldsRequired: string;
  presetsHeading: string;
  appsInstalled: string;
  appsAvailable: string;
  appsPlanned: string;
  appsPlannedNote: string;
  appsSoonTag: string;
  appsSoon: string;
  appsSearch: string;
  appsUpdateHint: string;
  catGroupFits: string;
  catGroupFitsNote: string;
  catGroupSlower: string;
  catGroupSlowerNote: string;
  catGroupNone: string;
  catGroupNoneNote: string;
  catShowUnfit: string;
  catHideUnfit: string;
  catSortLabel: string;
  catSortDefault: string;
  catSortName: string;
  catSortSizeAsc: string;
  catSortSizeDesc: string;
  catSortRating: string;
  catHeroYourCard: string;
  catHeroModel: string;
  catHeroLeft: string;
  catHeroRam: string;
  catHeroSpills: string;
  catSearchModels: string;
  catFootRetry: string;
  instrFromChat: string;
  chatEditingLast: string;
  chatEditingCancel: string;
  chatRetry: string;
  chatEditQuestion: string;
  chatExportMd: string;
  chatCopyConversation: string;
  chatMoreActions: string;
  chatGroupToday: string;
  chatGroupYesterday: string;
  chatGroupEarlier: string;
  chatThinkingDone: string;
  chatSpeed: string;
  chatSendLabel: string;
  paramsTitle: string;
  paramsSavedAuto: string;
  paramsRestarting: string;
  instrLabel: string;
  instrTip: string;
  instrBuiltinGroup: string;
  instrMineGroup: string;
  instrPreview: string;
  instrNew: string;
  instrEdit: string;
  instrShowAll: string;
  instrTagBuiltin: string;
  instrTagMine: string;
  instrListLabel: string;
  instrNewTitle: string;
  instrEditTitle: string;
  instrReadOnly: string;
  instrName: string;
  instrNamePh: string;
  instrText: string;
  instrTextPh: string;
  instrSaveUse: string;
  instrCopyEdit: string;
  instrDelete: string;
  instrCounter: string;
  instrCopySuffix: string;
  instrModelDefault: string;
  instrNoneName: string;
  instrNoneText: string;
  instrNoneSnippet: string;
  instrConciseName: string;
  instrConciseText: string;
  instrConciseSnippet: string;
  instrTranslatorName: string;
  instrTranslatorText: string;
  instrTranslatorSnippet: string;
  instrTutorName: string;
  instrTutorText: string;
  instrTutorSnippet: string;
  instrDeveloperName: string;
  instrDeveloperText: string;
  instrDeveloperSnippet: string;
  instrEditorName: string;
  instrEditorText: string;
  instrEditorSnippet: string;
  paramStyle: string;
  paramStyleTip: string;
  paramStylePrecise: string;
  paramStyleCreative: string;
  paramLength: string;
  paramLengthTip: string;
  paramLengthTokens: string;
  paramLengthAuto: string;
  paramMemory: string;
  paramMemoryTip: string;
  paramMemoryWords: string;
  paramMemoryRestarting: string;
  paramThinkingTip: string;
  paramExtendedLabel: string;
  paramContinueLabel: string;
  paramContinueTip: string;
  paramExtendedTip: string;
  onGpuShort: string;

  settingsFreeSpace: string;
  settingsTokenSet: string;
  settingsNoToken: string;
  settingsSignedInHub: string;
  settingsCivitai: string;
  settingsCivitaiHint: string;
  settingsCivitaiButton: string;
  civitaiModalTitle: string;
  civitaiModalBody: string;
  civitaiModalSaved: string;
  civitaiModalNone: string;
  civitaiModalNewToken: string;
  civitaiModalRemove: string;
  localOnlyBadge: string;

  aiProvidersTitle: string;
  creatorSubtitle: string;
  creatorListAria: string;
  creatorFilterAria: string;
  creatorEditorAria: string;
  creatorTabsAria: string;
  creatorSourceTitle: string;
  creatorWhatModelTitle: string;
  creatorMemoryTitle: string;
  creatorAdvanced: string;
  creatorAdvancedHint: string;
  creatorFormIntro: string;
  creatorPreviewAside: string;
  creatorEditField: string;
  creatorBack: string;
  creatorFormTitle: string;
  creatorStudioPreviewHeading: string;
  creatorCatalogPreview: string;
  creatorYouPrivate: string;
  creatorFitOk: string;
  creatorFitSpill: string;
  creatorFitUnknown: string;
  creatorAutoDone: string;
  creatorAutoIntro: string;
  creatorModelKind: string;
  creatorEngine: string;
  creatorDescription: string;
  creatorRepo: string;
  creatorWeightsFile: string;
  creatorModelName: string;
  creatorVramLabel: string;
  creatorRamLabel: string;
  creatorKindChat: string;
  creatorKindImage: string;
  creatorKindAudio: string;
  creatorKindVision: string;
  creatorKindMultimodal: string;
  fbFieldNumber: string;
  aiProvidersTip: string;
  aiProviderApiKeyTip: string;
  aiProviderNoKeyNeeded: string;
  aiProviderModelLabel: string;
  aiProvidersCountOne: string;
  webSearchTip: string;
  webSearchKeyTip: string;
  aiProvidersHint: string;
  aiProvidersLocalNotice: string;
  aiProvidersEmpty: string;
  aiProvidersAdd: string;
  aiProvidersEdit: string;
  aiProvidersDefaultBadge: string;
  aiProvidersSetDefault: string;
  aiProvidersFetchModels: string;
  aiProvidersFetchingModels: string;
  aiProvidersDefaultModel: string;
  aiProvidersNoModelsFetched: string;
  aiProvidersFilterModels: string;
  aiProvidersLocalRuntime: string;
  aiProviderModalAddTitle: string;
  aiProviderModalEditTitle: string;
  aiProviderKindLabel: string;
  aiProviderLabelField: string;
  aiProviderApiKeyLabel: string;
  aiProviderApiKeyEditHint: string;
  aiProviderBaseUrlLabel: string;
  aiProviderProjectIdLabel: string;
  aiProviderRegionLabel: string;
  aiProviderLocalModelsLoading: string;
  aiProviderLocalModelsEmpty: string;
  aiProviderKindGoogleAiStudio: string;
  aiProviderKindOpenAi: string;
  aiProviderKindAnthropic: string;
  aiProviderKindXai: string;
  aiProviderKindVertexAi: string;
  aiProviderKindCustomOpenAi: string;
  aiProviderKindLocalModel: string;

  navCreator: string;
  creatorTitle: string;
  creatorVaultBadge: string;
  creatorNewManifest: string;
  creatorVaultEmpty: string;
  creatorVaultSearchPlaceholder: string;
  creatorModeManual: string;
  creatorModeAuto: string;
  creatorAutoUrlPlaceholder: string;
  creatorAutoProviderLabel: string;
  creatorAutoModelOverrideLabel: string;
  creatorAutoAnalyzeBtn: string;
  creatorAutoAnalyzing: string;
  creatorAutoNoProvider: string;
  creatorAutoSummaryTitle: string;
  creatorAutoWarningsTitle: string;
  creatorTabBasics: string;
  creatorTabFormBuilder: string;
  creatorTabRawJson: string;
  creatorSourceHf: string;
  creatorSourceCivitai: string;
  creatorPickHfFiles: string;
  creatorCivitaiLookupPlaceholder: string;
  creatorCivitaiFetchBtn: string;
  creatorCivitaiFetching: string;
  creatorCivitaiTriggerWords: string;
  creatorCivitaiSelectFile: string;
  creatorOptionalLora: string;
  creatorLoraRepoPlaceholder: string;
  creatorLoraFilePlaceholder: string;
  creatorPreviewTitle: string;
  creatorPreviewStudio: string;
  creatorPreviewCard: string;
  creatorValidationValid: string;
  creatorValidationIssues: string;
  creatorSaveToVault: string;
  creatorSavedToVault: string;
  creatorInstallLocally: string;
  creatorOpenInStudio: string;
  creatorExportJson: string;
  creatorPublishToHub: string;
  creatorPublishedToHub: string;
  creatorDuplicate: string;
  creatorSignInToPublish: string;
  creatorContextWindowTitle: string;
  creatorContextRecommendedLabel: string;
  creatorContextMaxSupportedLabel: string;
  creatorContextWindowHint: string;
  creatorOutputTokensTitle: string;
  creatorOutputRecommendedLabel: string;
  creatorOutputMaxSupportedLabel: string;
  creatorOutputTokensHint: string;

  fbAddInput: string;
  fbInputsTitle: string;
  fbNoInputs: string;
  fbFieldName: string;
  fbFieldLabel: string;
  fbFieldWidget: string;
  fbFieldDefault: string;
  fbFieldMin: string;
  fbFieldMax: string;
  fbFieldStep: string;
  fbFieldUnit: string;
  fbFieldPlaceholder: string;
  fbFieldDescription: string;
  fbFieldOptions: string;
  fbFieldQuickChips: string;
  fbFieldAccept: string;
  fbFieldRequired: string;
  fbFieldGridCols: string;
  fbFieldDependsOn: string;
  fbFieldDependsOnField: string;
  fbFieldDependsOnValue: string;
  fbMoveUp: string;
  fbMoveDown: string;
  fbPresetsTitle: string;
  fbAddPreset: string;
  fbPresetId: string;
  fbPresetLabel: string;
  fbPresetValues: string;
  fbOutputType: string;
  fbColumns: string;

  webSearchSettingsTitle: string;
  webSearchSettingsHint: string;
  webSearchProviderLabel: string;
  webSearchProviderDuckDuckGo: string;
  webSearchProviderBrave: string;
  webSearchProviderTavily: string;
  webSearchProviderSearxng: string;
  webSearchApiKeyLabel: string;
  webSearchApiKeyPlaceholder: string;
  webSearchApiKeyHint: string;
  webSearchClearKey: string;
  webSearchBaseUrlLabel: string;
  webSearchFetchPagesLabel: string;
  webSearchFetchPagesHint: string;
  webSearchMaxResultsLabel: string;
  webSearchSaved: string;
  webSearchSaveButton: string;

  lightboxTitle: string;
  lightboxSubtitle: string;
  lightboxFrameInfo: string;
  lightboxPrevAria: string;
  lightboxPrev: string;
  lightboxImageAlt: string;
  lightboxNextAria: string;
  lightboxNext: string;
  lightboxDownload: string;

  comfyStatusRunning: string;
  comfyStatusStarting: string;
  comfyStatusExited: string;
  comfyStatusStopped: string;
  comfyEvictedTitle: string;
  comfyEvictedText: string;
  comfyEvictedPrimary: string;
  comfyEvictedSecondary: string;
  comfyEvictedHint: string;
  comfyCrashedTitle: string;
  comfyCrashedText: string;
  comfyCrashedPrimary: string;
  comfyCrashedSecondary: string;
  comfyCrashedHint: string;
  comfyStoppedTitle: string;
  comfyStoppedText: string;
  comfyStoppedPrimary: string;
  comfyStoppedSecondary: string;
  comfyStoppedHint: string;
  comfyBackApps: string;
  comfyLog: string;
  comfyManage: string;
  comfyOpenBrowser: string;
  comfyStop: string;
  comfyStart: string;
  comfyRestart: string;
  comfyManagerHintPrefix: string;
  comfyManagerHintSuffix: string;
  comfyDismissHint: string;
  comfyPanelAria: string;
  comfyBrowserFallback: string;
  comfyStartingTitle: string;
  comfyStartingDesc: string;
  comfyLogAria: string;
  comfyLogEmpty: string;
}

const DICTIONARY: Record<Language, Translations> = {
  pl: {
    close: "Zamknij",
    cancel: "Anuluj",
    refresh: "Odśwież",
    save: "Zapisz",
    delete: "Usuń",
    clear: "Wyczyść",
    search: "Szukaj...",

    workspace: "Workspace",
    modelHub: "Katalog Modeli",
    apps: "Aplikacje",
    admin: "Administracja",
    history: "Historia",
    addScript: "+ Dodaj Skrypt",
    login: "Zaloguj się",
    logout: "Wyloguj",
    themeToggle: "Przełącz motyw",

    installedModels: "Zainstalowane Modele",
    stopped: "Zatrzymany",
    loading: "Ładowanie",
    ready: "Gotowy",
    inferring: "Inferencja",
    unloading: "Zwalnianie",
    minVram: "VRAM",
    status: "Stan",
    unloadVram: "Zwolnij VRAM",

    runModel: "Uruchom Model",
    stopModel: "Zatrzymaj",
    processing: "Przetwarzanie...",
    noActiveModel: "Brak aktywnego modelu",

    modelOutput: "Wynik Modelu",
    noOutput: "Brak danych wyjściowych",
    copy: "Kopiuj",
    copied: "✓ Skopiowano",
    generating: "Generowanie...",
    telemetryConsole: "Konsola Telemetrii",
    idleLogs: "[IDLE] Oczekiwanie na zdarzenia telemetryczne...",
    ttft: "TTFT",
    speed: "Prędkość",
    tokens: "Tokeny",
    duration: "Czas",
    downloadAudio: "Pobierz WAV",
    copyAudio: "Kopiuj Audio",
    audioCopied: "✓ Skopiowano Audio",
    playbackSpeed: "Prędkość odtwarzania",
    copyJson: "Kopiuj JSON",
    downloadJson: "Pobierz JSON",
    searchJson: "Szukaj w JSON...",
    expandAll: "Rozwiń wszystko",
    collapseAll: "Zwiń wszystko",
    jsonCopied: "✓ Skopiowano JSON",

    catalogTitle: "Katalog",
    searchModelsPlaceholder: "Szukaj modelu po nazwie lub opisie...",
    allCategories: "Wszystkie",
    curatedOnly: "Tylko oficjalne",
    curated: "Curated",
    author: "autor",
    installed: "Zainstalowano",
    openInWorkspace: "Otwórz w Workspace",
    uninstall: "Odinstaluj",
    installing: "Instalowanie...",
    cancelInstall: "Anuluj",
    hardwareMonitor: "Monitor Sprzętu",
    vramUsage: "Użycie VRAM",
    safeBudget: "Bezpieczny budżet",
    allocatedVram: "Zaalokowane",
    freeVram: "Wolne",
    hostRam: "RAM Hosta",
    activeModelsInVram: "Aktywne modele w VRAM",
    noActiveModelsInVram: "Brak aktywnych modeli w VRAM",
    accelerator: "Akcelerator",
    installPrompt: "Instaluj",
    noModelsFound: "Brak modeli spełniających kryteria",
    confirmUninstallTitle: "Odinstalować model?",
    confirmUninstallDesc: "Model zostanie usunięty z tego komputera. Możesz go zainstalować ponownie w każdej chwili. Historia wyników zostaje.",
    communityWarningTitle: "Model społecznościowy",
    communityWarningDesc: "Ten pakiet nie został zweryfikowany przez LemonAI. Instaluj tylko, jeśli ufasz źródłu.",
    installAnyway: "Zainstaluj mimo to",

    authModalTitle: "Konto LemonAI Hub",
    loginTab: "Logowanie",
    registerTab: "Rejestracja",
    identifierLabel: "Nazwa użytkownika lub e-mail",
    usernameLabel: "Nazwa użytkownika",
    emailLabel: "Adres e-mail",
    passwordLabel: "Hasło",
    loginSubmit: "Zaloguj się",
    registerSubmit: "Zarejestruj konto",
    loginRequired: "Wymagane logowanie",
    loginToUpload: "Zaloguj się lub Zarejestruj",

    uploadModalTitle: "Opublikuj model",
    modelNameLabel: "Nazwa Modelu *",
    slugLabel: "Identyfikator (slug) *",
    categoryLabel: "Kategoria *",
    runtimeEngineLabel: "Silnik wykonawczy *",
    hfRepoLabel: "Repozytorium",
    hfFileLabel: "Plik z wagami",
    minVramGbLabel: "Wymagany VRAM (GB)",
    minRamGbLabel: "Wymagany RAM (GB)",
    uploadSubmit: "Opublikuj",
    uploadModalDesc: "Opisz model z Hugging Face, a inni zainstalują go w LemonAI jednym kliknięciem.",
    uploadReviewNote: "Wpis trafi do przeglądu moderatora.",
    uploadPublishNow: "Wpis pojawi się w katalogu od razu.",

    profileNav: "Mój Profil",
    myManifestsTab: "Moje modele",
    security2faTab: "Bezpieczeństwo",
    accountSettingsTab: "Konto",
    editManifest: "Edytuj manifest",
    deleteManifest: "Usuń",
    twoFactorEnabled: "Włączone (Aktywne)",
    twoFactorDisabled: "Wyłączone",
    enable2fa: "Włącz 2FA",
    disable2fa: "Wyłącz 2FA",
    changePassword: "Zmień hasło",
    revokeAllSessions: "Wyloguj ze wszystkich urządzeń",
    deleteAccount: "Usuń konto",

    chatNew: "Nowy czat",
    chatConversations: "Rozmowy",
    chatNoConversations: "Brak rozmów. Napisz wiadomość, aby zacząć.",
    chatUntitled: "Nowa rozmowa",
    chatEmptyTitle: "Zacznij rozmowę",
    chatEmptyHint: "Model pamięta wcześniejsze wiadomości tej rozmowy. Gdy okno kontekstu się zapełni, starsze wiadomości zostaną streszczone.",
    chatPlaceholder: "Napisz wiadomość… (Enter wysyła, Shift+Enter nowa linia)",
    chatSend: "Wyślij",
    chatStop: "Zatrzymaj",
    chatMessageLabel: "Wiadomość",
    chatYou: "Ty",
    chatThinking: "Tok rozumowania",
    chatSettings: "Ustawienia czatu",
    chatContext: "Okno kontekstu",
    chatContextUnknown: "Zużycie tokenów pojawi się po pierwszej odpowiedzi.",
    chatTokensUsed: "tokenów",
    chatCompacting: "Streszczanie starszych wiadomości, aby zmieścić rozmowę w kontekście…",
    chatCompacted: "Starsze wiadomości zostały streszczone dla modelu.",
    chatSummaryMarker: "Wiadomości powyżej model zna tylko ze streszczenia",
    chatSummaryShow: "Pokaż streszczenie",
    chatSummaryLossy: "Część starszych wiadomości pominięto bez streszczenia.",
    chatInterrupted: "zatrzymano",
    chatTruncated: "ucięto: osiągnięto limit długości",
    chatTruncatedMaxTokens: "ucięto: osiągnięto limit Max tokens",
    chatTruncatedContext: "ucięto: zapełniono okno kontekstu",
    chatContinue: "Kontynuuj",
    chatContinuingPart: "Generowanie części {part} z {max}…",
    chatPartBadge: "część {n}",
    chatNoAnswer: "(model nie zwrócił odpowiedzi)",
    chatDelete: "Usuń rozmowę",
    chatDeleteConfirm: "Usunąć?",
    chatRename: "Zmień nazwę",
    chatStarting: "Uruchamianie modelu…",
    chatLogs: "Dziennik",
    chatWebSearch: "Szukaj w sieci",
    chatWebSearchHint: "Pozwól modelowi wyszukiwać aktualny kontekst w internecie dla tej wiadomości",
    chatWebSearchingPlanning: "Planowanie zapytania do sieci…",
    chatWebSearchingQuery: "Wyszukiwanie: {q}",
    chatWebSearchingReading: "Czytanie stron z wynikami…",
    chatWebSources: "Źródła internetowe ({n})",
    chatWebSourceSingle: "Źródło internetowe (1)",
    chatWebSearchUnavailable: "Wyszukiwanie w sieci niedostępne",
    chatWebQueries: "Zapytania:",
    chatWebPageRead: "przeczytano stronę",
    chatContextLimitLabel: "Limit okna (tokeny)",
    chatContextRecommended: "Zalecane:",
    chatContextMaxSupported: "Maks. obsługiwane:",
    chatContextApply: "Zastosuj",
    chatContextApplyRestart: "Zastosuj i zrestartuj model",
    chatContextRestarting: "Restartowanie modelu…",
    chatContextReset: "Domyślny",
    chatContextAboveRecommended: "Powyżej zalecanego limitu — zużywa więcej VRAM i może spowolnić model.",
    chatContextUpdated: "Zaktualizowano limit okna kontekstu.",
    chatContextRestartNeeded: "Limit zapisany — zostanie zastosowany przy następnym uruchomieniu modelu.",
    chatExtendedMaxTokens: "Rozszerzony limit Max tokens",
    chatExtendedMaxTokensHint: "Odblokowuje limit odpowiedzi do maksimum obsługiwanego przez model ({max} tokenów) zamiast połowy okna.",
    chatAutoContinue: "Automatyczna kontynuacja w częściach",
    chatAutoContinueHint: "Gdy odpowiedź zostanie ucięta na limicie, dopisuje kolejne części automatycznie (maks. 4 części).",
    chatMaxTokensAutoPlaceholder: "Auto (resztka okna)",
    chatOutputRecommended: "Zalecane wyjście:",
    chatOutputMaxSupported: "Maks. wyjście:",

    navStudio: "Studio",
    hubConnectedShort: "Hub połączony",
    navBell: "Dzwonek",
    notificationsMarkRead: "Oznacz jako przeczytane",
    navCatalog: "Katalog",
    navApps: "Aplikacje",
    navHistory: "Historia",
    navSettings: "Ustawienia",
    navSignIn: "Zaloguj",
    navAccount: "Twoje konto",
    mainNavigation: "Główna nawigacja",
    settingsTitle: "Ustawienia",
    settingsSubtitle: "Działają bez konta i zapisują się na tym komputerze.",
    settingsLook: "Wygląd",
    settingsLookHint: "Kliknij, aby zobaczyć od razu.",
    themeLemon: "Cytrynowy",
    themeDark: "Ciemny",
    themeLight: "Jasny",
    themeSystem: "Jak w systemie",
    settingsLanguage: "Język",
    settingsMemory: "Pamięć dla modeli",
    settingsMemoryHint: "Co zrobić, gdy model nie mieści się w karcie graficznej.",
    memoryAuto: "Automatycznie",
    memoryAutoDesc: "Nadmiar trafia do RAM: większe modele działają, ale wolniej.",
    memoryGpuOnly: "Tylko karta graficzna",
    memoryGpuOnlyDesc: "Zawsze szybko. Model, który się nie mieści, nie uruchomi się.",
    memoryAppliesNext: "Zmiana zadziała przy następnym uruchomieniu modelu.",
    settingsFolder: "Folder modeli",
    settingsFolderHint: "Tu trafiają pobrane modele. Duże modele zajmują kilkadziesiąt GB.",
    settingsChange: "Zmień…",
    settingsLogs: "Logi aplikacji",
    settingsLogsHint: "Rotowane pliki diagnostyczne (lemonai.log), błędy llama-server i statystyki tokenów.",
    openLogsFolder: "Otwórz folder logów",
    settingsHf: "Hugging Face",
    settingsHfHint: "Token jest potrzebny tylko do modeli z ograniczonym dostępem.",
    settingsHfButton: "Token dostępu…",
    settingsAdult: "Treści dla dorosłych",
    settingsAdultHint: "Modele bez cenzury (Heretic) i modele obrazu NSFW. Domyślnie ukryte.",
    adultToggle: "Pokazuj modele dla dorosłych (18+)",
    adultConfirmTitle: "Masz ukończone 18 lat?",
    adultConfirmBody: "Te modele mogą tworzyć treści erotyczne i odpowiadać na prośby, których zwykłe modele odmawiają. Odpowiadasz za to, jak ich używasz i czy jest to legalne tam, gdzie jesteś.",
    adultConfirmYes: "Tak, mam 18 lat",
    settingsAccount: "Konto LemonAI Hub",
    settingsAccountHint: "Potrzebne tylko do publikowania modeli, ocen i wiadomości.",
    signedOutTitle: "Nie jesteś zalogowany",
    signedOutBody: "Wszystko powyżej działa bez konta. Zaloguj się, gdy zechcesz publikować modele.",
    createAccount: "Załóż konto",
    myModels: "Moje modele",
    publishModel: "Opublikuj model",
    hubUnavailableShort: "Hub niedostępny",
    ramModelUses: "model używa {x}",
    studioPickModel: "Wybierz model",
    studioNoModelsTitle: "Nie masz jeszcze żadnego modelu",
    studioNoModelsHint: "Zainstaluj model z katalogu. Dobierzemy wersję do Twojego komputera.",
    studioOpenCatalog: "Otwórz katalog",
    releaseMemory: "Zwolnij pamięć",
    placementGpu: "cały model na karcie",
    placementRam: "część w RAM, więc wolniej",
    placementLayers: "{on} z {total} warstw na karcie",
    startsOnFirstRun: "uruchomi się przy pierwszym użyciu",
    logToggle: "Dziennik",
    generate: "Generuj",
    run: "Uruchom",
    stageEmptyTitle: "Co dziś wyciśniemy?",
    stageEmptyHint: "Opisz, co chcesz uzyskać, i naciśnij przycisk. Każdy wynik zapisuje się w Historii.",
    catalogHeroKicker: "Najlepszy czat na Twój komputer",
    catalogHeroInstall: "Zainstaluj",
    catalogHeroOpen: "Otwórz w Studio",
    catalogCompare: "Porównaj wersje",
    yourGpu: "Twoja karta",
    yourRam: "Pamięć RAM",
    modelNeeds: "Model potrzebuje",
    leftFree: "Zostaje wolne",
    onlyFitting: "Tylko pasujące do mojego komputera",
    onlyOfficial: "Tylko oficjalne",
    fitGpu: "mieści się w karcie",
    fitRam: "część w RAM (wolniej)",
    fitNone: "za mało pamięci",
    meterLegend: "Pasek = pamięć Twojej karty ({x}).",
    chooseVersion: "Wybierz wersję",
    openModel: "Otwórz",
    installedTag: "zainstalowany",
    recommendedFor: "Polecana dla Ciebie: {x}",
    newVersion: "Jest nowa wersja",
    adultTag: "18+",
    moreOptions: "Więcej: {x}",
    pickerTitle: "Która {x}?",
    pickerHint: "Im wyższy słupek, tym mądrzejszy model i tym więcej pamięci potrzebuje. Wszystko pod linią mieści się w Twojej karcie.",
    pickerYourCard: "Twoja karta",
    pickerRecommended: "Polecana",
    pickerInstalled: "Masz ją",
    pickerAllowRam: "Pozwól użyć RAM, gdy model nie mieści się w karcie",
    pickerAllowRamDesc: "Słupki nad linią też zadziałają, tylko wolniej (pomarańczowa część trafia do RAM).",
    pickerDetected: "Wykryto: {vram} na karcie, {ram} RAM",
    pickerWhyRecommended: "Polecamy: największa wersja, która w całości mieści się w Twojej karcie.",
    pickerFitsGpu: "Mieści się w całości w Twojej karcie.",
    pickerSpills: "Nie mieści się w karcie: {x} trafi do RAM, więc odpowiedzi będą wolniejsze.",
    pickerTooBig: "Za mało pamięci na tę wersję.",
    pickerGpuNeed: "Karta graficzna",
    pickerRamNeed: "Pamięć RAM",
    pickerInstall: "Zainstaluj {x}",
    pickerOpen: "Otwórz {x} w Studio",
    hubUnavailableBanner: "Hub jest niedostępny. Pokazuję modele wbudowane w aplikację.",
    tryAgain: "Spróbuj ponownie",
    paramsToggle: "Parametry",
    settingsNavLabel: "Sekcje ustawień",
    settingsNavAdult: "Treści 18+",
    settingsNavFiles: "Modele i pliki",
    settingsNavAi: "Dostawcy AI",
    settingsNavWeb: "Wyszukiwanie w sieci",
    settingsNavAccount: "Konto",
    settingsAdultTitle: "Treści dla dorosłych (18+)",
    settingsAdultTip: "Po włączeniu poprosimy o potwierdzenie wieku.",
    settingsAdultDesc: "Modele bez cenzury i modele obrazów NSFW. Domyślnie ukryte.",
    settingsFiles: "Modele i pliki",
    settingsFolderLabel: "Folder modeli",
    settingsFreeSpaceTail: "Duże modele zajmują kilkadziesiąt GB.",
    settingsHfLabel: "Token Hugging Face",
    settingsHfHelp: "Potrzebny tylko do modeli, które wymagają zgody na Hugging Face.",
    settingsCivLabel: "Token CivitAI",
    settingsCivTip: "Zapisany tylko na tym komputerze.",
    settingsCivHelp: "Dla modeli z CivitAI, które wymagają logowania.",
    settingsCivPlaceholder: "Wklej token…",
    settingsTokenRemove: "Usuń",
    settingsTokenSaved: "zapisany",
    aiProviderAddHeading: "Dodaj dostawcę",
    aiProviderEditHeading: "Edytuj dostawcę",
    aiProviderField: "Dostawca",
    aiProviderLabelShort: "Etykieta",
    aiProviderKeyTip: "Szyfrowany lokalnie, tylko na tym komputerze.",
    aiProviderBaseUrlCustom: "Adres bazowy (dla „Własny”)",
    aiProviderModelShort: "Model",
    aiProviderProjectShort: "Projekt (dla Vertex AI)",
    aiProviderRegionShort: "Region (dla Vertex AI)",
    aiProvidersCount: "{n} dostawców",
    aiProvidersAddButton: "Dodaj dostawcę",
    aiProvidersSaveButton: "Zapisz zmiany",
    aiProviderDelete: "Usuń dostawcę",
    settingsAccountTitle: "Konto",
    settingsAccountCta: "Przyda się, gdy zechcesz publikować własne modele albo oceniać cudze.",
    settingsSignInButton: "Zaloguj się",
    settingsSignOut: "Wyloguj",
    settingsMyProfile: "Mój profil",
    stageAudioEmptyTitle: "Co dziś zagramy?",
    stageAudioEmptyHint: "Wpisz tekst lub opis dźwięku na dole i naciśnij przycisk. Każdy wynik trafia do Historii.",
    stageImageEmptyHint: "Opisz obraz na dole i naciśnij Generuj. Każdy wynik trafia do Historii.",
    stageGenerating: "Generowanie…",
    stageGeneratingNote: "Model w pamięci, pierwszy wynik powinien być za kilka sekund.",
    stageRecent: "OSTATNIE",
    stageAllResults: "Wszystkie →",
    stageSaveAs: "Zapisz jako…",
    stageCopy: "Kopiuj",
    stageShowInHistory: "Pokaż w Historii",
    stageSearchResult: "Szukaj w wyniku",
    stageTabText: "Tekst",
    stageTelemetry: "TELEMETRIA",
    stageLogAll: "Wszystko",
    stageLogWarn: "Ostrzeżenia",
    stageLogError: "Błędy",
    stageMetricTime: "Czas",
    studioQuality: "Jakość",
    studioQualityFast: "Szybko",
    studioQualityExact: "Dokładnie",
    cancelRun: "Anuluj",
    fieldsRequired: "pole wymagane",
    presetsHeading: "Presety",
    appsInstalled: "ZAINSTALOWANE",
    appsAvailable: "DO ZAINSTALOWANIA",
    appsPlanned: "JESZCZE NIEDOSTĘPNE",
    appsPlannedNote: "Planowane aplikacje — LemonAI jeszcze ich nie instaluje.",
    appsSoonTag: "Jeszcze niedostępne",
    appsSoon: "Wkrótce",
    appsSearch: "Szukaj aplikacji",
    appsUpdateHint: "Zatrzymaj ComfyUI, aby zaktualizować — nowa wersja instaluje się tylko wtedy, gdy program nie działa.",
    catGroupFits: "Mieszczą się w karcie",
    catGroupFitsNote: "Działają szybko, bez sięgania do RAM.",
    catGroupSlower: "Zadziałają wolniej",
    catGroupSlowerNote: "Część modelu trafia do RAM.",
    catGroupNone: "Za mało pamięci",
    catGroupNoneNote: "Nie zmieszczą się na tym komputerze.",
    catShowUnfit: "Pokaż modele, które się nie zmieszczą",
    catHideUnfit: "Ukryj modele, które się nie zmieszczą",
    catSortLabel: "Sortuj",
    catSortDefault: "Polecane",
    catSortName: "Nazwa",
    catSortSizeAsc: "Rozmiar (rosnąco)",
    catSortSizeDesc: "Rozmiar (malejąco)",
    catSortRating: "Najlepiej oceniane",
    catHeroYourCard: "Twoja karta",
    catHeroModel: "Model {x}",
    catHeroLeft: "zostaje wolne {x}",
    catHeroRam: "Do tego {x} RAM jako zapas.",
    catHeroSpills: "{x} trafi do RAM",
    catSearchModels: "Szukaj modeli",
    catFootRetry: "Spróbuj ponownie",
    instrFromChat: "Z tej rozmowy",
    chatEditingLast: "Edytujesz ostatnie pytanie; odpowiedź zostanie wygenerowana od nowa.",
    chatEditingCancel: "Anuluj edycję",
    chatRetry: "Spróbuj jeszcze raz",
    chatEditQuestion: "Edytuj pytanie",
    chatExportMd: "Eksportuj .md",
    chatCopyConversation: "Kopiuj rozmowę",
    chatMoreActions: "Więcej",
    chatGroupToday: "DZISIAJ",
    chatGroupYesterday: "WCZORAJ",
    chatGroupEarlier: "WCZEŚNIEJ",
    chatThinkingDone: "Myślał {s} s",
    chatSpeed: "{n} tok/s",
    chatSendLabel: "Wyślij",
    paramsTitle: "Parametry",
    paramsSavedAuto: "Zapisane automatycznie",
    paramsRestarting: "Restartuję model…",
    instrLabel: "Instrukcja dla modelu",
    instrTip: "Zasady, które model dostaje przed każdą rozmową: język, ton, długość odpowiedzi.",
    instrBuiltinGroup: "WBUDOWANE",
    instrMineGroup: "MOJE",
    instrPreview: "PODGLĄD",
    instrNew: "Nowa instrukcja",
    instrEdit: "Edytuj",
    instrShowAll: "Pokaż całość",
    instrTagBuiltin: "Wbudowana",
    instrTagMine: "Moja",
    instrListLabel: "Instrukcje",
    instrNewTitle: "Nowa instrukcja",
    instrEditTitle: "Edytuj instrukcję",
    instrReadOnly: "Wbudowana, tylko do odczytu. Zrób kopię, żeby ją zmienić.",
    instrName: "Nazwa",
    instrNamePh: "Np. Redaktor techniczny",
    instrText: "Treść",
    instrTextPh: "Opisz, jak model ma odpowiadać: język, ton, format, czego unikać.",
    instrSaveUse: "Zapisz i użyj",
    instrCopyEdit: "Zrób kopię i edytuj",
    instrDelete: "Usuń instrukcję",
    instrCounter: "{w} słów · ok. {t} tokenów",
    instrCopySuffix: "(kopia)",
    instrModelDefault: "Domyślna dla modelu",
    instrNoneName: "Bez instrukcji",
    instrNoneText: "Model odpowiada bez dodatkowych zasad.",
    instrNoneSnippet: "Bez dodatkowych zasad",
    instrConciseName: "Zwięzły asystent",
    instrConciseText: "Odpowiadaj po polsku, krótko i na temat. Najpierw sama odpowiedź, potem w razie potrzeby jedno zdanie wyjaśnienia. Nie powtarzaj pytania.",
    instrConciseSnippet: "Krótko, po polsku, na temat",
    instrTranslatorName: "Tłumacz PL ↔ EN",
    instrTranslatorText: "Tłumacz każdą wiadomość między polskim a angielskim. Zachowaj ton i formatowanie. Nie dodawaj komentarzy, chyba że fraza ma kilka znaczeń.",
    instrTranslatorSnippet: "Tłumaczy w obie strony, bez komentarzy",
    instrTutorName: "Korepetytor",
    instrTutorText: "Tłumacz prostym językiem, krok po kroku. Zadawaj pytania sprawdzające zrozumienie i nie podawaj od razu gotowego rozwiązania.",
    instrTutorSnippet: "Wyjaśnia krok po kroku, pyta",
    instrDeveloperName: "Programista",
    instrDeveloperText: "Pisz kod w blokach z podanym językiem. Wyjaśniaj krótko, co robi i dlaczego. Wskaż przypadki brzegowe i możliwe błędy.",
    instrDeveloperSnippet: "Kod w blokach, przypadki brzegowe",
    instrEditorName: "Redaktor",
    instrEditorText: "Popraw styl, interpunkcję i klarowność tekstu, zachowując głos autora. Pokaż zmiany w formie krótkiej listy.",
    instrEditorSnippet: "Poprawia styl, zachowuje głos autora",
    paramStyle: "Styl odpowiedzi",
    paramStyleTip: "To temperatura. Niższa daje bardziej przewidywalne odpowiedzi, wyższa bardziej twórcze.",
    paramStylePrecise: "Precyzyjny",
    paramStyleCreative: "Twórczy",
    paramLength: "Długość odpowiedzi",
    paramLengthTip: "Limit długości jednej odpowiedzi, liczony w tokenach.",
    paramLengthTokens: "{n} tokenów",
    paramLengthAuto: "Auto",
    paramMemory: "Pamięć rozmowy",
    paramMemoryTip: "Ile tekstu model pamięta naraz. Więcej pamięci to dłuższa rozmowa, ale większe zużycie RAM i VRAM. Zalecane: {rec} (podkreślone). Zmiana restartuje model, rozmowa zostaje.",
    paramMemoryWords: "≈ {n} słów rozmowy",
    paramMemoryRestarting: "Model uruchamia się ponownie. Rozmowa zostaje.",
    paramThinkingTip: "Model najpierw rozumuje, potem odpowiada. Wolniej, ale trafniej przy trudnych pytaniach. Tok myślenia widać w zwiniętym bloku.",
    paramExtendedLabel: "Dłuższe odpowiedzi",
    paramContinueLabel: "Dokańczaj ucięte odpowiedzi",
    paramContinueTip: "Gdy odpowiedź się urwie, model dopisuje ciąg dalszy w kolejnych częściach (maks. 4).",
    paramExtendedTip: "Podnosi górny limit długości odpowiedzi do maksimum modelu ({max} tokenów) zamiast połowy pamięci rozmowy.",
    onGpuShort: "na karcie",

    settingsFreeSpace: "Wolne miejsce:",
    settingsTokenSet: "Token ustawiony",
    settingsNoToken: "Brak tokena",
    settingsSignedInHub: "Zalogowano w LemonAI Hub",
    settingsCivitai: "CivitAI",
    settingsCivitaiHint: "Opcjonalny klucz API do pobierania chronionych checkpointów i LoRA z CivitAI. Szyfrowany lokalnie tylko na tym komputerze.",
    settingsCivitaiButton: "Klucz API…",
    civitaiModalTitle: "Klucz API CivitAI",
    civitaiModalBody: "Klucz API CivitAI pozwala pobierać modele wymagające zalogowania (civitai.com → Account Settings → API Keys). Klucz jest szyfrowany lokalnie tylko na tym komputerze i nigdy nie trafia na serwer LemonAI Hub.",
    civitaiModalSaved: "Zapisany klucz:",
    civitaiModalNone: "Brak zapisanego klucza.",
    civitaiModalNewToken: "Nowy klucz API",
    civitaiModalRemove: "Usuń klucz",
    localOnlyBadge: "Zapisane lokalnie tylko na tym PC",

    aiProvidersTitle: "Dostawcy AI (Sejf Offline)",
    creatorSubtitle: "Własne modele, zapisane tylko na tym komputerze.",
    creatorListAria: "Twoje manifesty",
    creatorFilterAria: "Filtruj modele",
    creatorEditorAria: "Edycja modelu",
    creatorTabsAria: "Sekcje",
    creatorSourceTitle: "Skąd pobrać",
    creatorWhatModelTitle: "Co to za model",
    creatorMemoryTitle: "Ile pamięci potrzebuje",
    creatorAdvanced: "Zaawansowane",
    creatorAdvancedHint: "suma kontrolna, okno kontekstu, limity",
    creatorFormIntro: "Pola, które użytkownik zobaczy w Studio obok modelu.",
    creatorPreviewAside: "Podgląd",
    creatorEditField: "Edytuj",
    creatorBack: "← Kreator",
    creatorFormTitle: "Formularz modelu",
    creatorStudioPreviewHeading: "Podgląd w Studio",
    creatorCatalogPreview: "Tak zobaczą to inni w Katalogu",
    creatorYouPrivate: "Ty · prywatny",
    creatorFitOk: "{x} GB z {y} GB na Twojej karcie",
    creatorFitSpill: "{x} GB, część trafi do RAM",
    creatorFitUnknown: "{x} GB wymaganej pamięci karty",
    creatorAutoDone: "Gotowe",
    creatorAutoIntro: "Wklej link do repozytorium, a AI uzupełni manifest.",
    creatorModelKind: "Rodzaj",
    creatorEngine: "Silnik",
    creatorDescription: "Opis",
    creatorRepo: "Repozytorium",
    creatorWeightsFile: "Plik z wagami",
    creatorModelName: "Nazwa modelu",
    creatorVramLabel: "Karta graficzna (GB)",
    creatorRamLabel: "RAM (GB)",
    creatorKindChat: "Czat",
    creatorKindImage: "Obraz",
    creatorKindAudio: "Audio",
    creatorKindVision: "Wizja",
    creatorKindMultimodal: "Multimodalny",
    fbFieldNumber: "POLE {n}",
    aiProvidersTip: "Używani przez Kreator do automatycznego generowania manifestów z linków Hugging Face i CivitAI. Klucze są zapisane lokalnie na tym komputerze i nigdy nie trafiają do LemonAI Hub.",
    aiProviderApiKeyTip: "Szyfrowany lokalnie, tylko na tym komputerze.",
    aiProviderNoKeyNeeded: "Ten dostawca nie potrzebuje klucza",
    aiProviderModelLabel: "Model",
    aiProvidersCountOne: "1 dostawca",
    webSearchTip: "Czat może szukać kontekstu w internecie. Działa dla modeli lokalnych i chmurowych, po włączeniu przełącznika „Szukaj w sieci” w czacie.",
    webSearchKeyTip: "Szyfrowany lokalnie, tylko na tym komputerze.",
    aiProvidersHint: "Używani przez Kreator do automatycznego generowania manifestów z linków Hugging Face i CivitAI.",
    aiProvidersLocalNotice: "Zapisane lokalnie tylko na tym PC — nigdy nie wysyłane do LemonAI Hub",
    aiProvidersEmpty: "Brak skonfigurowanych dostawców AI. Dodaj dostawcę chmurowego lub lokalny model (np. Gemma 4).",
    aiProvidersAdd: "Dodaj dostawcę",
    aiProvidersEdit: "Edytuj",
    aiProvidersDefaultBadge: "Domyślny",
    aiProvidersSetDefault: "Ustaw jako domyślny",
    aiProvidersFetchModels: "Pobierz modele",
    aiProvidersFetchingModels: "Pobieranie…",
    aiProvidersDefaultModel: "Domyślny model",
    aiProvidersNoModelsFetched: "Kliknij „Pobierz modele”, aby wczytać listę",
    aiProvidersFilterModels: "Filtruj modele…",
    aiProvidersLocalRuntime: "Lokalny runtime LemonAI (bez klucza API)",
    aiProviderModalAddTitle: "Dodaj dostawcę AI",
    aiProviderModalEditTitle: "Edytuj dostawcę AI",
    aiProviderKindLabel: "Dostawca",
    aiProviderLabelField: "Etykieta",
    aiProviderApiKeyLabel: "Klucz API",
    aiProviderApiKeyEditHint: "Zostaw puste, aby zachować zapisany klucz",
    aiProviderBaseUrlLabel: "Adres bazowy (dla „Własny”)",
    aiProviderProjectIdLabel: "Projekt (dla Vertex AI)",
    aiProviderRegionLabel: "Region (dla Vertex AI)",
    aiProviderLocalModelsLoading: "Wczytywanie zainstalowanych modeli…",
    aiProviderLocalModelsEmpty: "Brak zainstalowanych lokalnych modeli czatu (zainstaluj np. Gemma 4 w Katalogu).",
    aiProviderKindGoogleAiStudio: "Google AI Studio",
    aiProviderKindOpenAi: "OpenAI",
    aiProviderKindAnthropic: "Anthropic",
    aiProviderKindXai: "xAI",
    aiProviderKindVertexAi: "Google Vertex AI",
    aiProviderKindCustomOpenAi: "Własny (zgodny z OpenAI)",
    aiProviderKindLocalModel: "Lokalny model LemonAI",

    navCreator: "Kreator",
    creatorTitle: "Kreator",
    creatorVaultBadge: "Lokalny Sejf (Prywatny)",
    creatorNewManifest: "Nowy model",
    creatorVaultEmpty: "Tu pojawią się Twoje modele. Zacznij od nowego albo wklej link do repozytorium.",
    creatorVaultSearchPlaceholder: "Filtruj",
    creatorModeManual: "Ręczny",
    creatorModeAuto: "Wypełnij z linku (AI)",
    creatorAutoUrlPlaceholder: "https://huggingface.co/owner/repo lub https://civitai.com/models/...",
    creatorAutoProviderLabel: "Dostawca AI",
    creatorAutoModelOverrideLabel: "Model (opcjonalnie)",
    creatorAutoAnalyzeBtn: "Analizuj i generuj",
    creatorAutoAnalyzing: "Analizowanie źródła…",
    creatorAutoNoProvider: "Skonfiguruj dostawcę AI w Ustawieniach → Dostawcy AI (Sejf Offline).",
    creatorAutoSummaryTitle: "Pobrane metadane źródła",
    creatorAutoWarningsTitle: "Uwagi weryfikacji",
    creatorTabBasics: "Podstawy",
    creatorTabFormBuilder: "Formularz",
    creatorTabRawJson: "JSON",
    creatorSourceHf: "Hugging Face",
    creatorSourceCivitai: "CivitAI",
    creatorPickHfFiles: "Wybierz pliki…",
    creatorCivitaiLookupPlaceholder: "URL CivitAI lub ID modelu (np. 12345)",
    creatorCivitaiFetchBtn: "Pobierz z CivitAI",
    creatorCivitaiFetching: "Pobieranie…",
    creatorCivitaiTriggerWords: "Słowa aktywujące (Trigger words)",
    creatorCivitaiSelectFile: "Plik SafeTensor / GGUF",
    creatorOptionalLora: "Opcjonalny adapter LoRA",
    creatorLoraRepoPlaceholder: "Repozytorium LoRA (owner/repo)",
    creatorLoraFilePlaceholder: "Plik .safetensors",
    creatorPreviewTitle: "Podgląd formularza",
    creatorPreviewStudio: "Studio 420px",
    creatorPreviewCard: "Karta 720px",
    creatorValidationValid: "Manifest jest poprawny",
    creatorValidationIssues: "Manifest ma błędy: {x}",
    creatorSaveToVault: "Zapisz w Sejfie",
    creatorSavedToVault: "Zapisano w Sejfie",
    creatorInstallLocally: "Zainstaluj lokalnie",
    creatorOpenInStudio: "Otwórz w Studio",
    creatorExportJson: "Eksportuj .json",
    creatorPublishToHub: "Opublikuj w Hubie",
    creatorPublishedToHub: "Opublikowano w Hubie!",
    creatorDuplicate: "Duplikuj",
    creatorSignInToPublish: "Zaloguj się, aby opublikować w Hubie",
    creatorContextWindowTitle: "Okno kontekstu (tokeny)",
    creatorContextRecommendedLabel: "Zalecane okno kontekstu",
    creatorContextMaxSupportedLabel: "Maks. obsługiwane okno kontekstu",
    creatorContextWindowHint: "Zalecane to bezpieczny domyślny limit (np. 8192); maks. obsługiwane to limit architektury modelu.",
    creatorOutputTokensTitle: "Maks. tokenów odpowiedzi",
    creatorOutputRecommendedLabel: "Zalecany limit wyjścia",
    creatorOutputMaxSupportedLabel: "Maks. obsługiwane wyjście",
    creatorOutputTokensHint: "Zalecany limit jednej tury (np. 2048–4096) oraz maksimum modelu (nie większe niż okno kontekstu).",

    fbAddInput: "+ Dodaj pole",
    fbInputsTitle: "Pola formularza (ui.inputs)",
    fbNoInputs: "Brak pól formularza. Dodaj pierwsze pole poniżej.",
    fbFieldName: "Nazwa klucza",
    fbFieldLabel: "Etykieta",
    fbFieldWidget: "Widget",
    fbFieldDefault: "Wartość domyślna",
    fbFieldMin: "Min",
    fbFieldMax: "Max",
    fbFieldStep: "Krok",
    fbFieldUnit: "Jednostka",
    fbFieldPlaceholder: "Placeholder",
    fbFieldDescription: "Opis pomocniczy",
    fbFieldOptions: "Opcje (oddzielone przecinkami)",
    fbFieldQuickChips: "Szybkie chipy / trigger words (przecinki)",
    fbFieldAccept: "Akceptowane typy (np. audio/*)",
    fbFieldRequired: "Wymagane",
    fbFieldGridCols: "Szerokość (kolumny)",
    fbFieldDependsOn: "Warunek widoczności (depends_on)",
    fbFieldDependsOnField: "Pole źródłowe",
    fbFieldDependsOnValue: "Równe wartości",
    fbMoveUp: "W górę",
    fbMoveDown: "W dół",
    fbPresetsTitle: "Presety (ui.presets)",
    fbAddPreset: "+ Dodaj preset",
    fbPresetId: "ID presetu",
    fbPresetLabel: "Nazwa presetu",
    fbPresetValues: "Wartości (JSON)",
    fbOutputType: "Typ wyniku (ui.output.type)",
    fbColumns: "Kolumny formularza",

    webSearchSettingsTitle: "Wyszukiwanie w sieci (Czat)",
    webSearchSettingsHint: "Pozwala lokalnym i chmurowym modelom w czacie wyszukiwać kontekst w internecie po włączeniu przełącznika w czacie.",
    webSearchProviderLabel: "Wyszukiwarka",
    webSearchProviderDuckDuckGo: "DuckDuckGo (domyślna, bez klucza API)",
    webSearchProviderBrave: "Brave Search API",
    webSearchProviderTavily: "Tavily Search API",
    webSearchProviderSearxng: "SearXNG (własna instancja)",
    webSearchApiKeyLabel: "Klucz API wyszukiwarki",
    webSearchApiKeyPlaceholder: "Wpisz klucz API…",
    webSearchApiKeyHint: "Szyfrowany lokalnie tylko na tym komputerze.",
    webSearchClearKey: "Wyczyść klucz",
    webSearchBaseUrlLabel: "Adres bazowy SearXNG",
    webSearchFetchPagesLabel: "Pobieraj treść znalezionych stron",
    webSearchFetchPagesHint: "Odczytuje czysty tekst z najlepszych wyników, aby dać modelowi głębszy kontekst.",
    webSearchMaxResultsLabel: "Maks. liczba wyników",
    webSearchSaved: "Zapisano ustawienia wyszukiwania.",
    webSearchSaveButton: "Zapisz ustawienia wyszukiwania",

    lightboxTitle: "Podgląd obrazu — kadr #{index}",
    lightboxSubtitle: "Zapisz: wybierz format pliku.",
    lightboxFrameInfo: "Kadr {index} z {total}, {format}",
    lightboxPrevAria: "Poprzedni kadr",
    lightboxPrev: "◀ Poprzedni",
    lightboxImageAlt: "Pełny podgląd obrazu #{index}",
    lightboxNextAria: "Następny kadr",
    lightboxNext: "Następny ▶",
    lightboxDownload: "Pobierz {format}",

    comfyStatusRunning: "Działa",
    comfyStatusStarting: "Uruchamianie…",
    comfyStatusExited: "Zakończył działanie (kod {code})",
    comfyStatusStopped: "Zatrzymany",
    comfyEvictedTitle: "ComfyUI został zatrzymany",
    comfyEvictedText: "Uruchomiłeś model w LemonAI, a karta graficzna mieści jednocześnie tylko jedno z nich. Zapisane workflow i wyniki zostają w folderze ComfyUI.",
    comfyEvictedPrimary: "Uruchom ComfyUI ponownie",
    comfyEvictedSecondary: "Wróć do Studio",
    comfyEvictedHint: "Ponowne uruchomienie zatrzyma uruchomiony model.",
    comfyCrashedTitle: "ComfyUI przestał działać",
    comfyCrashedText: "Proces zakończył się z kodem {code}. Przyczynę pokażą ostatnie linie dziennika.",
    comfyCrashedPrimary: "Uruchom ponownie",
    comfyCrashedSecondary: "Pokaż dziennik",
    comfyCrashedHint: "Dziennik jest też dostępny w panelu Zarządzaj.",
    comfyStoppedTitle: "ComfyUI nie działa",
    comfyStoppedText: "Uruchom go, aby otworzyć interfejs tutaj. Pierwsze uruchomienie trwa dłużej.",
    comfyStoppedPrimary: "Uruchom ComfyUI",
    comfyStoppedSecondary: "Zarządzaj",
    comfyStoppedHint: "Uruchomienie ComfyUI zatrzyma uruchomiony model.",
    comfyBackApps: "Aplikacje",
    comfyLog: "Dziennik",
    comfyManage: "Zarządzaj",
    comfyOpenBrowser: "Otwórz w przeglądarce",
    comfyStop: "Zatrzymaj",
    comfyStart: "Uruchom",
    comfyRestart: "Uruchom ponownie",
    comfyManagerHintPrefix: "Przycisk „Manager” jest częścią ComfyUI. LemonAI instaluje go sam i uruchamia z",
    comfyManagerHintSuffix: "Tu dodajesz węzły i modele.",
    comfyDismissHint: "Rozumiem",
    comfyPanelAria: "Interfejs ComfyUI",
    comfyBrowserFallback: "Interfejs ComfyUI otwiera się tutaj w aplikacji LemonAI. W podglądzie przeglądarkowym użyj „Otwórz w przeglądarce”.",
    comfyStartingTitle: "Uruchamianie ComfyUI…",
    comfyStartingDesc: "Czekam, aż serwer odpowie. Pierwsze uruchomienie trwa dłużej. Gdy będzie gotowy, ComfyUI otworzy się tutaj.",
    comfyLogAria: "Dziennik ComfyUI",
    comfyLogEmpty: "Brak wpisów.",
  },
  en: {
    close: "Close",
    cancel: "Cancel",
    refresh: "Refresh",
    save: "Save",
    delete: "Delete",
    clear: "Clear",
    search: "Search...",

    workspace: "Workspace",
    modelHub: "Model Hub",
    apps: "Applications",
    admin: "Admin",
    history: "History",
    addScript: "+ Add Script",
    login: "Sign in",
    logout: "Sign out",
    themeToggle: "Toggle theme",

    installedModels: "Installed Models",
    stopped: "Stopped",
    loading: "Loading",
    ready: "Ready",
    inferring: "Inferring",
    unloading: "Unloading",
    minVram: "VRAM",
    status: "Status",
    unloadVram: "Unload VRAM",

    runModel: "Run Model",
    stopModel: "Stop",
    processing: "Processing...",
    noActiveModel: "No active model",

    modelOutput: "Model Output",
    noOutput: "No output data",
    copy: "Copy",
    copied: "✓ Copied",
    generating: "Generating...",
    telemetryConsole: "Telemetry Console",
    idleLogs: "[IDLE] Waiting for telemetry events...",
    ttft: "TTFT",
    speed: "Speed",
    tokens: "Tokens",
    duration: "Duration",
    downloadAudio: "Download WAV",
    copyAudio: "Copy Audio",
    audioCopied: "✓ Copied Audio",
    playbackSpeed: "Playback Speed",
    copyJson: "Copy JSON",
    downloadJson: "Download JSON",
    searchJson: "Search JSON...",
    expandAll: "Expand All",
    collapseAll: "Collapse All",
    jsonCopied: "✓ Copied JSON",

    catalogTitle: "Catalog",
    searchModelsPlaceholder: "Search models by name or description...",
    allCategories: "All",
    curatedOnly: "Curated only",
    curated: "Curated",
    author: "author",
    installed: "Installed",
    openInWorkspace: "Open in Workspace",
    uninstall: "Uninstall",
    installing: "Installing...",
    cancelInstall: "Cancel",
    hardwareMonitor: "Hardware Monitor",
    vramUsage: "VRAM Usage",
    safeBudget: "Safe Budget",
    allocatedVram: "Allocated",
    freeVram: "Free",
    hostRam: "Host RAM",
    activeModelsInVram: "Active models in VRAM",
    noActiveModelsInVram: "No active models in VRAM",
    accelerator: "Accelerator",
    installPrompt: "Install",
    noModelsFound: "No models match criteria",
    confirmUninstallTitle: "Uninstall model?",
    confirmUninstallDesc: "The model will be removed from this computer. You can install it again at any time. Your result history stays.",
    communityWarningTitle: "Community Model",
    communityWarningDesc: "This package has not been verified by LemonAI. Install only if you trust the source.",
    installAnyway: "Install anyway",

    authModalTitle: "LemonAI Hub Account",
    loginTab: "Sign In",
    registerTab: "Sign Up",
    identifierLabel: "Username or Email",
    usernameLabel: "Username",
    emailLabel: "Email address",
    passwordLabel: "Password",
    loginSubmit: "Sign In",
    registerSubmit: "Create Account",
    loginRequired: "Sign In Required",
    loginToUpload: "Sign In or Register",

    uploadModalTitle: "Publish a model",
    modelNameLabel: "Model Name *",
    slugLabel: "Slug ID *",
    categoryLabel: "Category *",
    runtimeEngineLabel: "Runtime Engine *",
    hfRepoLabel: "Repository",
    hfFileLabel: "Weights file",
    minVramGbLabel: "Required VRAM (GB)",
    minRamGbLabel: "Required RAM (GB)",
    uploadSubmit: "Publish",
    uploadModalDesc: "Describe a Hugging Face model and others can install it in LemonAI with one click.",
    uploadReviewNote: "The entry goes to a moderator for review.",
    uploadPublishNow: "The entry will appear in the catalog right away.",

    profileNav: "Profile",
    myManifestsTab: "My models",
    security2faTab: "Security",
    accountSettingsTab: "Account",
    editManifest: "Edit manifest",
    deleteManifest: "Delete",
    twoFactorEnabled: "Enabled (Active)",
    twoFactorDisabled: "Disabled",
    enable2fa: "Enable 2FA",
    disable2fa: "Disable 2FA",
    changePassword: "Change Password",
    revokeAllSessions: "Sign Out All Devices",
    deleteAccount: "Delete Account",

    chatNew: "New chat",
    chatConversations: "Conversations",
    chatNoConversations: "No conversations yet. Write a message to start.",
    chatUntitled: "New conversation",
    chatEmptyTitle: "Start a conversation",
    chatEmptyHint: "The model remembers the earlier messages of this conversation. When the context window fills up, older messages are summarised.",
    chatPlaceholder: "Write a message… (Enter sends, Shift+Enter adds a line)",
    chatSend: "Send",
    chatStop: "Stop",
    chatMessageLabel: "Message",
    chatYou: "You",
    chatThinking: "Thinking",
    chatSettings: "Chat settings",
    chatContext: "Context window",
    chatContextUnknown: "Token usage appears after the first answer.",
    chatTokensUsed: "tokens",
    chatCompacting: "Summarising older messages so the conversation fits the context…",
    chatCompacted: "Older messages were summarised for the model.",
    chatSummaryMarker: "The model knows the messages above only from a summary",
    chatSummaryShow: "Show summary",
    chatSummaryLossy: "Some older messages were dropped without being summarised.",
    chatInterrupted: "stopped",
    chatTruncated: "cut off: length limit reached",
    chatTruncatedMaxTokens: "cut off: Max tokens limit reached",
    chatTruncatedContext: "cut off: context window full",
    chatContinue: "Continue",
    chatContinuingPart: "Generating part {part} of {max}…",
    chatPartBadge: "part {n}",
    chatNoAnswer: "(the model returned no answer)",
    chatDelete: "Delete conversation",
    chatDeleteConfirm: "Delete?",
    chatRename: "Rename",
    chatStarting: "Starting the model…",
    chatLogs: "Log",
    chatWebSearch: "Web search",
    chatWebSearchHint: "Allow the model to search the internet for additional context",
    chatWebSearchingPlanning: "Planning web search…",
    chatWebSearchingQuery: "Searching the web: {q}",
    chatWebSearchingReading: "Reading web pages…",
    chatWebSources: "Web sources ({n})",
    chatWebSourceSingle: "Web source (1)",
    chatWebSearchUnavailable: "Web search unavailable",
    chatWebQueries: "Queries:",
    chatWebPageRead: "page read",
    chatContextLimitLabel: "Context limit (tokens)",
    chatContextRecommended: "Recommended:",
    chatContextMaxSupported: "Max supported:",
    chatContextApply: "Apply",
    chatContextApplyRestart: "Apply & restart",
    chatContextRestarting: "Restarting model…",
    chatContextReset: "Reset",
    chatContextAboveRecommended: "Above recommended limit — uses extra VRAM and may slow generation.",
    chatContextUpdated: "Context window limit updated.",
    chatContextRestartNeeded: "Limit saved — will take effect next time the model starts.",
    chatExtendedMaxTokens: "Extended Max tokens limit",
    chatExtendedMaxTokensHint: "Unlocks answer budget up to the model's supported max ({max} tokens) instead of half the window.",
    chatAutoContinue: "Auto-continue in parts",
    chatAutoContinueHint: "Automatically stitches up to 4 continuation parts when generation hits the length limit.",
    chatMaxTokensAutoPlaceholder: "Auto (remaining context)",
    chatOutputRecommended: "Recommended output:",
    chatOutputMaxSupported: "Max supported output:",

    navStudio: "Studio",
    hubConnectedShort: "Hub connected",
    navBell: "Bell",
    notificationsMarkRead: "Mark as read",
    navCatalog: "Catalog",
    navApps: "Apps",
    navHistory: "History",
    navSettings: "Settings",
    navSignIn: "Sign in",
    navAccount: "Your account",
    mainNavigation: "Main navigation",
    settingsTitle: "Settings",
    settingsSubtitle: "They work without an account and are saved on this computer.",
    settingsLook: "Appearance",
    settingsLookHint: "Click to see it right away.",
    themeLemon: "Lemon",
    themeDark: "Dark",
    themeLight: "Light",
    themeSystem: "Match system",
    settingsLanguage: "Language",
    settingsMemory: "Memory for models",
    settingsMemoryHint: "What to do when a model does not fit the graphics card.",
    memoryAuto: "Automatic",
    memoryAutoDesc: "The overflow goes to RAM: bigger models run, just slower.",
    memoryGpuOnly: "Graphics card only",
    memoryGpuOnlyDesc: "Always fast. A model that does not fit will not start.",
    memoryAppliesNext: "Applies the next time a model starts.",
    settingsFolder: "Models folder",
    settingsFolderHint: "Downloaded models go here. Large models take tens of GB.",
    settingsChange: "Change…",
    settingsLogs: "Application logs",
    settingsLogsHint: "Rotating diagnostic logs (lemonai.log), llama-server stderr, and token accounting.",
    openLogsFolder: "Open logs folder",
    settingsHf: "Hugging Face",
    settingsHfHint: "A token is only needed for gated models.",
    settingsHfButton: "Access token…",
    settingsAdult: "Adult content",
    settingsAdultHint: "Uncensored (Heretic) chat models and NSFW image models. Hidden by default.",
    adultToggle: "Show adult models (18+)",
    adultConfirmTitle: "Are you 18 or older?",
    adultConfirmBody: "These models can create sexual content and answer requests that ordinary models refuse. You are responsible for how you use them and for whether that is legal where you are.",
    adultConfirmYes: "Yes, I am 18 or older",
    settingsAccount: "LemonAI Hub account",
    settingsAccountHint: "Only needed to publish models, rate them and receive messages.",
    signedOutTitle: "You are not signed in",
    signedOutBody: "Everything above works without an account. Sign in when you want to publish models.",
    createAccount: "Create an account",
    myModels: "My models",
    publishModel: "Publish a model",
    hubUnavailableShort: "Hub unavailable",
    ramModelUses: "model uses {x}",
    studioPickModel: "Choose a model",
    studioNoModelsTitle: "You have no models yet",
    studioNoModelsHint: "Install a model from the catalog. We will pick the version that suits your computer.",
    studioOpenCatalog: "Open the catalog",
    releaseMemory: "Free memory",
    placementGpu: "whole model on the GPU",
    placementRam: "partly in RAM, so slower",
    placementLayers: "{on} of {total} layers on the GPU",
    startsOnFirstRun: "starts on first use",
    logToggle: "Log",
    generate: "Generate",
    run: "Run",
    stageEmptyTitle: "What shall we squeeze today?",
    stageEmptyHint: "Describe what you want and press the button. Every result is saved in History.",
    catalogHeroKicker: "The best chat model for your computer",
    catalogHeroInstall: "Install",
    catalogHeroOpen: "Open in Studio",
    catalogCompare: "Compare versions",
    yourGpu: "Your GPU",
    yourRam: "System RAM",
    modelNeeds: "Model needs",
    leftFree: "Left free",
    onlyFitting: "Only what fits my computer",
    onlyOfficial: "Official only",
    fitGpu: "fits the GPU",
    fitRam: "partly in RAM (slower)",
    fitNone: "not enough memory",
    meterLegend: "Bar = your GPU memory ({x}).",
    chooseVersion: "Choose version",
    openModel: "Open",
    installedTag: "installed",
    recommendedFor: "Recommended for you: {x}",
    newVersion: "Update available",
    adultTag: "18+",
    moreOptions: "More: {x}",
    pickerTitle: "Which {x}?",
    pickerHint: "The taller the bar, the smarter the model and the more memory it needs. Everything below the line fits your GPU.",
    pickerYourCard: "Your GPU",
    pickerRecommended: "Recommended",
    pickerInstalled: "Installed",
    pickerAllowRam: "Allow system RAM when the model does not fit the GPU",
    pickerAllowRamDesc: "Bars above the line still work, only slower (the orange part goes to RAM).",
    pickerDetected: "Detected: {vram} on the GPU, {ram} RAM",
    pickerWhyRecommended: "Recommended: the largest version that fits your GPU entirely.",
    pickerFitsGpu: "Fits your GPU entirely.",
    pickerSpills: "Does not fit the GPU: {x} goes to RAM, so it will be slower.",
    pickerTooBig: "Not enough memory for this version.",
    pickerGpuNeed: "Graphics card",
    pickerRamNeed: "System RAM",
    pickerInstall: "Install {x}",
    pickerOpen: "Open {x} in Studio",
    hubUnavailableBanner: "The Hub is unavailable. Showing the models built into the app.",
    tryAgain: "Try again",
    paramsToggle: "Parameters",
    settingsNavLabel: "Settings sections",
    settingsNavAdult: "Adult content",
    settingsNavFiles: "Models and files",
    settingsNavAi: "AI providers",
    settingsNavWeb: "Web search",
    settingsNavAccount: "Account",
    settingsAdultTitle: "Adult content (18+)",
    settingsAdultTip: "When you turn it on, we will ask you to confirm your age.",
    settingsAdultDesc: "Uncensored models and NSFW image models. Hidden by default.",
    settingsFiles: "Models and files",
    settingsFolderLabel: "Models folder",
    settingsFreeSpaceTail: "Large models take tens of GB.",
    settingsHfLabel: "Hugging Face token",
    settingsHfHelp: "Only needed for models that ask you to accept terms on Hugging Face.",
    settingsCivLabel: "CivitAI token",
    settingsCivTip: "Saved only on this computer.",
    settingsCivHelp: "For CivitAI models that require signing in.",
    settingsCivPlaceholder: "Paste the token…",
    settingsTokenRemove: "Remove",
    settingsTokenSaved: "saved",
    aiProviderAddHeading: "Add a provider",
    aiProviderEditHeading: "Edit the provider",
    aiProviderField: "Provider",
    aiProviderLabelShort: "Label",
    aiProviderKeyTip: "Encrypted locally, only on this computer.",
    aiProviderBaseUrlCustom: "Base URL (for “Custom”)",
    aiProviderModelShort: "Model",
    aiProviderProjectShort: "Project (for Vertex AI)",
    aiProviderRegionShort: "Region (for Vertex AI)",
    aiProvidersCount: "{n} providers",
    aiProvidersAddButton: "Add the provider",
    aiProvidersSaveButton: "Save changes",
    aiProviderDelete: "Delete the provider",
    settingsAccountTitle: "Account",
    settingsAccountCta: "Handy when you want to publish your own models or rate other people’s.",
    settingsSignInButton: "Sign in",
    settingsSignOut: "Sign out",
    settingsMyProfile: "My profile",
    stageAudioEmptyTitle: "What shall we play today?",
    stageAudioEmptyHint: "Type a text or describe the sound below and press the button. Every result goes to the History.",
    stageImageEmptyHint: "Describe the image below and press Generate. Every result goes to the History.",
    stageGenerating: "Generating…",
    stageGeneratingNote: "The model is in memory; the first result should arrive in a few seconds.",
    stageRecent: "RECENT",
    stageAllResults: "All →",
    stageSaveAs: "Save as…",
    stageCopy: "Copy",
    stageShowInHistory: "Show in History",
    stageSearchResult: "Search in the result",
    stageTabText: "Text",
    stageTelemetry: "TELEMETRY",
    stageLogAll: "All",
    stageLogWarn: "Warnings",
    stageLogError: "Errors",
    stageMetricTime: "Time",
    studioQuality: "Quality",
    studioQualityFast: "Fast",
    studioQualityExact: "Precise",
    cancelRun: "Cancel",
    fieldsRequired: "required field",
    presetsHeading: "Presets",
    appsInstalled: "INSTALLED",
    appsAvailable: "AVAILABLE",
    appsPlanned: "NOT AVAILABLE YET",
    appsPlannedNote: "Planned apps — LemonAI does not install them yet.",
    appsSoonTag: "Not available yet",
    appsSoon: "Soon",
    appsSearch: "Search apps",
    appsUpdateHint: "Stop ComfyUI to update it — a new version installs only while the program is not running.",
    catGroupFits: "Fit on your card",
    catGroupFitsNote: "Run fast, without touching RAM.",
    catGroupSlower: "Will run slower",
    catGroupSlowerNote: "Part of the model goes to RAM.",
    catGroupNone: "Not enough memory",
    catGroupNoneNote: "They will not fit this computer.",
    catShowUnfit: "Show models that will not fit",
    catHideUnfit: "Hide models that will not fit",
    catSortLabel: "Sort",
    catSortDefault: "Recommended",
    catSortName: "Name",
    catSortSizeAsc: "Size (ascending)",
    catSortSizeDesc: "Size (descending)",
    catSortRating: "Best rated",
    catHeroYourCard: "Your card",
    catHeroModel: "Model {x}",
    catHeroLeft: "{x} left free",
    catHeroRam: "Plus {x} of RAM as a reserve.",
    catHeroSpills: "{x} goes to RAM",
    catSearchModels: "Search models",
    catFootRetry: "Try again",
    instrFromChat: "From this conversation",
    chatEditingLast: "Editing your last question; the answer will be generated again.",
    chatEditingCancel: "Cancel editing",
    chatRetry: "Try again",
    chatEditQuestion: "Edit question",
    chatExportMd: "Export .md",
    chatCopyConversation: "Copy conversation",
    chatMoreActions: "More",
    chatGroupToday: "TODAY",
    chatGroupYesterday: "YESTERDAY",
    chatGroupEarlier: "EARLIER",
    chatThinkingDone: "Thought for {s} s",
    chatSpeed: "{n} tok/s",
    chatSendLabel: "Send",
    paramsTitle: "Parameters",
    paramsSavedAuto: "Saved automatically",
    paramsRestarting: "Restarting the model…",
    instrLabel: "Model instructions",
    instrTip: "Rules the model gets before every conversation: language, tone, answer length.",
    instrBuiltinGroup: "BUILT-IN",
    instrMineGroup: "MINE",
    instrPreview: "PREVIEW",
    instrNew: "New instruction",
    instrEdit: "Edit",
    instrShowAll: "Show all",
    instrTagBuiltin: "Built-in",
    instrTagMine: "Mine",
    instrListLabel: "Instructions",
    instrNewTitle: "New instruction",
    instrEditTitle: "Edit instruction",
    instrReadOnly: "Built-in, read only. Make a copy to change it.",
    instrName: "Name",
    instrNamePh: "E.g. Technical editor",
    instrText: "Text",
    instrTextPh: "Describe how the model should answer: language, tone, format, what to avoid.",
    instrSaveUse: "Save and use",
    instrCopyEdit: "Copy and edit",
    instrDelete: "Delete instruction",
    instrCounter: "{w} words · about {t} tokens",
    instrCopySuffix: "(copy)",
    instrModelDefault: "Model default",
    instrNoneName: "No instruction",
    instrNoneText: "The model answers without extra rules.",
    instrNoneSnippet: "No extra rules",
    instrConciseName: "Concise assistant",
    instrConciseText: "Answer briefly and to the point. Give the answer first, then one sentence of explanation if needed. Do not repeat the question.",
    instrConciseSnippet: "Short and to the point",
    instrTranslatorName: "Translator PL ↔ EN",
    instrTranslatorText: "Translate every message between Polish and English. Keep the tone and formatting. Add no comments unless a phrase has several meanings.",
    instrTranslatorSnippet: "Translates both ways, no comments",
    instrTutorName: "Tutor",
    instrTutorText: "Explain in plain language, step by step. Ask questions that check understanding and do not hand over the finished solution right away.",
    instrTutorSnippet: "Explains step by step, asks",
    instrDeveloperName: "Developer",
    instrDeveloperText: "Write code in fenced blocks with the language named. Explain briefly what it does and why. Point out edge cases and likely errors.",
    instrDeveloperSnippet: "Fenced code, edge cases",
    instrEditorName: "Editor",
    instrEditorText: "Improve style, punctuation and clarity while keeping the author’s voice. Show the changes as a short list.",
    instrEditorSnippet: "Improves style, keeps the voice",
    paramStyle: "Response style",
    paramStyleTip: "This is the temperature. Lower gives more predictable answers, higher more creative ones.",
    paramStylePrecise: "Precise",
    paramStyleCreative: "Creative",
    paramLength: "Answer length",
    paramLengthTip: "Limit on the length of one answer, counted in tokens.",
    paramLengthTokens: "{n} tokens",
    paramLengthAuto: "Auto",
    paramMemory: "Conversation memory",
    paramMemoryTip: "How much text the model remembers at once. More memory means a longer conversation but more RAM and VRAM. Recommended: {rec} (underlined). Changing it restarts the model; the conversation stays.",
    paramMemoryWords: "≈ {n} words of conversation",
    paramMemoryRestarting: "The model is restarting. The conversation stays.",
    paramThinkingTip: "The model reasons first, then answers. Slower, but more accurate on hard questions. The reasoning appears in a folded block.",
    paramExtendedLabel: "Longer answers",
    paramContinueLabel: "Finish cut-off answers",
    paramContinueTip: "When an answer is cut off, the model writes the rest in further parts (up to 4).",
    paramExtendedTip: "Raises the answer length limit to the model’s maximum ({max} tokens) instead of half the conversation memory.",
    onGpuShort: "on the GPU",

    settingsFreeSpace: "Free space:",
    settingsTokenSet: "Token set",
    settingsNoToken: "No token",
    settingsSignedInHub: "Signed in to LemonAI Hub",
    settingsCivitai: "CivitAI",
    settingsCivitaiHint: "Optional API key for gated CivitAI checkpoints and LoRAs. Encrypted locally on this PC only.",
    settingsCivitaiButton: "API key…",
    civitaiModalTitle: "CivitAI API Key",
    civitaiModalBody: "A CivitAI API key lets you download gated models (civitai.com → Account Settings → API Keys). Stored encrypted locally on this PC only — never sent to LemonAI Hub.",
    civitaiModalSaved: "Saved key:",
    civitaiModalNone: "No key saved.",
    civitaiModalNewToken: "New API key",
    civitaiModalRemove: "Remove key",
    localOnlyBadge: "Stored locally on this PC only",

    aiProvidersTitle: "AI Providers (Offline Vault)",
    creatorSubtitle: "Your own models, stored only on this computer.",
    creatorListAria: "Your manifests",
    creatorFilterAria: "Filter models",
    creatorEditorAria: "Model editor",
    creatorTabsAria: "Sections",
    creatorSourceTitle: "Where to download from",
    creatorWhatModelTitle: "What kind of model",
    creatorMemoryTitle: "How much memory it needs",
    creatorAdvanced: "Advanced",
    creatorAdvancedHint: "checksum, context window, limits",
    creatorFormIntro: "Fields the user will see in Studio next to the model.",
    creatorPreviewAside: "Preview",
    creatorEditField: "Edit",
    creatorBack: "← Creator",
    creatorFormTitle: "Model form",
    creatorStudioPreviewHeading: "Preview in Studio",
    creatorCatalogPreview: "This is how others will see it in the Catalog",
    creatorYouPrivate: "You · private",
    creatorFitOk: "{x} GB of {y} GB on your card",
    creatorFitSpill: "{x} GB, part will spill into RAM",
    creatorFitUnknown: "{x} GB of graphics memory required",
    creatorAutoDone: "Done",
    creatorAutoIntro: "Paste a repository link and the AI will fill in the manifest.",
    creatorModelKind: "Kind",
    creatorEngine: "Engine",
    creatorDescription: "Description",
    creatorRepo: "Repository",
    creatorWeightsFile: "Weights file",
    creatorModelName: "Model name",
    creatorVramLabel: "Graphics card (GB)",
    creatorRamLabel: "RAM (GB)",
    creatorKindChat: "Chat",
    creatorKindImage: "Image",
    creatorKindAudio: "Audio",
    creatorKindVision: "Vision",
    creatorKindMultimodal: "Multimodal",
    fbFieldNumber: "FIELD {n}",
    aiProvidersTip: "Used by the Creator to auto-generate manifests from Hugging Face and CivitAI links. Keys are stored locally on this computer and never reach LemonAI Hub.",
    aiProviderApiKeyTip: "Encrypted locally, on this computer only.",
    aiProviderNoKeyNeeded: "This provider needs no key",
    aiProviderModelLabel: "Model",
    aiProvidersCountOne: "1 provider",
    webSearchTip: "Chat can look up context on the internet. Works for local and cloud models once the “Search the web” switch is on in the chat.",
    webSearchKeyTip: "Encrypted locally, on this computer only.",
    aiProvidersHint: "Used by the Creator to auto-generate manifests from Hugging Face and CivitAI URLs.",
    aiProvidersLocalNotice: "Stored locally on this PC only — never sent to LemonAI Hub",
    aiProvidersEmpty: "No AI providers configured yet. Add a cloud provider or a local installed model (e.g. Gemma 4).",
    aiProvidersAdd: "Add provider",
    aiProvidersEdit: "Edit",
    aiProvidersDefaultBadge: "Default",
    aiProvidersSetDefault: "Set as Default",
    aiProvidersFetchModels: "Fetch Models",
    aiProvidersFetchingModels: "Fetching…",
    aiProvidersDefaultModel: "Default Model",
    aiProvidersNoModelsFetched: "Click \"Fetch Models\" to load available models",
    aiProvidersFilterModels: "Filter models…",
    aiProvidersLocalRuntime: "Local LemonAI runtime (no API key needed)",
    aiProviderModalAddTitle: "Add AI Provider",
    aiProviderModalEditTitle: "Edit AI Provider",
    aiProviderKindLabel: "Provider",
    aiProviderLabelField: "Label",
    aiProviderApiKeyLabel: "API Key",
    aiProviderApiKeyEditHint: "Leave blank to keep the existing stored key",
    aiProviderBaseUrlLabel: "Base URL (for “Custom”)",
    aiProviderProjectIdLabel: "Project (for Vertex AI)",
    aiProviderRegionLabel: "Region (for Vertex AI)",
    aiProviderLocalModelsLoading: "Loading installed local models…",
    aiProviderLocalModelsEmpty: "No local chat models installed yet (install e.g. Gemma 4 from the Catalog).",
    aiProviderKindGoogleAiStudio: "Google AI Studio",
    aiProviderKindOpenAi: "OpenAI",
    aiProviderKindAnthropic: "Anthropic",
    aiProviderKindXai: "xAI",
    aiProviderKindVertexAi: "Google Vertex AI",
    aiProviderKindCustomOpenAi: "Custom (OpenAI-compatible)",
    aiProviderKindLocalModel: "Local LemonAI model",

    navCreator: "Creator",
    creatorTitle: "Creator",
    creatorVaultBadge: "Local Vault (Private)",
    creatorNewManifest: "New model",
    creatorVaultEmpty: "Your models will show up here. Start a new one or paste a repository link.",
    creatorVaultSearchPlaceholder: "Filter",
    creatorModeManual: "Manual",
    creatorModeAuto: "Fill from link (AI)",
    creatorAutoUrlPlaceholder: "https://huggingface.co/owner/repo or https://civitai.com/models/...",
    creatorAutoProviderLabel: "AI Provider",
    creatorAutoModelOverrideLabel: "Model (optional)",
    creatorAutoAnalyzeBtn: "Analyze & Generate",
    creatorAutoAnalyzing: "Analyzing source…",
    creatorAutoNoProvider: "Configure an AI provider in Settings → AI Providers (Offline Vault).",
    creatorAutoSummaryTitle: "Harvested Source Metadata",
    creatorAutoWarningsTitle: "Verification Notes",
    creatorTabBasics: "Basics",
    creatorTabFormBuilder: "Form",
    creatorTabRawJson: "JSON",
    creatorSourceHf: "Hugging Face",
    creatorSourceCivitai: "CivitAI",
    creatorPickHfFiles: "Choose files…",
    creatorCivitaiLookupPlaceholder: "CivitAI URL or model ID (e.g. 12345)",
    creatorCivitaiFetchBtn: "Fetch from CivitAI",
    creatorCivitaiFetching: "Fetching…",
    creatorCivitaiTriggerWords: "Trigger words",
    creatorCivitaiSelectFile: "SafeTensor / GGUF file",
    creatorOptionalLora: "Optional LoRA adapter",
    creatorLoraRepoPlaceholder: "LoRA repo (owner/repo)",
    creatorLoraFilePlaceholder: ".safetensors file",
    creatorPreviewTitle: "Live Studio Preview",
    creatorPreviewStudio: "Studio 420px",
    creatorPreviewCard: "Card 720px",
    creatorValidationValid: "Manifest is valid",
    creatorValidationIssues: "Manifest has {x} issues",
    creatorSaveToVault: "Save to Vault",
    creatorSavedToVault: "Saved to Vault",
    creatorInstallLocally: "Install Locally",
    creatorOpenInStudio: "Open in Studio",
    creatorExportJson: "Export .json",
    creatorPublishToHub: "Publish to Hub",
    creatorPublishedToHub: "Published to Hub!",
    creatorDuplicate: "Duplicate",
    creatorSignInToPublish: "Sign in to publish to Hub",
    creatorContextWindowTitle: "Context window (tokens)",
    creatorContextRecommendedLabel: "Recommended context window",
    creatorContextMaxSupportedLabel: "Max supported context window",
    creatorContextWindowHint: "Recommended is the safe default (e.g. 8192); max supported is the model's native architecture cap.",
    creatorOutputTokensTitle: "Max output tokens",
    creatorOutputRecommendedLabel: "Recommended output tokens",
    creatorOutputMaxSupportedLabel: "Max supported output",
    creatorOutputTokensHint: "Recommended per-turn reply limit (e.g. 2048–4096) and model output cap (at most max context).",

    fbAddInput: "+ Add Field",
    fbInputsTitle: "Form Inputs (ui.inputs)",
    fbNoInputs: "No form fields yet. Add your first field below.",
    fbFieldName: "Field Key",
    fbFieldLabel: "Label",
    fbFieldWidget: "Widget",
    fbFieldDefault: "Default Value",
    fbFieldMin: "Min",
    fbFieldMax: "Max",
    fbFieldStep: "Step",
    fbFieldUnit: "Unit",
    fbFieldPlaceholder: "Placeholder",
    fbFieldDescription: "Helper Description",
    fbFieldOptions: "Options (comma-separated)",
    fbFieldQuickChips: "Quick Chips / Trigger Words (comma-separated)",
    fbFieldAccept: "Accepted types (e.g. audio/*)",
    fbFieldRequired: "Required",
    fbFieldGridCols: "Width (columns)",
    fbFieldDependsOn: "Visibility Condition (depends_on)",
    fbFieldDependsOnField: "Source field",
    fbFieldDependsOnValue: "Equals value",
    fbMoveUp: "Move up",
    fbMoveDown: "Move down",
    fbPresetsTitle: "Presets (ui.presets)",
    fbAddPreset: "+ Add Preset",
    fbPresetId: "Preset ID",
    fbPresetLabel: "Preset Label",
    fbPresetValues: "Values (JSON)",
    fbOutputType: "Output Type (ui.output.type)",
    fbColumns: "Form Columns",

    webSearchSettingsTitle: "Web Search (Chat)",
    webSearchSettingsHint: "Lets chat models search the internet for extra context when the Web search toggle is enabled in Chat.",
    webSearchProviderLabel: "Search engine",
    webSearchProviderDuckDuckGo: "DuckDuckGo (default, no API key)",
    webSearchProviderBrave: "Brave Search API",
    webSearchProviderTavily: "Tavily Search API",
    webSearchProviderSearxng: "SearXNG (self-hosted instance)",
    webSearchApiKeyLabel: "Search API key",
    webSearchApiKeyPlaceholder: "Enter search API key…",
    webSearchApiKeyHint: "Encrypted locally on this device only.",
    webSearchClearKey: "Clear search key",
    webSearchBaseUrlLabel: "SearXNG base URL",
    webSearchFetchPagesLabel: "Fetch full page text from top results",
    webSearchFetchPagesHint: "Reads clean article text from the top results for richer grounding.",
    webSearchMaxResultsLabel: "Max search results",
    webSearchSaved: "Web search settings saved.",
    webSearchSaveButton: "Save web search settings",

    lightboxTitle: "Image preview — frame #{index}",
    lightboxSubtitle: "Save: choose a file format.",
    lightboxFrameInfo: "Frame {index} of {total}, {format}",
    lightboxPrevAria: "Previous frame",
    lightboxPrev: "◀ Previous",
    lightboxImageAlt: "Full image preview #{index}",
    lightboxNextAria: "Next frame",
    lightboxNext: "Next ▶",
    lightboxDownload: "Download {format}",

    comfyStatusRunning: "Running",
    comfyStatusStarting: "Starting…",
    comfyStatusExited: "Exited (code {code})",
    comfyStatusStopped: "Stopped",
    comfyEvictedTitle: "ComfyUI was stopped",
    comfyEvictedText: "You ran a model in LemonAI, and your GPU can only hold one at a time. Saved workflows and outputs remain in the ComfyUI folder.",
    comfyEvictedPrimary: "Restart ComfyUI",
    comfyEvictedSecondary: "Back to Studio",
    comfyEvictedHint: "Restarting will stop the currently running model.",
    comfyCrashedTitle: "ComfyUI stopped working",
    comfyCrashedText: "The process exited with code {code}. The last lines of the log should show why.",
    comfyCrashedPrimary: "Restart",
    comfyCrashedSecondary: "Show log",
    comfyCrashedHint: "The log is also available in the Manage panel.",
    comfyStoppedTitle: "ComfyUI is not running",
    comfyStoppedText: "Start it to open the interface here. The first launch takes longer.",
    comfyStoppedPrimary: "Start ComfyUI",
    comfyStoppedSecondary: "Manage",
    comfyStoppedHint: "Starting ComfyUI will stop the currently running model.",
    comfyBackApps: "Apps",
    comfyLog: "Log",
    comfyManage: "Manage",
    comfyOpenBrowser: "Open in browser",
    comfyStop: "Stop",
    comfyStart: "Start",
    comfyRestart: "Restart",
    comfyManagerHintPrefix: "The “Manager” button is part of ComfyUI. LemonAI installs it automatically and launches with",
    comfyManagerHintSuffix: "Use it to add nodes and models.",
    comfyDismissHint: "Got it",
    comfyPanelAria: "ComfyUI interface",
    comfyBrowserFallback: "The ComfyUI interface opens here in LemonAI. In browser preview, use “Open in browser”.",
    comfyStartingTitle: "Starting ComfyUI…",
    comfyStartingDesc: "Waiting for the server to respond. The first launch takes longer. Once ready, ComfyUI will open here.",
    comfyLogAria: "ComfyUI log",
    comfyLogEmpty: "No entries.",
  },
};

const STORAGE_KEY = "lemon_app_lang";

let globalLang: Language = (typeof window !== "undefined" && (window.localStorage.getItem(STORAGE_KEY) as Language)) || "pl";
const listeners = new Set<(lang: Language) => void>();

export function getLanguage(): Language {
  return globalLang;
}

export function setLanguage(lang: Language) {
  globalLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Ignore storage errors
  }
  listeners.forEach((listener) => listener(lang));
}

export function t(key: keyof Translations): string {
  return DICTIONARY[globalLang][key] || DICTIONARY.pl[key] || String(key);
}

export function useI18n() {
  const [lang, setLangState] = useState<Language>(() => getLanguage());

  useEffect(() => {
    const handler = (newLang: Language) => {
      setLangState(newLang);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const changeLanguage = useCallback((newLang: Language) => {
    setLanguage(newLang);
  }, []);

  return {
    lang,
    setLanguage: changeLanguage,
    t: (key: keyof Translations) => DICTIONARY[lang][key] || DICTIONARY.pl[key] || String(key),
    dict: DICTIONARY[lang],
  };
}

export function fmt(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}
