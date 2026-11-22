import { z } from "zod";
import type { ModelPackageManifest } from "@/types/manifest";
import { BUNDLED_MANIFESTS } from "@/lib/catalog";
import {
  isTauri,
  apiHubGetRefreshToken,
  apiHubSetRefreshToken,
  apiHubClearRefreshToken,
} from "@/lib/ipc";

export interface HubUser {
  id: string;
  username: string;
  email: string;
  role?: string;
  avatar_url?: string | null;
  two_factor_enabled?: boolean;

  notify_email?: boolean;
  created_at?: string | null;
}

export type ScriptStatus = "published" | "pending" | "rejected";

export interface StandardIssue {
  code: string;
  level: "error" | "warning";
  message: string;
}

export interface HubScript {
  id: string;
  slug: string;
  name: string;
  description: string;
  author?: string;
  is_curated: boolean;
  category: "llm" | "image" | "audio" | "code" | "other" | string;
  engine: "python_uv" | "standalone_binary";
  preview_image_url?: string | null;
  min_vram_gb: number;
  min_ram_gb: number;
  manifest: ModelPackageManifest;

  is_adult?: boolean;
  downloads_count?: number;
  installs_count?: number;
  created_at?: string | null;
  updated_at?: string | null;

  status?: ScriptStatus;

  rating?: number | null;
  rating_count?: number;

  moderation_note?: string | null;
  moderated_at?: string | null;
  standards?: StandardIssue[];
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  user: HubUser;
}

export class HubApiError extends Error {
  readonly kind: "network" | "http" | "format";
  readonly status?: number;
  readonly details: string[];

  readonly code?: string;

  constructor(
    kind: "network" | "http" | "format",
    message: string,
    options: { status?: number; details?: string[]; code?: string } = {}
  ) {
    super(message);
    this.name = "HubApiError";
    this.kind = kind;
    this.status = options.status;
    this.details = options.details ?? [];
    this.code = options.code;
  }
}

interface ImportMetaWithEnv {
  env?: Record<string, string | undefined>;
}

export const API_BASE_URL = (
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as ImportMetaWithEnv).env?.VITE_HUB_API_URL) ||
  "http://127.0.0.1:5000"
).replace(/\/+$/, "");

const REFRESH_TOKEN_KEY = "lemonai-refresh-token";
const LEGACY_KEYS = ["lemonai-access-token", "lemonai-user"];

let accessToken: string | null = null;
let currentUser: HubUser | null = null;
let cachedRefreshToken: string | null = null;

type AuthStateListener = (user: HubUser | null) => void;
const authStateListeners = new Set<AuthStateListener>();

function notifyAuthStateListeners(): void {
  for (const listener of authStateListeners) {
    try {
      listener(currentUser);
    } catch {
      // Listener errors must never break auth state transitions.
    }
  }
}

export function onAuthStateChange(listener: AuthStateListener): () => void {
  authStateListeners.add(listener);
  return () => {
    authStateListeners.delete(listener);
  };
}

function readLocalStorageRefreshToken(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearLocalStorageTokens(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // Storage unavailable.
  }
}

async function loadRefreshToken(): Promise<string | null> {
  if (isTauri()) {
    if (cachedRefreshToken) return cachedRefreshToken;
    let stored: string | null = null;
    try {
      stored = await apiHubGetRefreshToken();
    } catch {
      stored = null;
    }
    const legacy = readLocalStorageRefreshToken();
    if (!stored && legacy) {
      stored = legacy;
      try {
        await apiHubSetRefreshToken(legacy);
      } catch {
        // Keep in memory for this session even if persistence fails.
      }
    }
    clearLocalStorageTokens();
    cachedRefreshToken = stored;
    return stored;
  }
  return readLocalStorageRefreshToken();
}

