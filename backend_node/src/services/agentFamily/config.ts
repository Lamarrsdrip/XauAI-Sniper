import { getDb } from "../../db.js";
import { cloudEncrypt, cloudDecrypt } from "../cloudCrypto.js";
import { TermixClient } from "./termix.js";

const COLLECTION = "agent_family_configuration";
const KEY = "main";
const DEFAULT_BASE = "https://platform-backend.prod.termix.live";

export interface AgentFamilyConfig {
  enabled: boolean;
  publishEnabled: boolean;
  agentId: string;
  coverUrl: string;
  accessToken: string;
  refreshToken: string;
  baseUrl: string;
  updatedAt: string | null;
}

export interface AgentFamilyConfigPatch {
  enabled?: boolean;
  publishEnabled?: boolean;
  agentId?: string;
  coverUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  clearAccessToken?: boolean;
  clearRefreshToken?: boolean;
}

type Stored = Record<string, unknown>;

function stringValue(x: unknown): string { return typeof x === "string" ? x.trim() : ""; }
function tokenFromStored(stored: Stored | null, field: string, fallback: string): string {
  if (!stored || !Object.prototype.hasOwnProperty.call(stored, field)) return fallback.trim();
  const value = stored[field];
  if (!value) return "";
  if (typeof value !== "string") throw new Error("Invalid encrypted Agent.family credential record");
  return cloudDecrypt(value);
}

/** The admin-managed record overrides legacy env settings, so saves take effect without redeploy. */
export function resolveAgentFamilyConfig(stored: Stored | null, vars: NodeJS.ProcessEnv = process.env): AgentFamilyConfig {
  return {
    enabled: typeof stored?.["enabled"] === "boolean" ? stored["enabled"] : vars["XAUCLOUD_AGENT_FAMILY_ENABLED"] === "true",
    publishEnabled: typeof stored?.["publishEnabled"] === "boolean" ? stored["publishEnabled"] : vars["XAUCLOUD_AGENT_FAMILY_PUBLISH"] === "true",
    agentId: stringValue(stored?.["agentId"] ?? vars["TERMIX_AGENT_ID"]),
    coverUrl: stringValue(stored?.["coverUrl"] ?? vars["XAUCLOUD_AGENT_FAMILY_COVER_URL"]),
    accessToken: tokenFromStored(stored, "accessTokenEncrypted", vars["TERMIX_ACCESS_TOKEN"] || ""),
    refreshToken: tokenFromStored(stored, "refreshTokenEncrypted", vars["TERMIX_REFRESH_TOKEN"] || ""),
    baseUrl: stringValue(vars["TERMIX_API_BASE"]) || DEFAULT_BASE,
    updatedAt: stringValue(stored?.["updatedAt"]) || null,
  };
}

export function publicAgentFamilyConfig(config: AgentFamilyConfig) {
  return {
    enabled: config.enabled,
    publishEnabled: config.publishEnabled,
    agentId: config.agentId,
    coverUrl: config.coverUrl,
    accessTokenConfigured: config.accessToken.length > 0,
    refreshTokenConfigured: config.refreshToken.length > 0,
    updatedAt: config.updatedAt,
    connectionReady: Boolean(config.agentId && config.accessToken),
    safeToPublish: Boolean(config.enabled && config.publishEnabled && config.agentId &&
      config.accessToken && isValidCoverUrl(config.coverUrl)),
    baseHost: new URL(config.baseUrl).hostname,
    signing: "Wallet actions require owner authorization outside the server.",
  };
}

function isValidCoverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export async function getAgentFamilyConfig(): Promise<AgentFamilyConfig> {
  const stored = await getDb().collection(COLLECTION).findOne({ key: KEY }, { projection: { _id: 0 } });
  return resolveAgentFamilyConfig(stored);
}

export async function saveAgentFamilyConfig(patch: AgentFamilyConfigPatch): Promise<AgentFamilyConfig> {
  if (patch.enabled === undefined && patch.publishEnabled === undefined && patch.agentId === undefined &&
      patch.coverUrl === undefined && patch.accessToken === undefined && patch.refreshToken === undefined &&
      !patch.clearAccessToken && !patch.clearRefreshToken) {
    return getAgentFamilyConfig();
  }
  const updates: Stored = { updatedAt: new Date().toISOString() };
  if (patch.enabled !== undefined) updates["enabled"] = patch.enabled;
  if (patch.publishEnabled !== undefined) updates["publishEnabled"] = patch.publishEnabled;
  if (patch.agentId !== undefined) updates["agentId"] = patch.agentId.trim();
  if (patch.coverUrl !== undefined) {
    if (patch.coverUrl.trim() && !isValidCoverUrl(patch.coverUrl.trim())) throw new Error("Cover image URL must be an HTTPS URL without embedded credentials");
    updates["coverUrl"] = patch.coverUrl.trim();
  }
  if (patch.accessToken !== undefined) {
    if (patch.accessToken.length < 20) throw new Error("Access token is too short");
    updates["accessTokenEncrypted"] = cloudEncrypt(patch.accessToken.trim());
  }
  if (patch.refreshToken !== undefined) {
    if (patch.refreshToken.length < 20) throw new Error("Refresh token is too short");
    updates["refreshTokenEncrypted"] = cloudEncrypt(patch.refreshToken.trim());
  }
  if (patch.clearAccessToken) updates["accessTokenEncrypted"] = "";
  if (patch.clearRefreshToken) updates["refreshTokenEncrypted"] = "";

  const old = await getAgentFamilyConfig();
  const future: AgentFamilyConfig = {
    ...old,
    enabled: patch.enabled ?? old.enabled,
    publishEnabled: patch.publishEnabled ?? old.publishEnabled,
    agentId: patch.agentId === undefined ? old.agentId : patch.agentId.trim(),
    coverUrl: patch.coverUrl === undefined ? old.coverUrl : patch.coverUrl.trim(),
    accessToken: patch.clearAccessToken ? "" : patch.accessToken ?? old.accessToken,
    refreshToken: patch.clearRefreshToken ? "" : patch.refreshToken ?? old.refreshToken,
  };
  if (future.enabled && (!future.agentId || !future.accessToken)) {
    throw new Error("Set Agent.family agent ID and access token before enabling");
  }
  if (future.publishEnabled && (!future.enabled || !isValidCoverUrl(future.coverUrl))) {
    throw new Error("Publishing requires enabled integration and a valid HTTPS cover URL");
  }
  const collection = getDb().collection(COLLECTION);
  await collection.updateOne({ key: KEY }, { $set: updates, $setOnInsert: { key: KEY } }, { upsert: true });
  return getAgentFamilyConfig();
}

export function createAgentFamilyClient(config: AgentFamilyConfig, fetchImpl?: typeof fetch): TermixClient | null {
  if (!config.enabled || !config.accessToken || !config.agentId) return null;
  return new TermixClient({
    baseUrl: config.baseUrl,
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    fetchImpl,
    allowLoopback: process.env["ENVIRONMENT"] === "test",
  });
}
