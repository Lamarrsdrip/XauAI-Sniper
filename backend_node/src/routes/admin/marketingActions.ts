import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { clientIp, rateLimit, requireAdmin, requireCloudUser } from "../../auth.js";
import { getDb } from "../../db.js";
import { requireGptAction } from "./gptEmailActions.js";
import { sendWebPushToUser } from "../../services/webPush.js";
import {
  AnnouncementDraftSchema,
  CampaignCreateSchema,
  CampaignUpdateSchema,
  DestinationSchema,
  LandingPageDraftSchema,
  MarketingAudienceSchema,
  PushDraftSchema,
  SocialAssetSchema,
  WebsiteDraftSchema,
  WebsiteSlotSchema,
  approvedFactIds,
  campaignOverview,
  consumeMarketingConfirmation,
  currentPricing,
  ensureMarketingFacts,
  hashContent,
  issueMarketingConfirmation,
  marketingLinks,
  productInfo,
  resolveDestination,
  validateApprovedFacts,
} from "../../services/marketingControl.js";

const IdSchema = z.object({ id: z.string().min(1).max(100) });
const CampaignIdSchema = z.object({ campaignId: z.string().min(1).max(100) });
const AssetParamsSchema = z.object({ campaignId: z.string().min(1).max(100), assetId: z.string().min(1).max(100) });
const ConfirmSchema = z.object({ confirmation_token: z.string().min(20).max(200), idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/) });
const PrepareOperationSchema = z.object({ operation: z.enum(["publish", "unpublish", "rollback"]).default("publish") });

function clean(row: Record<string, unknown>) { const { _id, ...rest } = row; return rest; }
function statusOf(error: unknown): number { return Number((error as { statusCode?: unknown })?.statusCode) || 500; }
function fail(reply: FastifyReply, error: unknown) { const status = statusOf(error); if (status < 500) return reply.code(status).send({ detail: error instanceof Error ? error.message : "Request failed." }); throw error; }
async function auditMarketing(action: string, campaignId: string | null, result: string, detail: Record<string, unknown> = {}) {
  await getDb().collection("marketing_action_audit").insertOne({ id: randomUUID(), source: "chatgpt_action", integration_identity: "XauCloud Admin GPT", campaign_id: campaignId, action, result, at: new Date().toISOString(), ...detail });
}
async function getCampaign(id: string): Promise<Record<string, unknown>> {
  const campaign = await getDb().collection("marketing_campaigns").findOne({ id });
  if (!campaign) throw Object.assign(new Error("Marketing campaign not found."), { statusCode: 404 });
  return campaign;
}
async function ensureCampaign(id: string) { await getCampaign(id); }

async function pushAudienceUserIds(audience: string): Promise<string[]> {
  const db = getDb();
  const subscriptions = await db.collection("web_push_subscriptions").find({}, { projection: { user_id: 1 } }).toArray();
  const subscribed = new Set(subscriptions.map((row) => String(row["user_id"] ?? "")).filter(Boolean));
  const prefs = await db.collection("cloud_notification_prefs").find({}, { projection: { user_id: 1, tier: 1, muted_categories: 1 } }).toArray();
  const optedIn = new Set(prefs.filter((row) => String(row["tier"] ?? "OFF") === "ALL_UPDATES" && !((row["muted_categories"] as string[] | undefined) ?? []).includes("MARKETING")).map((row) => String(row["user_id"] ?? "")));
  let eligible = [...subscribed].filter((id) => optedIn.has(id));
  if (audience === "all_authenticated_users") return eligible.sort();
  const users = await db.collection("cloud_users").find({}, { projection: { id: 1, email: 1 } }).toArray();
  const licenseQuery = audience === "active_customers" ? { is_active: true } : {};
  const licenses = await db.collection("pin_licenses").find(licenseQuery, { projection: { buyer_email: 1 } }).toArray();
  const buyers = new Set(licenses.map((row) => String(row["buyer_email"] ?? "").toLowerCase()));
  const matching = new Set(users.filter((user) => buyers.has(String(user["email"] ?? "").toLowerCase())).map((user) => String(user["id"] ?? "")));
  eligible = eligible.filter((id) => matching.has(id));
  return eligible.sort();
}

async function updateCampaignPublicationState(campaignId: string): Promise<void> {
  const overview = await campaignOverview(campaignId);
  if (!overview || overview["status"] === "ARCHIVED") return;
  const channels = overview["channels"] as Record<string, Record<string, unknown>[]>;
  const assets = Object.values(channels).flat();
  const published = assets.filter((asset) => ["published", "sent"].includes(String(asset["status"]))).length;
  const status = assets.length && published === assets.length ? "PUBLISHED" : published ? "PARTIALLY_PUBLISHED" : assets.length ? "READY" : "DRAFT";
  await getDb().collection("marketing_campaigns").updateOne({ id: campaignId }, { $set: { status, updated_at: new Date().toISOString() } });
}