function writeRefreshToken(token: string | null): void {
  cachedRefreshToken = token;
  if (isTauri()) {
    clearLocalStorageTokens();
    if (token) {
      void apiHubSetRefreshToken(token).catch(() => undefined);
    } else {
      void apiHubClearRefreshToken().catch(() => undefined);
    }
    return;
  }
  try {
    if (typeof localStorage === "undefined") return;
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode, quota): the session just won't survive a restart.
  }
}

export function getAuthToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  if (isTauri()) return cachedRefreshToken;
  return readLocalStorageRefreshToken();
}

export function getCurrentUser(): HubUser | null {
  return currentUser;
}

export function setSession(access: string, refresh: string | undefined, user: HubUser): void {
  accessToken = access;
  currentUser = user;
  if (refresh) writeRefreshToken(refresh);
  notifyAuthStateListeners();
}

export function clearAuthTokens(): void {
  accessToken = null;
  currentUser = null;
  writeRefreshToken(null);
  notifyAuthStateListeners();
}

async function readError(res: Response, fallback: string): Promise<HubApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const message =
    [record.error, record.msg, record.message].find((v) => typeof v === "string" && v) ?? fallback;
  const details = Array.isArray(record.details)
    ? record.details.filter((d): d is string => typeof d === "string")
    : [];
  const code = typeof record.code === "string" ? record.code : undefined;
  if (code === "account_banned") {
    const reason = typeof record.reason === "string" && record.reason ? ` Powód: ${record.reason}` : "";
    return new HubApiError("http", `To konto zostało zablokowane przez moderatora.${reason}`, {
      status: res.status,
      details,
      code,
    });
  }
  return new HubApiError("http", message as string, { status: res.status, details, code });
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init);
  } catch (err) {
    throw new HubApiError(
      "network",
      `LemonAI Hub is unreachable at ${API_BASE_URL} (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

let refreshInFlight: Promise<boolean> | null = null;

export async function apiRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refresh = await loadRefreshToken();
      if (!refresh) return false;
      const res = await request("/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${refresh}` },
      });
      if (res.status === 401 || res.status === 422) {
        clearAuthTokens(); 
        return false;
      }
      if (!res.ok) throw await readError(res, "Could not refresh the session");
      const data = (await res.json()) as { access_token?: string; refresh_token?: string };
      if (!data.access_token) return false;
      accessToken = data.access_token;

      if (data.refresh_token) writeRefreshToken(data.refresh_token);
      return true;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!accessToken && !(await apiRefresh())) {
    throw new HubApiError("http", "You must be signed in to do that", { status: 401 });
  }
  const send = () =>
    request(path, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${accessToken}` },
    });
  const usedToken = accessToken;
  let res = await send();
  if (res.status === 401) {
    if (accessToken && accessToken !== usedToken) {
      res = await send();
    } else if (await apiRefresh()) {
      res = await send();
    }
  }
  if (res.status === 401) {
    clearAuthTokens();
    throw new HubApiError("http", "Your session has expired, please sign in again", { status: 401 });
  }
  if (res.status === 403 && typeof res.clone === "function") {

    const error = await readError(res.clone(), "Forbidden");
    if (error.code === "account_banned") {
      clearAuthTokens();
      throw error;
    }
  }
  return res;
}

async function authenticate(path: string, payload: object, fallback: string): Promise<AuthResponse> {
  const res = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, fallback);
  const data = (await res.json()) as AuthResponse;
  setSession(data.access_token, data.refresh_token, data.user);
  return data;
}

export type LoginResult = AuthResponse | { two_factor_required: true; ticket: string };

export async function apiLogin(login: string, password: string): Promise<LoginResult> {
  const res = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  if (!res.ok) throw await readError(res, "Invalid credentials");
  const data = (await res.json()) as { two_factor_required?: boolean; ticket?: string } & Partial<AuthResponse>;
  if (data.two_factor_required && data.ticket) {
    return { two_factor_required: true, ticket: data.ticket };
  }
  const auth = data as AuthResponse;
  setSession(auth.access_token, auth.refresh_token, auth.user);
  return auth;
}

export interface TwoFactorSetupResponse {
  secret: string;
  otpauth_url: string;
  qr_code_svg: string;
}

export interface TwoFactorEnableResponse {
  backup_codes: string[];
}

export interface DemoAccount {
  username: string;
  label: string;
  role: string;
  password: string;
}

export async function apiSetup2FA(): Promise<TwoFactorSetupResponse> {
  const res = await authFetch("/api/auth/2fa/setup", { method: "POST" });
  if (!res.ok) throw await readError(res, "Failed to initialize 2FA setup");
  return (await res.json()) as TwoFactorSetupResponse;
}

export async function apiEnable2FA(code: string, password: string): Promise<TwoFactorEnableResponse> {
  const res = await authFetch("/api/auth/2fa/enable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, password }),
  });
  if (!res.ok) throw await readError(res, "Failed to enable 2FA");
  return (await res.json()) as TwoFactorEnableResponse;
}

export async function apiDisable2FA(password: string): Promise<{ message: string }> {
  const res = await authFetch("/api/auth/2fa/disable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw await readError(res, "Failed to disable 2FA");
  return (await res.json()) as { message: string };
}

export async function apiVerify2FA(ticket: string, code: string): Promise<AuthResponse> {
  const res = await request("/api/auth/2fa/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, code }),
  });
  if (!res.ok) throw await readError(res, "Failed to verify 2FA code");
  const data = (await res.json()) as AuthResponse;
  setSession(data.access_token, data.refresh_token, data.user);
  return data;
}

export async function apiUpdateProfile(payload: {
  username?: string;
  email?: string;
  avatar_url?: string;
  notify_email?: boolean;
}): Promise<HubUser> {
  const res = await authFetch("/api/auth/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, "Failed to update profile");
  const data = (await res.json()) as { user: HubUser };
  currentUser = data.user;
  notifyAuthStateListeners();
  return data.user;
}

export async function apiChangePassword(payload: { old_password: string; new_password: string }): Promise<{ message: string }> {
  const res = await authFetch("/api/auth/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, "Failed to change password");
  const data = (await res.json()) as { message: string };
  clearAuthTokens();
  return data;
}

export async function apiRevokeAllSessions(): Promise<{ message: string }> {
  const res = await authFetch("/api/auth/sessions/revoke-all", { method: "POST" });
  if (!res.ok) throw await readError(res, "Failed to revoke sessions");
  clearAuthTokens();
  return (await res.json()) as { message: string };
}

export async function apiDeleteAccount(password: string): Promise<{ message: string }> {
  const res = await authFetch("/api/auth/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw await readError(res, "Failed to delete account");
  clearAuthTokens();
  return (await res.json()) as { message: string };
}

export async function apiGetMyScripts(): Promise<HubScript[]> {
  const res = await authFetch("/api/scripts/mine");
  if (!res.ok) throw await readError(res, "Failed to fetch user scripts");
  const data = (await res.json()) as { scripts: HubScript[] };
  return (data.scripts || []).map((s) => ({
    ...s,
    preview_image_url: resolvePreview(s.preview_image_url),
  }));
}

export async function apiUpdateScript(slugOrId: string, formData: FormData): Promise<HubScript> {
  const res = await authFetch(`/api/scripts/${encodeURIComponent(slugOrId)}`, { method: "PUT", body: formData });
  if (!res.ok) throw await readError(res, "Failed to update script");
  const data = (await res.json()) as { script: HubScript };
  return { ...data.script, preview_image_url: resolvePreview(data.script.preview_image_url) };
}

export async function apiDeleteScript(slugOrId: string): Promise<{ message: string }> {
  const res = await authFetch(`/api/scripts/${encodeURIComponent(slugOrId)}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res, "Failed to delete script");
  return (await res.json()) as { message: string };
}

