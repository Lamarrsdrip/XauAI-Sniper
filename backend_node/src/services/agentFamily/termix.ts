/**
 * TermiX / Agent.family client. Every path is taken from
 * https://docs.termix.ai (orders, listings, auth, config, A2A, on-chain tx).
 * Unknown paths are refused so a bug cannot send the owner token elsewhere.
 * This client never signs or broadcasts a transaction.
 */
const ALLOWED_HOSTS = new Set([
  "platform-backend.prod.termix.live",
  "platform-backend-base.prod.termix.live",
  "platform-backend-rh.prod.termix.live",
]);

const ALLOWED_PATH = new RegExp(
  "^/api/v1/(?:"
  + "config/contracts"
  + "|auth/refresh"
  + "|agents"
  + "|agents/[^/]+/services"
  + "|listings"
  + "|listings/[^/]+"
  + "|listings/[^/]+/publish"
  + "|orders"
  + "|orders/[^/]+"
  + "|orders/[^/]+/provider-accept/prepare"
  + "|orders/[^/]+/delivery/upload-url"
  + "|orders/[^/]+/delivery/artifacts"
  + "|orders/[^/]+/delivery/submit"
  + "|orders/[^/]+/claim-after-timeout/prepare"
  + "|orders/[^/]+/cancel-expired/prepare"
  + "|orders/[^/]+/dispute"
  + "|onchain/tx/[^/]+"
  + "|a2a/runtime/inbox"
  + "|a2a/runtime/reply"
  + "|a2a/runtime/signal"
  + ")$",
);

export class TermixError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
  }
}

export interface TermixClientOptions {
  baseUrl: string;
  accessToken: string;
  refreshToken?: string;
  fetchImpl?: typeof fetch;
  allowLoopback?: boolean;
}

export function assertTermixBaseUrl(baseUrl: string, allowLoopback = false): URL {
  let url: URL;
  try { url = new URL(baseUrl); }
  catch { throw new TermixError("TermiX base URL is not a URL.", 0, null); }
  const loopback = url.hostname === "127.0.0.1" && url.protocol === "http:";
  if (loopback && allowLoopback) return url;
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new TermixError("TermiX base URL is not an official production host.", 0, null);
  }
  return url;
}

export class TermixClient {
  private accessToken: string;
  private readonly refreshToken: string;
  private readonly base: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TermixClientOptions) {
    this.base = assertTermixBaseUrl(opts.baseUrl, opts.allowLoopback === true);
    this.accessToken = opts.accessToken;
    this.refreshToken = opts.refreshToken ?? "";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<unknown> {
    const pathname = path.split("?")[0] ?? path;
    if (!ALLOWED_PATH.test(pathname)) throw new TermixError(`Undocumented TermiX path refused: ${pathname}`, 0, null);
    const url = new URL(pathname, this.base);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const run = async () => this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let response = await run();
    if (response.status === 401 && this.refreshToken && pathname !== "/api/v1/auth/refresh") {
      await this.refresh();
      response = await run();
    }
    const text = await response.text();
    const parsed = text ? safeJson(text) : null;
    if (!response.ok) throw new TermixError(`TermiX ${method} ${pathname} returned ${response.status}`, response.status, parsed);
    return parsed;
  }

  private async refresh(): Promise<void> {
    const url = new URL("/api/v1/auth/refresh", this.base);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    const parsed = safeJson(await response.text());
    const token = parsed && typeof parsed === "object" ? String((parsed as { accessToken?: unknown }).accessToken ?? "") : "";
    if (!response.ok || !token) throw new TermixError("TermiX refresh failed.", response.status, parsed);
    this.accessToken = token;
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { return text; }
}

export function termixFromEnv(fetchImpl?: typeof fetch): TermixClient | null {
  if (process.env["XAUCLOUD_AGENT_FAMILY_ENABLED"] !== "true") return null;
  const accessToken = (process.env["TERMIX_ACCESS_TOKEN"] || "").trim();
  const baseUrl = (process.env["TERMIX_API_BASE"] || "https://platform-backend.prod.termix.live").trim();
  if (!accessToken) return null;
  return new TermixClient({
    baseUrl,
    accessToken,
    refreshToken: (process.env["TERMIX_REFRESH_TOKEN"] || "").trim(),
    fetchImpl,
    allowLoopback: process.env["ENVIRONMENT"] === "test",
  });
}