async function prepareAsset(kind: string, collection: string, campaignId: string, assetId: string, operation: string): Promise<Record<string, unknown>> {
  const asset = await getDb().collection(collection).findOne({ id: assetId, campaign_id: campaignId });
  if (!asset) throw Object.assign(new Error("Marketing asset not found."), { statusCode: 404 });
  const confirmation = await issueMarketingConfirmation(kind, assetId, operation, asset, String(asset["audience"] ?? ""));
  return { campaign_id: campaignId, asset_id: assetId, operation, content_hash: hashContent(asset), preview: clean(asset), ...confirmation };
}

async function publishVersionedAsset(kind: string, collection: string, campaignId: string, assetId: string, operation: string, token: string, idempotencyKey: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const existing = await db.collection("marketing_publication_log").findOne({ kind, idempotency_key: idempotencyKey }, { projection: { _id: 0 } });
  if (existing) return { ...existing, duplicate: true };
  const coll = db.collection(collection);
  const asset = await coll.findOne({ id: assetId, campaign_id: campaignId });
  if (!asset) throw Object.assign(new Error("Marketing asset not found."), { statusCode: 404 });
  if (operation === "rollback" && !asset["previous_asset_id"]) {
    throw Object.assign(new Error("No previous published version is available for rollback."), { statusCode: 409 });
  }
  await consumeMarketingConfirmation(token, kind, assetId, operation, asset, String(asset["audience"] ?? ""));
  const now = new Date().toISOString();
  const record = { id: `publication-${randomUUID()}`, kind, campaign_id: campaignId, asset_id: assetId, operation, previous_asset_id: null as string | null, status: "publishing", source: "chatgpt_action", idempotency_key: idempotencyKey, at: now, duplicate: false };
  try { await db.collection("marketing_publication_log").insertOne({ ...record }); } catch (error) {
    if (Number((error as { code?: unknown })?.code) === 11000) {
      const duplicate = await db.collection("marketing_publication_log").findOne({ kind, idempotency_key: idempotencyKey }, { projection: { _id: 0 } });
      if (duplicate) return { ...duplicate, duplicate: true };
    }
    throw error;
  }
  let previousId: string | null = null;
  if (operation === "publish") {
    const liveQuery = kind === "website" ? { slot: asset["slot"], status: "published" } : kind === "landing" ? { slug: asset["slug"], status: "published" } : { id: "never" };
    const previous = await coll.findOne(liveQuery);
    previousId = previous && previous["id"] !== assetId ? String(previous["id"]) : null;
    if (previousId) await coll.updateOne({ id: previousId }, { $set: { status: "superseded", updated_at: now } });
    await coll.updateOne({ id: assetId }, { $set: { status: "published", published_at: now, previous_asset_id: previousId, updated_at: now } });
  } else if (operation === "unpublish") {
    await coll.updateOne({ id: assetId }, { $set: { status: "unpublished", unpublished_at: now, updated_at: now } });
  } else {
    const previousAssetId = String(asset["previous_asset_id"]);
    await coll.updateOne({ id: assetId }, { $set: { status: "rolled_back", updated_at: now } });
    await coll.updateOne({ id: previousAssetId }, { $set: { status: "published", published_at: now, updated_at: now } });
    previousId = previousAssetId;
  }
  Object.assign(record, { previous_asset_id: previousId, status: "accepted", updated_at: new Date().toISOString() });
  await db.collection("marketing_publication_log").updateOne({ id: record.id }, { $set: { ...record } });
  await updateCampaignPublicationState(campaignId);
  await auditMarketing(`${kind.toUpperCase()}_${operation.toUpperCase()}`, campaignId, "success", { asset_id: assetId });
  return record;
}

export async function ensureMarketingActionInfrastructure(): Promise<void> {
  await ensureMarketingFacts();
  const db = getDb();
  await Promise.all([
    db.collection("marketing_action_confirmations").createIndex({ token_hash: 1 }, { unique: true }),
    db.collection("marketing_action_confirmations").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    db.collection("marketing_publication_log").createIndex({ kind: 1, idempotency_key: 1 }, { unique: true }),
    db.collection("marketing_push_delivery_log").createIndex({ idempotency_key: 1 }, { unique: true }),
    db.collection("marketing_landing_pages").createIndex({ slug: 1, status: 1 }),
  ]);
}