export async function apiGetDemoAccounts(): Promise<DemoAccount[]> {
  const res = await request("/api/auth/demo-accounts");
  if (!res.ok) return [];
  const data = (await res.json()) as { demo_accounts: DemoAccount[] };
  return data.demo_accounts || [];
}

export function apiRegister(username: string, email: string, password: string): Promise<AuthResponse> {
  return authenticate("/api/auth/register", { username, email, password }, "Registration failed");
}

export async function apiLogout(): Promise<void> {
  const refresh = await loadRefreshToken();
  clearAuthTokens();
  if (!refresh) return;
  try {
    await request("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${refresh}` },
    });
  } catch {
    // Offline: the token simply expires on its own.
  }
}

export async function apiGetMe(): Promise<HubUser> {
  const res = await authFetch("/api/auth/me");
  if (!res.ok) throw await readError(res, "Could not load the account");
  const data = (await res.json()) as { user: HubUser };
  currentUser = data.user;
  notifyAuthStateListeners();
  return data.user;
}

export async function restoreSession(): Promise<HubUser | null> {
  if (!(await loadRefreshToken())) return null;
  try {
    if (!(await apiRefresh())) return null;
    return await apiGetMe();
  } catch (err) {
    if (err instanceof HubApiError && err.kind === "http") clearAuthTokens();
    return null;
  }
}

const scriptSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    author: z.string().optional(),
    is_curated: z.boolean().default(false),
    category: z.string().default("other"),
    engine: z.enum(["python_uv", "standalone_binary"]),
    preview_image_url: z.string().nullable().optional(),
    min_vram_gb: z.number().default(0),
    min_ram_gb: z.number().default(0),
    manifest: z.object({ id: z.string().min(1) }).passthrough(),
    downloads_count: z.number().optional(),
    installs_count: z.number().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough();

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const HUB_ORIGIN = originOf(API_BASE_URL);

function resolvePreview(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return `${API_BASE_URL}${url}`;
  if (!/^https?:\/\//i.test(url)) return null;
  return HUB_ORIGIN !== null && originOf(url) === HUB_ORIGIN ? url : null;
}

const HUB_PAGE_SIZE = 100;
const HUB_MAX_PAGES = 50;

export async function apiGetScripts(params?: {
  curated?: boolean;
  category?: string;
  search?: string;

  adult?: boolean;
}): Promise<HubScript[]> {
  const query = new URLSearchParams();
  if (params?.adult) query.set("adult", "true");
  if (params?.curated !== undefined) query.set("curated", String(params.curated));
  if (params?.category) query.set("category", params.category);
  if (params?.search) query.set("search", params.search);

  const list: unknown[] = [];
  for (let page = 1; page <= HUB_MAX_PAGES; page++) {
    query.set("page", String(page));
    query.set("per_page", String(HUB_PAGE_SIZE));
    const res = await request(`/api/scripts?${query.toString()}`);
    if (!res.ok) throw await readError(res, `The Hub answered HTTP ${res.status}`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new HubApiError("format", "The Hub returned a response that is not valid JSON");
    }
    const items = (body as { scripts?: unknown } | null)?.scripts;
    if (!Array.isArray(items)) {
      throw new HubApiError("format", "The Hub returned an unexpected catalogue format");
    }
    list.push(...items);
    const pages = Number((body as { pages?: unknown }).pages);
    if (!Number.isFinite(pages) || page >= pages || items.length === 0) break;
  }
  const scripts: HubScript[] = [];
  for (const item of list) {
    const parsed = scriptSchema.safeParse(item);
    if (parsed.success) {
      const script = parsed.data as unknown as HubScript;
      scripts.push({ ...script, preview_image_url: resolvePreview(script.preview_image_url) });
    }
  }
  if (list.length > 0 && scripts.length === 0) {
    throw new HubApiError("format", "None of the catalogue entries could be understood");
  }
  return scripts;
}

export async function apiUploadScript(formData: FormData): Promise<HubScript> {
  const res = await authFetch("/api/scripts", { method: "POST", body: formData });
  if (!res.ok) throw await readError(res, "Could not publish the model");
  const data = (await res.json()) as { script: HubScript };
  return { ...data.script, preview_image_url: resolvePreview(data.script.preview_image_url) };
}

export async function apiRecordScriptInstall(slugOrId: string): Promise<void> {
  if (!slugOrId.trim()) return;
  if (!accessToken && !(await loadRefreshToken())) return;
  try {
    await authFetch(`/api/scripts/${encodeURIComponent(slugOrId)}/install`, {
      method: "POST",
    });
  } catch {
    // Best-effort telemetry: never fail an already-completed local install.
  }
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function makeSvgBanner(title: string, subtitle: string, colorStart: string, colorEnd: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${colorStart}"/><stop offset="100%" stop-color="${colorEnd}"/>
  </linearGradient></defs>
  <rect width="800" height="400" rx="24" fill="url(#g)"/>
  <circle cx="700" cy="80" r="140" fill="#fff" fill-opacity="0.06"/>
  <text x="56" y="215" font-family="system-ui, sans-serif" font-size="44" font-weight="800" fill="#fff">${escapeXml(title)}</text>
  <text x="56" y="262" font-family="system-ui, sans-serif" font-size="20" fill="#e2e8f0">${escapeXml(subtitle.length > 48 ? `${subtitle.slice(0, 47)}…` : subtitle)}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const CATEGORY_COLORS: Record<string, [string, string]> = {
  llm: ["#3b82f6", "#1d4ed8"],
  code: ["#10b981", "#047857"],
  image: ["#8b5cf6", "#6d28d9"],
  audio: ["#f59e0b", "#b45309"],
};

export function offlineCatalog(options?: { adult?: boolean }): HubScript[] {
  const adult = options?.adult ?? false;
  return BUNDLED_MANIFESTS.filter((m) => adult || m.content_rating !== "adult").map((manifest) => {
    const category = manifest.category ?? "other";
    const [from, to] = CATEGORY_COLORS[category] ?? ["#64748b", "#334155"];
    return {
      id: manifest.id,
      slug: manifest.id,
      name: manifest.name,
      description: manifest.description ?? "",
      author: manifest.author ?? "LemonAI Official",
      is_curated: true,
      category,
      engine: manifest.engine,
      preview_image_url: makeSvgBanner(manifest.name, manifest.description ?? "", from, to),
      min_vram_gb: manifest.hardware_requirements.min_vram_gb,
      min_ram_gb: manifest.hardware_requirements.min_ram_gb,
      manifest,
      is_adult: manifest.content_rating === "adult",
    };
  });
}

export type ReportReason = "malicious" | "broken" | "misleading" | "license" | "spam" | "other";

export async function apiReportScript(slugOrId: string, reason: ReportReason, details: string): Promise<void> {
  const res = await authFetch(`/api/scripts/${encodeURIComponent(slugOrId)}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason, details: details.trim() || null }),
  });
  if (!res.ok) throw await readError(res, "Could not send the report");
}

export async function apiCheckStandards(payload: {
  name: string;
  description: string;
  manifest: ModelPackageManifest;
  has_preview_image: boolean;
}): Promise<{ standards: StandardIssue[]; will_need_review: boolean }> {
  const res = await authFetch("/api/scripts/standards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, "Could not check the entry");
  return (await res.json()) as { standards: StandardIssue[]; will_need_review: boolean };
}

export interface Paged {
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface ModerationAction {
  id: string;
  actor: string | null;
  action: string;
  target_type: "script" | "user" | "report" | string;
  target_id: string;
  target_label: string;
  reason: string | null;
  created_at: string | null;
}

export interface AdminOverview {
  users: number;
  banned_users: number;
  scripts: Record<ScriptStatus, number>;
  open_reports: number;
  recent_actions: ModerationAction[];
}

export interface AdminScript extends HubScript {
  open_reports: number;
  author_role: string | null;
  author_banned: boolean;
}

export interface HubReport {
  id: string;
  script: { id: string; slug: string; name: string; status: ScriptStatus; author: string | null } | null;
  reporter: string | null;
  reason: ReportReason | string;
  details: string | null;
  status: "open" | "resolved" | "dismissed";
  created_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface AdminUser extends HubUser {
  banned_at: string | null;
  ban_reason: string | null;
  scripts_count: number;
}

async function adminJson<T>(path: string, init: RequestInit = {}, fallback = "The Hub refused the request"): Promise<T> {
  const headers = init.body ? { "Content-Type": "application/json" } : undefined;
  const res = await authFetch(`/api/admin${path}`, { ...init, headers });
  if (!res.ok) throw await readError(res, fallback);
  return (await res.json()) as T;
}

function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function apiAdminOverview(): Promise<AdminOverview> {
  return adminJson<AdminOverview>("/overview");
}

export async function apiAdminScripts(params: {
  status?: ScriptStatus | "";
  search?: string;
  reported?: boolean;
  page?: number;
}): Promise<Paged & { scripts: AdminScript[] }> {
  const data = await adminJson<Paged & { scripts: AdminScript[] }>(
    `/scripts${queryString({ status: params.status, search: params.search, reported: params.reported || undefined, page: params.page })}`
  );
  return { ...data, scripts: data.scripts.map((s) => ({ ...s, preview_image_url: resolvePreview(s.preview_image_url) })) };
}

export function apiAdminModerate(
  slugOrId: string,
  action: "approve" | "reject" | "delete",
  reason: string,

  note = ""
): Promise<{ script?: HubScript; deleted?: boolean; reports_closed?: number }> {
  return adminJson(`/scripts/${encodeURIComponent(slugOrId)}/moderate`, {
    method: "POST",
    body: JSON.stringify({ action, reason: reason.trim() || null, note: note.trim() || null }),
  });
}

export function apiAdminReports(status: "open" | "resolved" | "dismissed" | "all" = "open", page = 1): Promise<Paged & { reports: HubReport[] }> {
  return adminJson(`/reports${queryString({ status, page })}`);
}

export function apiAdminResolveReport(id: string, action: "resolve" | "dismiss", note: string): Promise<{ report: HubReport }> {
  return adminJson(`/reports/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action, note: note.trim() || null }),
  });
}

