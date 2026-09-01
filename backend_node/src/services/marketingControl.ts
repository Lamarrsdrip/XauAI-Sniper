import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { currentEaRelease } from "./releaseManifest.js";
import { getSettings } from "./settings.js";

export const MarketingCampaignStatusSchema = z.enum(["DRAFT", "READY", "PARTIALLY_PUBLISHED", "PUBLISHED", "ARCHIVED"]);
export const MarketingAudienceSchema = z.enum(["all_authenticated_users", "existing_customers", "active_customers", "prospects"]);
export const WebsiteSlotSchema = z.enum(["homepage_hero_campaign", "homepage_announcement", "homepage_performance_feature", "homepage_promo_banner", "pricing_promo"]);
export const DestinationSchema = z.enum(["homepage", "command_center", "purchase", "performance", "replay", "login", "support"]);

export const CampaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(2000),
  core_message: z.string().trim().min(1).max(5000),
  approved_fact_ids: z.array(z.string().max(120)).max(100).default([]),
  target_audiences: z.array(MarketingAudienceSchema).min(1).max(4),
  cta: z.object({ label: z.string().max(100), destination: DestinationSchema }).optional(),
});

export const CampaignUpdateSchema = CampaignCreateSchema.partial().extend({ status: MarketingCampaignStatusSchema.optional() });

export const WebsiteDraftSchema = z.object({
  slot: WebsiteSlotSchema,
  headline: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(4000),
  eyebrow: z.string().max(100).default(""),
  cta_label: z.string().max(100),
  destination: DestinationSchema,
  audience: z.literal("prospects").default("prospects"),
  approved_fact_ids: z.array(z.string().max(120)).max(50).default([]),
});

export const AnnouncementDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  short_message: z.string().trim().min(1).max(500),
  long_message: z.string().max(4000).default(""),
  cta_label: z.string().max(100).default(""),
  destination: DestinationSchema.default("command_center"),
  audience: z.enum(["all_authenticated_users", "existing_customers", "active_customers"]),
  start_time: z.string().datetime().nullable().optional(),
  end_time: z.string().datetime().nullable().optional(),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  dismissible: z.boolean().default(true),
});

export const PushDraftSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(220),
  destination: DestinationSchema,
  audience: z.enum(["all_authenticated_users", "existing_customers", "active_customers"]),
});