export async function registerMarketingActionRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();
  const action = { preHandler: requireGptAction };

  app.get("/admin/actions/marketing/context", action, async () => {
    const [product, features, results, links, pricing] = await Promise.all([
      productInfo(),
      db.collection("approved_product_features").find({ approved_for_marketing: true }, { projection: { _id: 0 } }).toArray(),
      db.collection("approved_marketing_performance").find({ approved_for_marketing: true }, { projection: { _id: 0 } }).sort({ approved_at: -1 }).toArray(),
      marketingLinks(),
      currentPricing(),
    ]);
    return {
      product,
      features,
      performance: results.length ? { status: "available", results } : { status: "unavailable", results: [] },
      release: product["current_release"],
      links,
      pricing,
      website_slots: WebsiteSlotSchema.options,
    };
  });

  app.get("/admin/actions/marketing/product", action, async () => productInfo());
  app.get("/admin/actions/marketing/features", action, async () => ({ features: await db.collection("approved_product_features").find({ approved_for_marketing: true }, { projection: { _id: 0 } }).toArray() }));
  app.get("/admin/actions/marketing/performance", action, async () => {
    const results = await db.collection("approved_marketing_performance").find({ approved_for_marketing: true }, { projection: { _id: 0 } }).sort({ approved_at: -1 }).toArray();
    return results.length ? { status: "available", results } : { status: "unavailable", results: [] };
  });
  app.get("/admin/actions/marketing/release", action, async () => ({ release: (await productInfo())["current_release"] }));
  app.get("/admin/actions/marketing/links", action, async () => ({ links: await marketingLinks() }));
  app.get("/admin/actions/marketing/pricing", action, async () => currentPricing());

  app.post("/admin/actions/marketing/campaigns", action, async (request, reply) => {
    try {
      const req = CampaignCreateSchema.parse(request.body ?? {});
      await validateApprovedFacts(req.approved_fact_ids);
      const now = new Date().toISOString();
      const campaign = { id: `campaign-${randomUUID()}`, ...req, status: "DRAFT", source: "chatgpt_action", created_at: now, updated_at: now };
      await db.collection("marketing_campaigns").insertOne({ ...campaign });
      await auditMarketing("MARKETING_CAMPAIGN_CREATED", campaign.id, "success");
      return campaign;
    } catch (error) { return fail(reply, error); }
  });
  app.get("/admin/actions/marketing/campaigns", action, async () => ({ campaigns: await db.collection("marketing_campaigns").find({}, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(100).toArray() }));
  app.get("/admin/actions/marketing/campaigns/:id", action, async (request, reply) => {
    const { id } = IdSchema.parse(request.params); const result = await campaignOverview(id); return result ?? reply.code(404).send({ detail: "Marketing campaign not found." });
  });
  app.get("/admin/actions/marketing/campaigns/:id/status", action, async (request, reply) => {
    const { id } = IdSchema.parse(request.params); const result = await campaignOverview(id); return result ? { campaign_id: id, status: result["status"], channels: result["channels"] } : reply.code(404).send({ detail: "Marketing campaign not found." });
  });
  app.patch("/admin/actions/marketing/campaigns/:id", action, async (request, reply) => {
    try {
      const { id } = IdSchema.parse(request.params); const patch = CampaignUpdateSchema.parse(request.body ?? {}); await getCampaign(id);
      if (patch.approved_fact_ids) await validateApprovedFacts(patch.approved_fact_ids);
      await db.collection("marketing_campaigns").updateOne({ id }, { $set: { ...patch, updated_at: new Date().toISOString() } });
      await auditMarketing("MARKETING_CAMPAIGN_UPDATED", id, "success"); return await campaignOverview(id);
    } catch (error) { return fail(reply, error); }
  });

  app.get("/admin/actions/marketing/website/slots", action, async () => ({ slots: WebsiteSlotSchema.options }));
  app.post("/admin/actions/marketing/campaigns/:campaignId/website-drafts", action, async (request, reply) => {
    try { const { campaignId } = CampaignIdSchema.parse(request.params); await ensureCampaign(campaignId); const req = WebsiteDraftSchema.parse(request.body ?? {}); await validateApprovedFacts(req.approved_fact_ids); const now = new Date().toISOString(); const asset = { id: `website-${randomUUID()}`, campaign_id: campaignId, ...req, status: "draft", source: "chatgpt_action", created_at: now, updated_at: now }; await db.collection("marketing_website_assets").insertOne({ ...asset }); await updateCampaignPublicationState(campaignId); await auditMarketing("WEBSITE_DRAFT_CREATED", campaignId, "success", { asset_id: asset.id }); return asset; } catch (error) { return fail(reply, error); }
  });
  app.get("/admin/actions/marketing/campaigns/:campaignId/website-drafts/:assetId/preview", action, async (request, reply) => {
    const { campaignId, assetId } = AssetParamsSchema.parse(request.params); const asset = await db.collection("marketing_website_assets").findOne({ id: assetId, campaign_id: campaignId }, { projection: { _id: 0 } }); if (!asset) return reply.code(404).send({ detail: "Website draft not found." }); return { ...asset, cta_url: await resolveDestination(DestinationSchema.parse(asset["destination"]), campaignId, "website") };
  });
  app.post("/admin/actions/marketing/campaigns/:campaignId/website-drafts/:assetId/prepare", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const { operation } = PrepareOperationSchema.parse(request.body ?? {}); return await prepareAsset("website", "marketing_website_assets", p.campaignId, p.assetId, operation); } catch (error) { return fail(reply, error); } });
  app.post("/admin/actions/marketing/campaigns/:campaignId/website-drafts/:assetId/publish", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const req = ConfirmSchema.and(PrepareOperationSchema).parse(request.body ?? {}); return await publishVersionedAsset("website", "marketing_website_assets", p.campaignId, p.assetId, req.operation, req.confirmation_token, req.idempotency_key); } catch (error) { return fail(reply, error); } });
  app.post("/admin/actions/marketing/campaigns/:campaignId/website-drafts/:assetId/rollback", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const req = ConfirmSchema.parse(request.body ?? {}); return await publishVersionedAsset("website", "marketing_website_assets", p.campaignId, p.assetId, "rollback", req.confirmation_token, req.idempotency_key); } catch (error) { return fail(reply, error); } });
  app.post("/admin/actions/marketing/campaigns/:campaignId/website-drafts/:assetId/unpublish", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const req = ConfirmSchema.parse(request.body ?? {}); return await publishVersionedAsset("website", "marketing_website_assets", p.campaignId, p.assetId, "unpublish", req.confirmation_token, req.idempotency_key); } catch (error) { return fail(reply, error); } });

  app.post("/admin/actions/marketing/campaigns/:campaignId/announcements", action, async (request, reply) => {
    try { const { campaignId } = CampaignIdSchema.parse(request.params); await ensureCampaign(campaignId); const req = AnnouncementDraftSchema.parse(request.body ?? {}); const now = new Date().toISOString(); const asset = { id: `announcement-${randomUUID()}`, campaign_id: campaignId, ...req, status: "draft", source: "chatgpt_action", created_at: now, updated_at: now }; await db.collection("marketing_announcements").insertOne({ ...asset }); await updateCampaignPublicationState(campaignId); await auditMarketing("ANNOUNCEMENT_DRAFT_CREATED", campaignId, "success", { asset_id: asset.id }); return asset; } catch (error) { return fail(reply, error); }
  });
  app.get("/admin/actions/marketing/campaigns/:campaignId/announcements/:assetId/preview", action, async (request, reply) => { const p = AssetParamsSchema.parse(request.params); const asset = await db.collection("marketing_announcements").findOne({ id: p.assetId, campaign_id: p.campaignId }, { projection: { _id: 0 } }); return asset ? { ...asset, cta_url: await resolveDestination(DestinationSchema.parse(asset["destination"]), p.campaignId, "command_center") } : reply.code(404).send({ detail: "Announcement not found." }); });
  app.post("/admin/actions/marketing/campaigns/:campaignId/announcements/:assetId/prepare", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const { operation } = PrepareOperationSchema.parse(request.body ?? {}); return await prepareAsset("announcement", "marketing_announcements", p.campaignId, p.assetId, operation); } catch (error) { return fail(reply, error); } });
  app.post("/admin/actions/marketing/campaigns/:campaignId/announcements/:assetId/publish", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const req = ConfirmSchema.and(PrepareOperationSchema).parse(request.body ?? {}); return await publishVersionedAsset("announcement", "marketing_announcements", p.campaignId, p.assetId, req.operation, req.confirmation_token, req.idempotency_key); } catch (error) { return fail(reply, error); } });
  app.post("/admin/actions/marketing/campaigns/:campaignId/announcements/:assetId/unpublish", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const req = ConfirmSchema.parse(request.body ?? {}); return await publishVersionedAsset("announcement", "marketing_announcements", p.campaignId, p.assetId, "unpublish", req.confirmation_token, req.idempotency_key); } catch (error) { return fail(reply, error); } });

  app.post("/admin/actions/marketing/campaigns/:campaignId/push-drafts", action, async (request, reply) => {
    try { const { campaignId } = CampaignIdSchema.parse(request.params); await ensureCampaign(campaignId); const req = PushDraftSchema.parse(request.body ?? {}); const now = new Date().toISOString(); const asset = { id: `push-${randomUUID()}`, campaign_id: campaignId, ...req, status: "draft", source: "chatgpt_action", created_at: now, updated_at: now }; await db.collection("marketing_push_drafts").insertOne({ ...asset }); await updateCampaignPublicationState(campaignId); await auditMarketing("PUSH_DRAFT_CREATED", campaignId, "success", { asset_id: asset.id }); return asset; } catch (error) { return fail(reply, error); }
  });
  app.get("/admin/actions/marketing/campaigns/:campaignId/push-drafts/:assetId/preview", action, async (request, reply) => { const p = AssetParamsSchema.parse(request.params); const asset = await db.collection("marketing_push_drafts").findOne({ id: p.assetId, campaign_id: p.campaignId }, { projection: { _id: 0 } }); return asset ? { ...asset, deep_link: await resolveDestination(DestinationSchema.parse(asset["destination"]), p.campaignId, "push") } : reply.code(404).send({ detail: "Push draft not found." }); });
  app.get("/admin/actions/marketing/push/audience-count", action, async (request) => { const q = z.object({ audience: z.enum(["all_authenticated_users", "existing_customers", "active_customers"]) }).parse(request.query); const users = await pushAudienceUserIds(q.audience); return { audience: q.audience, recipient_count: users.length, rule: "Users with an authorized Web Push subscription and enabled notification preferences only." }; });
  app.post("/admin/actions/marketing/campaigns/:campaignId/push-drafts/:assetId/prepare", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const asset = await db.collection("marketing_push_drafts").findOne({ id: p.assetId, campaign_id: p.campaignId }); if (!asset) return reply.code(404).send({ detail: "Push draft not found." }); const users = await pushAudienceUserIds(String(asset["audience"])); const confirmation = await issueMarketingConfirmation("push", p.assetId, "send", asset, hashContent(users)); return { campaign_id: p.campaignId, push_id: p.assetId, title: asset["title"], body: asset["body"], deep_link: await resolveDestination(DestinationSchema.parse(asset["destination"]), p.campaignId, "push"), audience: asset["audience"], recipient_count: users.length, ...confirmation }; } catch (error) { return fail(reply, error); } });
  app.post("/admin/actions/marketing/campaigns/:campaignId/push-drafts/:assetId/send", action, async (request, reply) => {
    try { const p = AssetParamsSchema.parse(request.params); const req = ConfirmSchema.parse(request.body ?? {}); const old = await db.collection("marketing_push_delivery_log").findOne({ idempotency_key: req.idempotency_key }, { projection: { _id: 0 } }); if (old) return { ...old, duplicate: true }; const asset = await db.collection("marketing_push_drafts").findOne({ id: p.assetId, campaign_id: p.campaignId }); if (!asset) return reply.code(404).send({ detail: "Push draft not found." }); const users = await pushAudienceUserIds(String(asset["audience"])); await consumeMarketingConfirmation(req.confirmation_token, "push", p.assetId, "send", asset, hashContent(users)); const now = new Date().toISOString(); const record = { id: `push-send-${randomUUID()}`, campaign_id: p.campaignId, push_id: p.assetId, audience: asset["audience"], recipients: users.length, sent: 0, status: "sending", idempotency_key: req.idempotency_key, source: "chatgpt_action", at: now, duplicate: false }; try { await db.collection("marketing_push_delivery_log").insertOne({ ...record }); } catch (error) { if (Number((error as { code?: unknown })?.code) === 11000) { const duplicate = await db.collection("marketing_push_delivery_log").findOne({ idempotency_key: req.idempotency_key }, { projection: { _id: 0 } }); if (duplicate) return { ...duplicate, duplicate: true }; } throw error; } const deepLink = await resolveDestination(DestinationSchema.parse(asset["destination"]), p.campaignId, "push"); let sent = 0; for (const userId of users) sent += await sendWebPushToUser(userId, { title: String(asset["title"]), body: String(asset["body"]), deep_link: deepLink, category: "MARKETING", tag: `campaign-${p.campaignId}` }); Object.assign(record, { sent, status: "sent", updated_at: new Date().toISOString() }); await db.collection("marketing_push_delivery_log").updateOne({ id: record.id }, { $set: { ...record } }); await db.collection("marketing_push_drafts").updateOne({ id: p.assetId }, { $set: { status: "sent", sent_at: now, delivery_id: record.id } }); await updateCampaignPublicationState(p.campaignId); await auditMarketing("PUSH_SENT", p.campaignId, "success", { asset_id: p.assetId, audience: asset["audience"], recipient_count: users.length }); return record; } catch (error) { return fail(reply, error); }
  });

  app.post("/admin/actions/marketing/campaigns/:campaignId/landing-pages", action, async (request, reply) => {
    try { const { campaignId } = CampaignIdSchema.parse(request.params); await ensureCampaign(campaignId); const req = LandingPageDraftSchema.parse(request.body ?? {}); await validateApprovedFacts(req.approved_fact_ids); const now = new Date().toISOString(); const asset = { id: `landing-${randomUUID()}`, campaign_id: campaignId, ...req, status: "draft", source: "chatgpt_action", created_at: now, updated_at: now }; await db.collection("marketing_landing_pages").insertOne({ ...asset }); await updateCampaignPublicationState(campaignId); await auditMarketing("LANDING_PAGE_DRAFT_CREATED", campaignId, "success", { asset_id: asset.id }); return asset; } catch (error) { return fail(reply, error); }
  });
  app.get("/admin/actions/marketing/campaigns/:campaignId/landing-pages/:assetId/preview", action, async (request, reply) => { const p = AssetParamsSchema.parse(request.params); const asset = await db.collection("marketing_landing_pages").findOne({ id: p.assetId, campaign_id: p.campaignId }, { projection: { _id: 0 } }); return asset ?? reply.code(404).send({ detail: "Landing page not found." }); });
  app.post("/admin/actions/marketing/campaigns/:campaignId/landing-pages/:assetId/prepare", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const { operation } = PrepareOperationSchema.parse(request.body ?? {}); return await prepareAsset("landing", "marketing_landing_pages", p.campaignId, p.assetId, operation); } catch (error) { return fail(reply, error); } });
  app.post("/admin/actions/marketing/campaigns/:campaignId/landing-pages/:assetId/publish", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const req = ConfirmSchema.and(PrepareOperationSchema).parse(request.body ?? {}); return await publishVersionedAsset("landing", "marketing_landing_pages", p.campaignId, p.assetId, req.operation, req.confirmation_token, req.idempotency_key); } catch (error) { return fail(reply, error); } });
  app.post("/admin/actions/marketing/campaigns/:campaignId/landing-pages/:assetId/unpublish", action, async (request, reply) => { try { const p = AssetParamsSchema.parse(request.params); const req = ConfirmSchema.parse(request.body ?? {}); return await publishVersionedAsset("landing", "marketing_landing_pages", p.campaignId, p.assetId, "unpublish", req.confirmation_token, req.idempotency_key); } catch (error) { return fail(reply, error); } });

  app.post("/admin/actions/marketing/campaigns/:campaignId/social", action, async (request, reply) => { try { const { campaignId } = CampaignIdSchema.parse(request.params); await ensureCampaign(campaignId); const req = SocialAssetSchema.parse(request.body ?? {}); await validateApprovedFacts(req.approved_fact_ids); const now = new Date().toISOString(); const asset = { id: `social-${randomUUID()}`, campaign_id: campaignId, ...req, status: "draft", source: "chatgpt_action", created_at: now, updated_at: now }; await db.collection("marketing_social_assets").insertOne({ ...asset }); await updateCampaignPublicationState(campaignId); await auditMarketing("SOCIAL_CONTENT_SAVED", campaignId, "success", { asset_id: asset.id, kind: asset.kind }); return asset; } catch (error) { return fail(reply, error); } });
  app.get("/admin/actions/marketing/campaigns/:campaignId/social", action, async (request) => { const { campaignId } = CampaignIdSchema.parse(request.params); return { assets: await db.collection("marketing_social_assets").find({ campaign_id: campaignId }, { projection: { _id: 0 } }).toArray() }; });
  app.patch("/admin/actions/marketing/campaigns/:campaignId/social/:assetId", action, async (request, reply) => { const p = AssetParamsSchema.parse(request.params); const patch = z.object({ name: z.string().max(160).optional(), content: z.unknown().optional(), status: z.enum(["draft", "published_manually"]).optional() }).parse(request.body ?? {}); const result = await db.collection("marketing_social_assets").updateOne({ id: p.assetId, campaign_id: p.campaignId }, { $set: { ...patch, updated_at: new Date().toISOString() } }); return result.matchedCount ? await db.collection("marketing_social_assets").findOne({ id: p.assetId }, { projection: { _id: 0 } }) : reply.code(404).send({ detail: "Social asset not found." }); });

  app.get("/admin/actions/marketing/campaigns/:id/performance", action, async (request, reply) => { const { id } = IdSchema.parse(request.params); if (!await db.collection("marketing_campaigns").findOne({ id })) return reply.code(404).send({ detail: "Marketing campaign not found." }); return campaignPerformance(id); });
  app.get("/admin/actions/marketing/analytics/compare", action, async (request) => { const q = z.object({ campaign_ids: z.string() }).parse(request.query); const ids = q.campaign_ids.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 10); return { campaigns: await Promise.all(ids.map(campaignPerformance)) }; });

  // Normal Admin control: same records, with session auth rather than the Action secret.
  app.get("/admin/marketing/campaigns", { preHandler: requireAdmin }, async () => ({ campaigns: await db.collection("marketing_campaigns").find({}, { projection: { _id: 0 } }).sort({ updated_at: -1 }).toArray() }));
  app.post("/admin/marketing/campaigns", { preHandler: requireAdmin }, async (request, reply) => { try { const req = CampaignCreateSchema.parse(request.body ?? {}); await validateApprovedFacts(req.approved_fact_ids); const now = new Date().toISOString(); const campaign = { id: `campaign-${randomUUID()}`, ...req, status: "DRAFT", source: "admin_dashboard", created_at: now, updated_at: now }; await db.collection("marketing_campaigns").insertOne({ ...campaign }); return campaign; } catch (error) { return fail(reply, error); } });
  app.get("/admin/marketing/campaigns/:id", { preHandler: requireAdmin }, async (request, reply) => { const { id } = IdSchema.parse(request.params); return await campaignOverview(id) ?? reply.code(404).send({ detail: "Marketing campaign not found." }); });
  app.patch("/admin/marketing/campaigns/:id", { preHandler: requireAdmin }, async (request, reply) => { try { const { id } = IdSchema.parse(request.params); const patch = CampaignUpdateSchema.parse(request.body ?? {}); if (patch.approved_fact_ids) await validateApprovedFacts(patch.approved_fact_ids); const result = await db.collection("marketing_campaigns").updateOne({ id }, { $set: { ...patch, updated_at: new Date().toISOString() } }); return result.matchedCount ? await campaignOverview(id) : reply.code(404).send({ detail: "Marketing campaign not found." }); } catch (error) { return fail(reply, error); } });
  app.get("/admin/marketing/facts", { preHandler: requireAdmin }, async () => ({ features: await db.collection("approved_product_features").find({}, { projection: { _id: 0 } }).toArray(), performance: await db.collection("approved_marketing_performance").find({}, { projection: { _id: 0 } }).toArray() }));
  app.put("/admin/marketing/facts/:id/approval", { preHandler: requireAdmin }, async (request, reply) => { const { id } = IdSchema.parse(request.params); const body = z.object({ approved_for_marketing: z.boolean() }).parse(request.body ?? {}); const now = new Date().toISOString(); for (const name of ["approved_product_features", "approved_marketing_performance"]) { const result = await db.collection(name).updateOne({ id }, { $set: { approved_for_marketing: body.approved_for_marketing, approved_at: body.approved_for_marketing ? now : null, updated_at: now } }); if (result.matchedCount) return { id, ...body }; } return reply.code(404).send({ detail: "Marketing fact not found." }); });
  app.patch("/admin/marketing/assets/:kind/:id", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const params = z.object({ kind: z.enum(["website", "announcement", "push", "landing", "social"]), id: z.string().max(100) }).parse(request.params);
      const schemas = { website: WebsiteDraftSchema.partial(), announcement: AnnouncementDraftSchema.partial(), push: PushDraftSchema.partial(), landing: LandingPageDraftSchema.partial(), social: SocialAssetSchema.partial() } as const;
      const patch = schemas[params.kind].parse(request.body ?? {});
      if ("approved_fact_ids" in patch && Array.isArray(patch.approved_fact_ids)) await validateApprovedFacts(patch.approved_fact_ids);
      const collections = { website: "marketing_website_assets", announcement: "marketing_announcements", push: "marketing_push_drafts", landing: "marketing_landing_pages", social: "marketing_social_assets" } as const;
      const result = await db.collection(collections[params.kind]).updateOne({ id: params.id }, { $set: { ...patch, status: "draft", updated_at: new Date().toISOString() } });
      return result.matchedCount ? await db.collection(collections[params.kind]).findOne({ id: params.id }, { projection: { _id: 0 } }) : reply.code(404).send({ detail: "Marketing asset not found." });
    } catch (error) { return fail(reply, error); }
  });
  app.post("/admin/marketing/assets/:kind/:id/action", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const params = z.object({ kind: z.enum(["website", "announcement", "push", "landing", "social"]), id: z.string().max(100) }).parse(request.params);
      const body = z.object({ action: z.enum(["publish", "unpublish", "rollback", "send", "archive"]), confirm: z.literal(true), idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/) }).parse(request.body ?? {});
      const collections = { website: "marketing_website_assets", announcement: "marketing_announcements", push: "marketing_push_drafts", landing: "marketing_landing_pages", social: "marketing_social_assets" } as const;
      const coll = db.collection(collections[params.kind]);
      const asset = await coll.findOne({ id: params.id });
      if (!asset) return reply.code(404).send({ detail: "Marketing asset not found." });
      const prior = await db.collection("marketing_publication_log").findOne({ kind: `admin_${params.kind}`, idempotency_key: body.idempotency_key }, { projection: { _id: 0 } });
      if (prior) return { ...prior, duplicate: true };
      const campaignId = String(asset["campaign_id"] ?? "");
      const now = new Date().toISOString();
      if (params.kind === "push" && body.action === "send") {
        const users = await pushAudienceUserIds(String(asset["audience"]));
        const deepLink = await resolveDestination(DestinationSchema.parse(asset["destination"]), campaignId, "push");
        let sent = 0;
        for (const userId of users) sent += await sendWebPushToUser(userId, { title: String(asset["title"]), body: String(asset["body"]), deep_link: deepLink, category: "MARKETING", tag: `campaign-${campaignId}` });
        await coll.updateOne({ id: params.id }, { $set: { status: "sent", sent_at: now, updated_at: now } });
        await db.collection("marketing_push_delivery_log").insertOne({ id: `push-send-${randomUUID()}`, campaign_id: campaignId, push_id: params.id, audience: asset["audience"], recipients: users.length, sent, status: "sent", idempotency_key: body.idempotency_key, source: "admin_dashboard", at: now });
      } else if (body.action === "rollback") {
        const previousId = String(asset["previous_asset_id"] ?? "");
        if (!previousId) return reply.code(409).send({ detail: "No previous version is available for rollback." });
        await coll.updateOne({ id: params.id }, { $set: { status: "rolled_back", updated_at: now } });
        await coll.updateOne({ id: previousId }, { $set: { status: "published", published_at: now, updated_at: now } });
      } else {
        const next = body.action === "publish" ? "published" : body.action === "unpublish" ? "unpublished" : "archived";
        let previousAssetId: string | null = null;
        if (next === "published" && params.kind === "website") {
          const previous = await coll.findOne({ slot: asset["slot"], status: "published" });
          previousAssetId = previous && previous["id"] !== params.id ? String(previous["id"]) : null;
          if (previousAssetId) await coll.updateOne({ id: previousAssetId }, { $set: { status: "superseded", updated_at: now } });
        }
        if (next === "published" && params.kind === "landing") {
          const previous = await coll.findOne({ slug: asset["slug"], status: "published" });
          previousAssetId = previous && previous["id"] !== params.id ? String(previous["id"]) : null;
          if (previousAssetId) await coll.updateOne({ id: previousAssetId }, { $set: { status: "superseded", updated_at: now } });
        }
        await coll.updateOne({ id: params.id }, { $set: { status: next, updated_at: now, ...(next === "published" ? { published_at: now, previous_asset_id: previousAssetId } : {}) } });
      }
      const record = { id: `publication-${randomUUID()}`, kind: `admin_${params.kind}`, campaign_id: campaignId, asset_id: params.id, operation: body.action, status: "accepted", source: "admin_dashboard", idempotency_key: body.idempotency_key, at: now, duplicate: false };
      await db.collection("marketing_publication_log").insertOne({ ...record });
      await updateCampaignPublicationState(campaignId);
      return record;
    } catch (error) { return fail(reply, error); }
  });

  // Controlled public surfaces.
  app.get("/marketing/website", async () => { const rows = await db.collection("marketing_website_assets").find({ status: "published" }, { projection: { _id: 0 } }).toArray(); return { slots: await Promise.all(rows.map(async (row) => ({ ...row, cta_url: await resolveDestination(DestinationSchema.parse(row["destination"]), String(row["campaign_id"]), "website") }))) }; });
  app.get("/marketing/campaign/:slug", async (request, reply) => { const { slug } = z.object({ slug: z.string().max(80) }).parse(request.params); const page = await db.collection("marketing_landing_pages").findOne({ slug, status: "published" }, { projection: { _id: 0 } }); if (!page) return reply.code(404).send({ detail: "Campaign page not found." }); await db.collection("marketing_events").insertOne({ id: randomUUID(), campaign_id: page["campaign_id"], channel: "landing_page", event: "visit", at: new Date().toISOString() }); const blocks = await Promise.all(((page["blocks"] as Record<string, unknown>[] | undefined) ?? []).map(async (block) => block["destination"] ? { ...block, cta_url: await resolveDestination(DestinationSchema.parse(block["destination"]), String(page["campaign_id"]), "landing_page") } : block)); return { ...page, blocks }; });
  app.get("/marketing/announcements/current", { preHandler: requireCloudUser }, async (request) => { const user = (request as FastifyRequest & { cloudUser: Record<string, unknown> }).cloudUser; const now = new Date().toISOString(); const rows = await db.collection("marketing_announcements").find({ status: "published" }, { projection: { _id: 0 } }).toArray(); const email = String(user["email"] ?? "").toLowerCase(); const licenses = await db.collection("pin_licenses").find({}, { projection: { buyer_email: 1, is_active: 1 } }).toArray(); const license = licenses.find((item) => String(item["buyer_email"] ?? "").toLowerCase() === email); const visible = rows.filter((row) => (!row["start_time"] || String(row["start_time"]) <= now) && (!row["end_time"] || String(row["end_time"]) >= now) && (row["audience"] === "all_authenticated_users" || (row["audience"] === "existing_customers" && license) || (row["audience"] === "active_customers" && license?.["is_active"]))); return { announcements: await Promise.all(visible.map(async (row) => ({ ...row, cta_url: await resolveDestination(DestinationSchema.parse(row["destination"]), String(row["campaign_id"]), "command_center") }))) }; });
  app.post("/marketing/events", async (request, reply) => { rateLimit(`marketing_event:${clientIp(request)}`, 60, 60); const body = z.object({ campaign_id: z.string().max(100), channel: z.enum(["email", "website", "command_center", "push", "social", "landing_page"]), event: z.enum(["visit", "cta_click", "dismiss"]), asset_id: z.string().max(100).optional() }).parse(request.body ?? {}); if (!await db.collection("marketing_campaigns").findOne({ id: body.campaign_id })) return reply.code(404).send({ detail: "Campaign not found." }); await db.collection("marketing_events").insertOne({ id: randomUUID(), ...body, at: new Date().toISOString() }); return { accepted: true }; });
}