export function apiAdminUsers(params: { search?: string; banned?: boolean; page?: number }): Promise<Paged & { users: AdminUser[] }> {
  return adminJson(`/users${queryString({ search: params.search, banned: params.banned, page: params.page })}`);
}

export function apiAdminBan(userId: string, reason: string, rejectScripts: boolean): Promise<{ user: AdminUser; scripts_rejected: number }> {
  return adminJson(`/users/${encodeURIComponent(userId)}/ban`, {
    method: "POST",
    body: JSON.stringify({ reason, reject_scripts: rejectScripts }),
  });
}

export function apiAdminUnban(userId: string): Promise<{ user: AdminUser }> {
  return adminJson(`/users/${encodeURIComponent(userId)}/unban`, { method: "POST" });
}

export function apiAdminSetRole(userId: string, role: "user" | "admin"): Promise<{ user: AdminUser }> {
  return adminJson(`/users/${encodeURIComponent(userId)}/role`, { method: "PUT", body: JSON.stringify({ role }) });
}

export function apiAdminActions(page = 1): Promise<Paged & { actions: ModerationAction[] }> {
  return adminJson(`/actions${queryString({ page })}`);
}

export async function apiSetCuration(slugOrId: string, curated: boolean): Promise<HubScript> {
  const res = await authFetch(`/api/scripts/${encodeURIComponent(slugOrId)}/curation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ curated }),
  });
  if (!res.ok) throw await readError(res, "Could not change the recommendation");
  return ((await res.json()) as { script: HubScript }).script;
}

export async function apiRequestPasswordReset(login: string): Promise<void> {
  const res = await request("/api/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login }),
  });
  if (!res.ok) throw await readError(res, "Could not request a reset code");
}

export async function apiConfirmPasswordReset(login: string, code: string, newPassword: string): Promise<void> {
  const res = await request("/api/auth/password-reset/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, code, new_password: newPassword }),
  });
  if (!res.ok) throw await readError(res, "Could not set the new password");
}

export interface HubNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  script_id: string | null;
  script_slug: string | null;
  created_at: string | null;
  read: boolean;
}

export async function apiNotifications(): Promise<{ notifications: HubNotification[]; unread: number }> {
  const res = await authFetch("/api/notifications");
  if (!res.ok) throw await readError(res, "Could not load notifications");
  return (await res.json()) as { notifications: HubNotification[]; unread: number };
}

export async function apiMarkNotificationsRead(ids: string[] | "all"): Promise<void> {
  const res = await authFetch("/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
  });
  if (!res.ok) throw await readError(res, "Could not update notifications");
}

export interface ScriptMessage {
  id: string;
  author: string | null;
  from_moderator: boolean;
  body: string;
  created_at: string | null;
}

export async function apiScriptMessages(
  slugOrId: string
): Promise<{ messages: ScriptMessage[]; status: ScriptStatus; moderation_note: string | null }> {
  const res = await authFetch(`/api/scripts/${encodeURIComponent(slugOrId)}/messages`);
  if (!res.ok) throw await readError(res, "Could not load the messages");
  return (await res.json()) as { messages: ScriptMessage[]; status: ScriptStatus; moderation_note: string | null };
}

export async function apiPostScriptMessage(
  slugOrId: string,
  body: string,
  requestReview = false
): Promise<{ message: ScriptMessage; status: ScriptStatus }> {
  const res = await authFetch(`/api/scripts/${encodeURIComponent(slugOrId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, request_review: requestReview }),
  });
  if (!res.ok) throw await readError(res, "Could not send the message");
  return (await res.json()) as { message: ScriptMessage; status: ScriptStatus };
}