export const LandingPageDraftSchema = z.object({
  slug: z.string().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(160),
  audience: z.literal("prospects").default("prospects"),
  blocks: z.array(z.object({
    id: z.string().min(1).max(100),
    type: z.enum(["hero", "text", "features", "performance_metrics", "image", "faq", "cta", "risk"]),
    headline: z.string().max(300).optional(),
    body: z.string().max(5000).optional(),
    destination: DestinationSchema.optional(),
    cta_label: z.string().max(100).optional(),
    items: z.array(z.object({ label: z.string().max(160), value: z.string().max(500) })).max(12).optional(),
    image_url: z.string().url().max(2000).refine((url) => /^https:\/\//i.test(url), "Images must use HTTPS.").optional(),
  }).strict()).min(1).max(30),
  approved_fact_ids: z.array(z.string().max(120)).max(50).default([]),
});

export const SocialAssetSchema = z.object({
  kind: z.enum(["x_post", "x_thread", "instagram_caption", "telegram_announcement", "ad_copy", "short_video_script", "long_video_script", "graphics_brief", "faq"]),
  name: z.string().max(160),
  content: z.unknown(),
  approved_fact_ids: z.array(z.string().max(120)).max(50).default([]),
});

export function hashContent(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input)
    ? input.map(canonical)
    : input && typeof input === "object" && !(input instanceof Date)
      ? Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
      : input;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export async function marketingLinks(): Promise<Record<string, string>> {
  const settings = await getSettings();
  const base = env.PUBLIC_SITE_URL.replace(/\/$/, "");
  return {
    homepage: base,
    command_center: String(settings["command_center_url"] ?? `${base}/command`),
    purchase: `${base}/#purchase`,
    performance: `${base}/performance`,
    replay: `${base}/#performance`,
    bot_download: String(settings["command_center_url"] ?? `${base}/command`),
    login: `${base}/command/login`,
    support: String(settings["support_email"] ?? settings["smtp_email"] ?? "") ? `mailto:${String(settings["support_email"] ?? settings["smtp_email"])}` : `${base}/command`,
  };
}

export async function resolveDestination(destination: z.infer<typeof DestinationSchema>, campaignId?: string, medium?: string): Promise<string> {
  const links = await marketingLinks();
  const raw = links[destination];
  if (!raw || raw.startsWith("mailto:") || !campaignId) return raw || env.PUBLIC_SITE_URL;
  const url = new URL(raw);
  url.searchParams.set("utm_source", "xaucloud");
  url.searchParams.set("utm_medium", medium || "campaign");
  url.searchParams.set("utm_campaign", campaignId);
  return url.toString();
}

const FEATURE_SEEDS = [
  { id: "feature-pattern-intelligence", name: "Pattern Intelligence", description: "Pattern evidence participates in canonical M10 candidate direction and native setup competition.", source: "current stable release manifest" },
  { id: "feature-breakout-logic", name: "Breakout logic", description: "BREAKOUT_UP and BREAKOUT_DOWN candidates pass through existing confirmation, timing, risk, broker-stop, and execution gates.", source: "current stable release manifest" },
  { id: "feature-gold-specialized", name: "Gold-specialized intelligence", description: "XauCloud is built for XAUUSD market structure, trend, momentum, and volatility.", source: "public Features section" },
  { id: "feature-risk-sizing", name: "Risk calculated before execution", description: "Position sizing uses account balance, stop distance, and broker constraints.", source: "public Features section" },
  { id: "feature-trade-management", name: "Active trade management", description: "XauCloud manages stops, profit protection, and exits after a trade opens.", source: "public Features section" },
  { id: "feature-command-center", name: "Command Center", description: "Customers can see bot status, signals, open positions, performance, licensed downloads, and notifications.", source: "existing Command Center routes and UI" },
];

export async function ensureMarketingFacts(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  for (const feature of FEATURE_SEEDS) {
    await db.collection("approved_product_features").updateOne(
      { id: feature.id },
      { $setOnInsert: { ...feature, approved_for_marketing: true, created_at: now, approved_at: now, approval_basis: "Already implemented and publicly represented in XauCloud." } },
      { upsert: true },
    );
  }
  if (await db.collection("approved_marketing_performance").countDocuments({}) === 0) {
    try {
      const replay = JSON.parse(await readFile(path.join(process.cwd(), "data", "gold_replay_current.json"), "utf8")) as Record<string, Record<string, unknown>>;
      const meta = replay["meta"] ?? {};
      const summary = replay["summary"] ?? {};
      await db.collection("approved_marketing_performance").insertOne({
        id: "current-30-day-gold-replay",
        title: meta["title"], instrument: meta["symbol"], timeframe: meta["timeframe"],
        date_start: meta["period_start"], date_end: meta["period_end"], test_type: meta["source"],
        net_profit_usd: summary["net_profit_usd"], profit_factor: summary["profit_factor"], trades: summary["total_trades"],
        wins: summary["wins"], losses: summary["losses"], win_rate_pct: summary["win_rate_pct"],
        max_balance_drawdown_usd: summary["max_balance_drawdown_usd"], max_balance_drawdown_pct: summary["max_balance_drawdown_pct"],
        equity_relative_drawdown_pct: summary["equity_relative_drawdown_pct"],
        source_report_identifier: meta["report_evidence_file"], source_generated_at: meta["generated_at"],
        risk_disclaimer: meta["disclaimer"], approved_for_marketing: true, approved_at: now,
        approval_basis: "This replay is already the current published public XauCloud gold replay.",
      });
    } catch { /* Fact endpoint will explicitly report unavailable. */ }
  }
}

export async function approvedFactIds(): Promise<Set<string>> {
  const [features, results] = await Promise.all([
    getDb().collection("approved_product_features").find({ approved_for_marketing: true }, { projection: { id: 1 } }).toArray(),
    getDb().collection("approved_marketing_performance").find({ approved_for_marketing: true }, { projection: { id: 1 } }).toArray(),
  ]);
  return new Set([...features, ...results].map((row) => String(row["id"])));
}

export async function validateApprovedFacts(ids: string[]): Promise<void> {
  const approved = await approvedFactIds();
  const invalid = ids.filter((id) => !approved.has(id));
  if (invalid.length) throw Object.assign(new Error(`Facts are unavailable or not approved for marketing: ${invalid.join(", ")}`), { statusCode: 400 });
}

export async function productInfo(): Promise<Record<string, unknown>> {
  const release = await currentEaRelease();
  return {
    product_name: "XauCloud",
    platform: "MetaTrader 5 Expert Advisor and XauCloud Command Center",
    instrument: "XAUUSD",
    production_timeframe: "M10",
    production_status: release ? "available" : "unavailable",
    current_release: release ? { version: release.version, edition: release.edition ?? "", release_notes: release.release_notes ?? "", build_timestamp: release.build_timestamp ?? null } : { status: "unavailable" },
  };
}

export async function currentPricing(): Promise<Record<string, unknown>> {
  const settings = await getSettings();
  const kobo = Number(settings["pin_price_kobo"] ?? 0);
  return kobo > 0 ? { status: "available", currency: "NGN", amount_minor: kobo, amount: kobo / 100, license_type: "lifetime" } : { status: "unavailable" };
}

export async function issueMarketingConfirmation(kind: string, resourceId: string, operation: string, snapshot: unknown, audienceFingerprint = ""): Promise<Record<string, unknown>> {
  const raw = `xc_marketing_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.min(1800, Math.max(60, env.XAUCLOUD_GPT_ACTION_CONFIRMATION_TTL_SECONDS || 600)) * 1000);
  await getDb().collection("marketing_action_confirmations").insertOne({
    id: `marketing-confirmation-${randomUUID()}`, token_hash: hashContent(raw), kind, resource_id: resourceId, operation,
    content_hash: hashContent(snapshot), audience_fingerprint: audienceFingerprint, created_at: now, expires_at: expiresAt, used_at: null,
  });
  return { confirmation_token: raw, confirmation_expiration: expiresAt.toISOString() };
}

export async function consumeMarketingConfirmation(token: string, kind: string, resourceId: string, operation: string, snapshot: unknown, audienceFingerprint = ""): Promise<Record<string, unknown>> {
  const coll = getDb().collection("marketing_action_confirmations");
  const tokenHash = hashContent(token);
  const existing = await coll.findOne({ token_hash: tokenHash });
  if (!existing || existing["kind"] !== kind || existing["resource_id"] !== resourceId || existing["operation"] !== operation) throw Object.assign(new Error("Invalid confirmation token."), { statusCode: 400 });
  if (existing["used_at"]) throw Object.assign(new Error("Confirmation token has already been used."), { statusCode: 409 });
  if (new Date(String(existing["expires_at"])).getTime() <= Date.now()) throw Object.assign(new Error("Confirmation token has expired."), { statusCode: 410 });
  if (existing["content_hash"] !== hashContent(snapshot) || existing["audience_fingerprint"] !== audienceFingerprint) throw Object.assign(new Error("Content or audience changed after preparation. Prepare again."), { statusCode: 409 });
  const used = await coll.findOneAndUpdate({ token_hash: tokenHash, used_at: null, expires_at: { $gt: new Date() } }, { $set: { used_at: new Date() } }, { returnDocument: "after" });
  if (!used) throw Object.assign(new Error("Confirmation token is no longer available."), { statusCode: 409 });
  return used;
}

export async function campaignOverview(campaignId: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const campaign = await db.collection("marketing_campaigns").findOne({ id: campaignId }, { projection: { _id: 0 } });
  if (!campaign) return null;
  const [emails, website, announcements, push, social, landing] = await Promise.all([
    db.collection("admin_email_drafts").find({ campaign_id: campaignId }, { projection: { _id: 0 } }).toArray(),
    db.collection("marketing_website_assets").find({ campaign_id: campaignId }, { projection: { _id: 0 } }).toArray(),
    db.collection("marketing_announcements").find({ campaign_id: campaignId }, { projection: { _id: 0 } }).toArray(),
    db.collection("marketing_push_drafts").find({ campaign_id: campaignId }, { projection: { _id: 0 } }).toArray(),
    db.collection("marketing_social_assets").find({ campaign_id: campaignId }, { projection: { _id: 0 } }).toArray(),
    db.collection("marketing_landing_pages").find({ campaign_id: campaignId }, { projection: { _id: 0 } }).toArray(),
  ]);
  const video = social.filter((item) => String(item["kind"]).includes("video"));
  const graphics = social.filter((item) => item["kind"] === "graphics_brief");
  const faq = social.filter((item) => item["kind"] === "faq");
  const socialPosts = social.filter((item) => !String(item["kind"]).includes("video") && item["kind"] !== "graphics_brief" && item["kind"] !== "faq");
  return { ...campaign, channels: { email: emails, website, command_center: announcements, push, social: socialPosts, video, graphics, faq, landing_page: landing } };
}