async function campaignPerformance(campaignId: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const [email, push, events, website, landing, announcements] = await Promise.all([
    db.collection("admin_email_log").find({ campaign_id: campaignId }, { projection: { sent: 1, failed: 1 } }).toArray(),
    db.collection("marketing_push_delivery_log").find({ campaign_id: campaignId }, { projection: { sent: 1, recipients: 1 } }).toArray(),
    db.collection("marketing_events").find({ campaign_id: campaignId }, { projection: { event: 1, channel: 1 } }).toArray(),
    db.collection("marketing_website_assets").countDocuments({ campaign_id: campaignId, status: "published" }),
    db.collection("marketing_landing_pages").countDocuments({ campaign_id: campaignId, status: "published" }),
    db.collection("marketing_announcements").countDocuments({ campaign_id: campaignId, status: "published" }),
  ]);
  const eventCount = (event: string, channel?: string) => events.filter((row) => row["event"] === event && (!channel || row["channel"] === channel)).length;
  return {
    campaign_id: campaignId,
    email: { sent: email.reduce((sum, row) => sum + Number(row["sent"] ?? 0), 0), failed: email.reduce((sum, row) => sum + Number(row["failed"] ?? 0), 0), delivered: "unavailable", opens: "unavailable", clicks: eventCount("cta_click", "email") },
    push: { recipients: push.reduce((sum, row) => sum + Number(row["recipients"] ?? 0), 0), provider_acceptances: push.reduce((sum, row) => sum + Number(row["sent"] ?? 0), 0), delivered: "unavailable" },
    landing_page: { published: landing, visits: eventCount("visit", "landing_page"), cta_clicks: eventCount("cta_click", "landing_page") },
    website: { published_assets: website, cta_clicks: eventCount("cta_click", "website") },
    command_center: { published_announcements: announcements, cta_clicks: eventCount("cta_click", "command_center"), dismissals: eventCount("dismiss", "command_center") },
    conversions: "unavailable",
  };
}