export interface MessageThread {
  script: { id: string; slug: string; name: string; status: ScriptStatus; author: string | null };
  last_message: ScriptMessage;
  messages: number;
}

export function apiAdminThreads(waiting = true): Promise<{ threads: MessageThread[]; total?: number }> {
  return adminJson(`/messages${queryString({ waiting })}`);
}

export function apiAdminResetCode(userId: string): Promise<{ code: string; username: string }> {
  return adminJson(`/users/${encodeURIComponent(userId)}/reset-code`, { method: "POST" });
}

export async function apiRateScript(
  slugOrId: string,
  stars: number | null
): Promise<{ rating: number | null; rating_count: number; mine: number | null }> {
  const res = await authFetch(`/api/scripts/${encodeURIComponent(slugOrId)}/rating`, {
    method: stars === null ? "DELETE" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: stars === null ? undefined : JSON.stringify({ stars }),
  });
  if (!res.ok) throw await readError(res, "Could not save the rating");
  return (await res.json()) as { rating: number | null; rating_count: number; mine: number | null };
}

export async function apiMyRatings(): Promise<Record<string, number>> {
  const res = await authFetch("/api/ratings/mine");
  if (!res.ok) throw await readError(res, "Could not load your ratings");
  return ((await res.json()) as { ratings: Record<string, number> }).ratings;
}

export interface AppRelease {
  id: string;
  version: string;
  target: string;
  url: string;
  signature: string;
  notes: string | null;
  created_at: string | null;
}

async function releasesJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = init.body ? { "Content-Type": "application/json" } : undefined;
  const res = await authFetch(`/api/admin/releases${path}`, { ...init, headers });
  if (!res.ok) throw await readError(res, "The Hub refused the request");
  return (await res.json()) as T;
}

export function apiAdminReleases(): Promise<{ releases: AppRelease[]; targets: string[] }> {
  return releasesJson("");
}

export function apiAdminPublishRelease(release: {
  version: string;
  target: string;
  url: string;
  signature: string;
  notes: string;
}): Promise<{ release: AppRelease }> {
  return releasesJson("", { method: "POST", body: JSON.stringify(release) });
}

export function apiAdminWithdrawRelease(id: string): Promise<{ deleted: boolean }> {
  return releasesJson(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}
