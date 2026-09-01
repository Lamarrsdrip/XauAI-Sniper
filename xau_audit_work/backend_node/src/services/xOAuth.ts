import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { cloudDecrypt, cloudEncrypt } from "./cloudCrypto.js";

export const X_OAUTH_SCOPES = "tweet.read tweet.write users.read offline.access";
const X_CREDENTIAL_ID = "official-account";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function buildXAuthorizationUrl(input: { clientId: string; state: string; codeChallenge: string }): string {
  if (!input.clientId) throw new Error("X OAuth client ID is not configured.");
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", env.X_OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", X_OAUTH_SCOPES);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function xOAuthClientConfigured(): boolean { return Boolean(env.X_OAUTH_CLIENT_ID && env.X_OAUTH_CLIENT_SECRET); }

export async function startXOAuthConnection(adminId: string): Promise<string> {
  if (!xOAuthClientConfigured()) throw Object.assign(new Error("X OAuth Client ID and Client Secret must be configured on the server."), { statusCode: 503 });
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  await getDb().collection("x_oauth_states").insertOne({
    state_hash: hash(state), verifier_enc: cloudEncrypt(verifier), admin_id: adminId,
    created_at: new Date(), expires_at: new Date(Date.now() + 10 * 60_000), used_at: null,
  });
  return buildXAuthorizationUrl({ clientId: env.X_OAUTH_CLIENT_ID, state, codeChallenge: pkceChallenge(verifier) });
}

async function tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.X_OAUTH_CLIENT_ID}:${env.X_OAUTH_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error("X authorization could not be completed."), { statusCode: 502 });
  return payload;
}

async function writeCredentials(payload: Record<string, unknown>, existingRefreshToken?: string): Promise<void> {
  const accessToken = String(payload["access_token"] ?? "");
  const refreshToken = String(payload["refresh_token"] ?? existingRefreshToken ?? "");
  const expiresIn = Number(payload["expires_in"] ?? 0);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw Object.assign(new Error("X did not return renewable user credentials."), { statusCode: 502 });
  const me = await fetch("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  const mePayload = await me.json().catch(() => ({})) as Record<string, unknown>;
  if (!me.ok) throw Object.assign(new Error("X publishing-account identity could not be verified."), { statusCode: 502 });
  const user = mePayload["data"] as Record<string, unknown> | undefined;
  await getDb().collection("x_posting_credentials").updateOne(
    { id: X_CREDENTIAL_ID },
    { $set: { id: X_CREDENTIAL_ID, access_token_enc: cloudEncrypt(accessToken), refresh_token_enc: cloudEncrypt(refreshToken), expires_at: new Date(Date.now() + expiresIn * 1000), account_username: String(user?.["username"] ?? "") || null, account_id: String(user?.["id"] ?? "") || null, connected_at: new Date(), updated_at: new Date() } },
    { upsert: true },
  );
}

export async function completeXOAuthConnection(input: { state: string; code: string }): Promise<void> {
  const states = getDb().collection("x_oauth_states");
  const row = await states.findOneAndUpdate({ state_hash: hash(input.state), used_at: null, expires_at: { $gt: new Date() } }, { $set: { used_at: new Date() } }, { returnDocument: "before" });
  if (!row) throw Object.assign(new Error("X authorization link is invalid or expired."), { statusCode: 400 });
  const verifier = cloudDecrypt(String(row["verifier_enc"]));
  const payload = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: env.X_OAUTH_REDIRECT_URI, client_id: env.X_OAUTH_CLIENT_ID, code_verifier: verifier }));
  await writeCredentials(payload);
}

export async function xOAuthConnection(): Promise<Record<string, unknown> | null> {
  const row = await getDb().collection("x_posting_credentials").findOne({ id: X_CREDENTIAL_ID }, { projection: { _id: 0, access_token_enc: 0, refresh_token_enc: 0 } });
  return row ?? null;
}

export async function xUserAccessToken(): Promise<string | null> {
  if (env.X_USER_ACCESS_TOKEN) return env.X_USER_ACCESS_TOKEN;
  const row = await getDb().collection("x_posting_credentials").findOne({ id: X_CREDENTIAL_ID });
  if (!row) return null;
  const expiresAt = new Date(String(row["expires_at"])).getTime();
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) return cloudDecrypt(String(row["access_token_enc"]));
  if (!xOAuthClientConfigured()) throw Object.assign(new Error("X token needs renewal but OAuth client settings are unavailable."), { statusCode: 503 });
  const refreshToken = cloudDecrypt(String(row["refresh_token_enc"]));
  const payload = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: env.X_OAUTH_CLIENT_ID }));
  await writeCredentials(payload, refreshToken);
  return String(payload["access_token"]);
}
