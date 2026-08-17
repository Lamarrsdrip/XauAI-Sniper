import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireGptAction } from "./gptEmailActions.js";
import {
  auditAdminAction,
  consumeAdminConfirmation,
  emailDeliverySummary,
  idempotentResult,
  issueAdminConfirmation,
  listTransactionalTemplates,
  replayData,
  requireActionPermission,
  releaseSummary,
  renderTransactional,
  sanitizeLicense,
  sanitizeOrder,
  sanitizeUser,
  saveIdempotentResult,
  transactionalTemplate,
  TransactionalTemplateDraftSchema,
  TransactionalTemplateIdSchema,
} from "../../services/adminOpsControl.js";
import { readinessSnapshot } from "../../services/readiness.js";
import { diagnosticByRequest, recentDiagnostics } from "../../services/diagnostics.js";
import { getSettings } from "../../services/settings.js";
import { fulfillNombaPayment, fulfillPayment } from "../../services/paymentFulfillment.js";
import { sendPinEmail } from "../../services/paymentEmails.js";
import {
  retryCanonicalTransactionalDelivery,
  sendPasswordResetEmailForUser,
  sendVerificationEmailForUser,
} from "../../services/accountRecovery.js";
import {
  buildSupportCaseContext,
  getCustomerClosedTrades,
  getCustomerOpenPositions,
  getCustomerPerformanceRange,
  getCustomerTradingHistory,
  getCustomerTradingSummary,
  resolveSupportLinks,
} from "../../services/customerTradingTelemetry.js";
import { currentEaRelease, loadEaReleaseManifest, verifyReleaseArtifact } from "../../services/releaseManifest.js";
import { getNotificationStatus } from "../../services/notifications.js";
import { sendWebPushToUser } from "../../services/webPush.js";
import { DestinationSchema, resolveDestination, WebsiteSlotSchema } from "../../services/marketingControl.js";
import { CustomEmailDraftSchema, draftDocument, liveTradingPerformanceSummary, resolveCustomEmailRecipients, saveCustomEmailDraft } from "../../services/adminCustomEmail.js";
import { deliverAdminCampaign } from "../../services/adminEmailCampaign.js";
import { xPostingSettings, xTradePostSnapshot, publishApprovedXTrade } from "../../services/xTradePosting.js";

const Id = z.string().min(1).max(160);
const Email = z.string().email().max(320);
const Limit = z.coerce.number().int().min(1).max(100).default(25);
const Confirm = z.object({ confirmation_token: z.string().min(20).max(300), idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/) }).strict();
const Reason = z.string().min(2).max(500);

const UserQueryOperation = z.enum(["search_users","get_user","get_account_access_status","get_active_session_summary"]);
const UserPrepareOperation = z.enum(["disable_user","enable_user","resend_verification_email","send_password_reset","revoke_sessions","unlock_user"]);
const LicenseQueryOperation = z.enum(["list_licenses","get_license","get_activation_summary","get_license_history"]);
const LicensePrepareOperation = z.enum(["transfer_license","deactivate_license","activate_license","reset_activation","resend_license_email"]);
const OrderQueryOperation = z.enum(["list_orders","get_order","failed_payments","recovery_status","refund_eligibility"]);
const OrderPrepareOperation = z.enum(["retry_fulfillment","resend_purchase_confirmation","issue_refund"]);
const EmailQueryOperation = z.enum(["list_templates","get_template","delivery_logs","get_delivery"]);
const EmailDraftOperation = z.enum(["save_template_draft","preview_template"]);
const EmailPrepareOperation = z.enum(["publish_template","rollback_template","retry_delivery"]);
const SupportQueryOperation = z.enum([
  "list_tickets","get_ticket","customer_context","prepare_case_response",
  "customer_trading_summary","customer_trading_history","customer_open_positions",
  "customer_closed_trades","customer_performance_range",
]);
const SupportDraftOperation = z.enum(["reply_draft","internal_note"]);
const SupportPrepareOperation = z.enum(["send_reply","close_ticket","reopen_ticket","assign_ticket"]);
const ContentQueryOperation = z.enum(["website_content","notifications","notification_status","notification_audience_count","live_announcement","landing_page"]);
const ContentDraftOperation = z.enum(["website_draft","notification_draft","replay_publication_draft"]);
const ContentPrepareOperation = z.enum(["publish_website","rollback_website","send_notification","publish_replay","unpublish_replay"]);
const ReplayReleaseQueryOperation = z.enum(["list_replays","get_replay","get_replay_trades","production_release","list_release_candidates","get_release_candidate","deployment_status"]);
const ReplayReleasePrepareOperation = z.enum(["promote_release","rollback_release"]);
const DiagnosticsOperation = z.enum(["system_health","service_status","integration_health","payment_provider_status","recent_errors","recent_warnings","audit_search","audit_event","dashboard_metrics","dashboard_metrics_range","compare_dashboard_periods","conversion_funnel","revenue_summary","license_summary","support_summary"]);

function cfg(action: string, permission: string) { return { config: { gptActionName: action, permission } }; }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function unavailable(operation: string, reason: string) { return { operation, available: false, unavailable_reason: reason }; }
function nowIso() { return new Date().toISOString(); }
function targetId(row: Record<string, unknown>): string { return String(row["id"] ?? row["pin"] ?? row["reference"] ?? ""); }

function structuredError(reply: FastifyReply, error: unknown) {
  const status = Number((error as { statusCode?: unknown })?.statusCode ?? (error instanceof z.ZodError ? 422 : 500));
  const code = status === 401 ? "unauthenticated" : status === 403 ? "unauthorized" : status === 404 ? "not_found" : status === 409 ? "state_conflict" : status === 422 ? "validation_problem" : status === 429 ? "rate_limited" : status === 503 ? "service_unavailable" : "operation_failed";
  const message = error instanceof z.ZodError ? "Request validation failed." : error instanceof Error ? error.message : "Operation failed.";
  return reply.code(status >= 400 && status < 600 ? status : 500).send({ error: code, message, request_id: reply.request.id, retryable: status === 429 || status === 503, ...(error instanceof z.ZodError ? { issues: error.issues.map(i => ({ path: i.path.join("."), message: i.message })) } : {}) });
}

async function findUser(input: { user_id?: string; email?: string }): Promise<Record<string, unknown> | null> {
  if (input.user_id) return getDb().collection("cloud_users").findOne({ id: input.user_id }, { projection: { _id: 0, password_hash: 0, reset_token: 0, session_token: 0 } }) as Promise<Record<string, unknown> | null>;
  if (input.email) return getDb().collection("cloud_users").findOne({ email: input.email.toLowerCase() }, { projection: { _id: 0, password_hash: 0, reset_token: 0, session_token: 0 } }) as Promise<Record<string, unknown> | null>;
  return null;
}

async function customer360(input: { user_id?: string; email?: string; order_id?: string; license_id?: string }): Promise<Record<string, unknown>> {
  const db = getDb();
  let email = input.email?.toLowerCase() ?? "";
  let user: Record<string, unknown> | null = null;
  let order: Record<string, unknown> | null = null;
  let license: Record<string, unknown> | null = null;

  if (input.user_id || email) user = await findUser({ user_id: input.user_id, email });
  if (input.order_id) order = await db.collection("payment_transactions").findOne({ reference: input.order_id }, { projection: { _id: 0 } }) as Record<string, unknown> | null;
  if (input.license_id) license = await db.collection("pin_licenses").findOne({ $or: [{ id: input.license_id }, { pin: input.license_id }] }, { projection: { _id: 0 } }) as Record<string, unknown> | null;

  email = email || String(user?.["email"] ?? order?.["buyer_email"] ?? license?.["buyer_email"] ?? "").toLowerCase();
  if (!user && email) user = await findUser({ email });
  if (!license && email) license = await db.collection("pin_licenses").findOne({ buyer_email: email }, { projection: { _id: 0 }, sort: { created_at: -1 } }) as Record<string, unknown> | null;

  if (!order && license) {
    const paymentRef = String(license["payment_ref"] ?? license["payment_reference"] ?? "").trim();
    if (paymentRef) order = await db.collection("payment_transactions").findOne({ reference: paymentRef }, { projection: { _id: 0 } }) as Record<string, unknown> | null;
    if (!order && license["pin"]) order = await db.collection("payment_transactions").findOne({ pin_generated: license["pin"] }, { projection: { _id: 0 } }) as Record<string, unknown> | null;
  }

  const recentOrders = email
    ? await db.collection("payment_transactions").find({ buyer_email: email }, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(20).toArray()
    : [];
  const tickets = email ? await db.collection("support_tickets").find({ customer_email: email }, { projection: { _id: 0, customer_private_notes: 0, internal_notes: 0 } }).sort({ updated_at: -1 }).limit(10).toArray() : [];
  const deliveries = email ? await db.collection("admin_email_log").find({ $or: [{ to: email }, { recipient: email }, { canonical_recipient: email }, { email }] }, { projection: { _id: 0, html: 0, document: 0 } }).sort({ at: -1, created_at: -1 }).limit(20).toArray() : [];
  const logins = email ? await db.collection("login_audit_log").find({ email, role: "cloud_user" }, { projection: { _id: 0, ip: 0 } }).sort({ ts: -1 }).limit(10).toArray() : [];
  const tradingSummary = await getCustomerTradingSummary({
    user_id: input.user_id,
    email: email || undefined,
    license_id: input.license_id,
    mt5_account: license?.["mt5_account"] ? String(license["mt5_account"]) : undefined,
  });

  return {
    user: user ? sanitizeUser(user) : null,
    account_access: user ? {
      status: user["disabled_at"] ? "DISABLED" : "ACTIVE",
      email_verified: Boolean(user["email_verified"] ?? user["verified"]),
      session_version: Number(user["session_version"] ?? 0),
      last_successful_login: logins.find(x => Boolean(x["ok"]) || String(x["result"] ?? x["status"] ?? "").toLowerCase().includes("success"))?.["ts"] ?? user["last_login_at"] ?? null,
    } : null,
    license: license ? sanitizeLicense(license) : null,
    order: order ? sanitizeOrder(order) : null,
    orders: recentOrders.map((r) => sanitizeOrder(r as Record<string, unknown>)),
    email_delivery: deliveries,
    support: { tickets },
    trading_summary: tradingSummary,
  };
}

async function orderRecovery(reference: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const order = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } }) as Record<string, unknown> | null;
  if (!order) throw Object.assign(new Error("Order not found."), { statusCode: 404 });
  const email = String(order["buyer_email"] ?? "").toLowerCase();
  const license = order["pin_generated"] ? await db.collection("pin_licenses").findOne({ pin: order["pin_generated"] }, { projection: { _id: 0 } }) : await db.collection("pin_licenses").findOne({ payment_ref: reference }, { projection: { _id: 0 } });
  const paymentStatus = String(order["payment_status"] ?? "").toUpperCase();
  const paid = ["SUCCESS","FULFILLED","PAID"].includes(paymentStatus) || Boolean(order["verified_paid_at"]);
  const refunded = ["REFUNDED","PARTIALLY_REFUNDED"].includes(String(order["refund_status"] ?? "").toUpperCase());
  return {
    order: sanitizeOrder(order), paid, refunded,
    fulfillment_complete: Boolean(order["pin_generated"] && license),
    license: license ? sanitizeLicense(license as Record<string, unknown>) : null,
    fulfillment_email_failed: Boolean(order["fulfillment_email_failed"]),
    recommended_action: paid && !refunded && !order["pin_generated"] ? "retry_fulfillment" : paid && order["pin_generated"] && order["fulfillment_email_failed"] ? "resend_license_email" : "none",
    customer_email: email,
  };
}

function capabilityRows() {
  const available = (id: string, readOnly: boolean, confirmation = false) => ({ operation: id, available: true, read_only: readOnly, requires_confirmation: confirmation });
  const no = (id: string, reason: string) => ({ operation: id, available: false, read_only: false, requires_confirmation: true, unavailable_reason: reason });
  return {
    users: [available("search_users",true),available("get_user",true),available("get_account_access_status",true),available("get_active_session_summary",true),available("disable_user",false,true),available("enable_user",false,true),available("resend_verification_email",false,true),available("send_password_reset",false,true),available("revoke_sessions",false,true),available("unlock_user",false,true)],
    licenses: [available("list_licenses",true),available("get_license",true),available("get_activation_summary",true),available("get_license_history",true),available("transfer_license",false,true),available("deactivate_license",false,true),available("activate_license",false,true),available("reset_activation",false,true),available("resend_license_email",false,true)],
    orders_payments: [available("list_orders",true),available("get_order",true),available("failed_payments",true),available("recovery_status",true),available("retry_fulfillment",false,true),no("issue_refund","Automated refunds are not exposed unless a verified provider refund API is implemented."),available("refund_eligibility",true),available("resend_purchase_confirmation",false,true)],
    transactional_email: [available("list_templates",true),available("get_template",true),available("delivery_logs",true),available("get_delivery",true),available("save_template_draft",false,false),available("preview_template",true),available("publish_template",false,true),available("rollback_template",false,true),available("retry_delivery",false,true)],
    custom_email: [available("create_custom_email_draft",false,false),available("preview_custom_email",true),available("send_custom_email_test",false,false),available("prepare_custom_email_send",false,true),available("send_custom_email",false,true)],
    marketing_email: [available("create_marketing_email_draft",false,false),available("preview_marketing_email",true),available("send_marketing_email_test",false,false),available("prepare_marketing_email_send",false,true),available("send_marketing_email",false,true),available("get_checkout_followup_audience",true)],
    x_posting: [available("get_x_posting_status",true),available("list_x_trade_posts",true),available("preview_x_trade_post",true),available("prepare_x_trade_post",false,true),available("send_x_trade_post",false,true),available("prepare_enable_x_auto_posting",false,true),available("enable_x_auto_posting",false,true),available("prepare_disable_x_auto_posting",false,true),available("disable_x_auto_posting",false,true)],
    support: [available("list_tickets",true),available("get_ticket",true),available("customer_context",true),available("prepare_case_response",true),available("customer_trading_summary",true),available("customer_trading_history",true),available("customer_open_positions",true),available("customer_closed_trades",true),available("customer_performance_range",true),available("reply_draft",false,false),available("internal_note",false,false),available("send_reply",false,true),available("close_ticket",false,true),available("reopen_ticket",false,true),available("assign_ticket",false,true)],
    content_notifications: [available("website_content",true),available("notifications",true),available("notification_status",true),available("notification_audience_count",true),available("website_draft",false,false),available("notification_draft",false,false),available("publish_website",false,true),available("rollback_website",false,true),available("send_notification",false,true),available("replay_publication_draft",false,false),available("publish_replay",false,true),available("unpublish_replay",false,true)],
    replays_releases: [available("list_replays",true),available("get_replay",true),available("get_replay_trades",true),available("production_release",true),available("list_release_candidates",true),available("get_release_candidate",true),available("deployment_status",true),no("promote_release","The current backend has release metadata/artifacts but no verified automated production-promotion primitive."),no("rollback_release","The current backend has no verified automated release rollback primitive.")],
    diagnostics_analytics: DiagnosticsOperation.options.map(id => available(id,true)),
  };
}

export async function registerAdminGatewayActionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireGptAction);
  app.addHook("onResponse", async (request, reply) => {
    const c = request.routeOptions.config as unknown as Record<string, unknown>;
    const action = String(c["gptActionName"] ?? request.routeOptions.url);
    try { await auditAdminAction(request, action, request.url.split("?",1)[0] ?? "", reply.statusCode < 400 ? "success" : "error", { status_code: reply.statusCode, permission: c["permission"] ?? "" }); } catch {}
  });

  app.get("/admin/actions/gateway/capabilities", cfg("getAdminCapabilities","admin.read"), async () => ({ model:"xaucloud_admin_gateway_v1", action_count:29, security:{ bearer:true, arbitrary_db:false, shell:false, filesystem:false, unrestricted_http:false, consequential_prepare_confirm_execute:true }, groups: capabilityRows() }));

  app.post("/admin/actions/gateway/customer360", cfg("getCustomer360","admin.read"), async (request, reply) => { try { requireActionPermission("admin.read"); const body=z.object({user_id:Id.optional(),email:Email.optional(),order_id:Id.optional(),license_id:Id.optional()}).refine(v=>Boolean(v.user_id||v.email||v.order_id||v.license_id),"Provide at least one identifier.").parse(request.body); return await customer360(body); } catch(e){return structuredError(reply,e);} });
  app.post("/admin/actions/gateway/customer-diagnose", cfg("diagnoseCustomerIssue","admin.read"), async (request, reply) => {
    try {
      requireActionPermission("admin.read");
      const body=z.object({user_id:Id.optional(),email:Email.optional(),order_id:Id.optional(),license_id:Id.optional()}).refine(v=>Boolean(v.user_id||v.email||v.order_id||v.license_id),"Provide at least one identifier.").parse(request.body);
      const view=await customer360(body);
      const access=view["account_access"] as Record<string,unknown>|null;
      const order=view["order"] as Record<string,unknown>|null;
      const license=view["license"] as Record<string,unknown>|null;
      const trading=view["trading_summary"] as Record<string,unknown>|null;
      let likely="NO_CLEAR_FAILURE";
      let confidence=0.35;
      let recommended="none";
      const evidence:string[]=[];
      const missing:string[]=[];

      if(access?.["status"]==="DISABLED"){likely="ACCOUNT_DISABLED";confidence=.99;recommended="review_account_status";evidence.push("account is disabled");}
      else if(access && access["email_verified"]===false){likely="EMAIL_UNVERIFIED";confidence=.9;recommended="resend_verification_email";evidence.push("email is not verified");}
      else if(license && license["active"]===false){likely="LICENSE_INACTIVE";confidence=.95;recommended="review_license";evidence.push("license is inactive");}
      else if(license && !license["mt5_account"]){likely="MT5_NOT_CONNECTED";confidence=.88;recommended="guide_mt5_connection";evidence.push("license has no MT5 account binding");}
      else if(trading && trading["available"]===false){likely="TRADING_TELEMETRY_UNAVAILABLE";confidence=.86;recommended="check_ea_heartbeat";evidence.push("no persisted account telemetry was found");}
      else if(order && ["SUCCESS","FULFILLED","PAID"].includes(String(order["payment_status"]??"").toUpperCase()) && !license){likely="PAYMENT_SUCCEEDED_FULFILLMENT_FAILED";confidence=.98;recommended="retry_fulfillment";evidence.push("payment succeeded but no license is linked");}
      else if(license && !order && ["legacy_migration","manual_admin","unknown_legacy"].includes(String(license["source_type"]??""))){likely="NO_ORDER_LEGACY_LICENSE";confidence=.8;recommended="none";evidence.push(`license source is ${String(license["source_type"]??"unknown_legacy")}`);}

      if(!license)missing.push("license");
      if(!order)missing.push("deterministically_linked_order");
      if(!trading?.["available"])missing.push("trading_telemetry");
      return { ...view, diagnosis:{ likely_issue:likely, confidence, evidence, missing_data:missing, recommended_safe_action:recommended, automatic_remediation:false } };
    } catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/users/query", cfg("queryUsers","admin.read"), async(request,reply)=>{
    try{
      requireActionPermission("admin.read");
      const body=z.object({operation:UserQueryOperation,q:z.string().max(320).optional(),user_id:Id.optional(),email:Email.optional(),status:z.enum(["active","disabled","all"]).optional().default("all"),limit:Limit.optional()}).parse(request.body);
      if(body.operation==="search_users"){
        const filter:Record<string,unknown>={};
        if(body.q)filter["$or"]=[{email:{$regex:escapeRegex(body.q),$options:"i"}},{full_name:{$regex:escapeRegex(body.q),$options:"i"}}];
        if(body.status==="active")filter["disabled_at"]={$exists:false};
        if(body.status==="disabled")filter["disabled_at"]={$exists:true};
        const rows=await getDb().collection("cloud_users").find(filter,{projection:{_id:0,password_hash:0,reset_token:0,session_token:0}}).sort({created_at:-1}).limit(body.limit??25).toArray();
        return{operation:body.operation,users:rows.map(r=>sanitizeUser(r as Record<string,unknown>))};
      }
      const user=await findUser({user_id:body.user_id,email:body.email});
      if(!user)return reply.code(404).send({error:"not_found",message:"User not found.",request_id:request.id,retryable:false});
      if(body.operation==="get_user")return{operation:body.operation,user:sanitizeUser(user)};
      if(body.operation==="get_active_session_summary")return{
        operation:body.operation,user_id:String(user["id"]??""),session_version:Number(user["session_version"]??0),
        active_session_count:null,last_login_at:user["last_login_at"]??null,
        note:"Cloud JWTs are stateless; token-version revocation is authoritative, so an exact active-token count is not persisted."
      };
      return{operation:body.operation,user_id:String(user["id"]??""),status:user["disabled_at"]?"DISABLED":"ACTIVE",email_verified:Boolean(user["email_verified"]??user["verified"]),session_revocation_available:true,session_version:Number(user["session_version"]??0),last_login_at:user["last_login_at"]??null};
    }catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/users/prepare", cfg("prepareUserAction","admin.users.write"), async(request,reply)=>{
    try{
      requireActionPermission("admin.users.write");
      const b=z.object({operation:UserPrepareOperation,user_id:Id,reason:Reason.optional()}).parse(request.body);
      const row=await getDb().collection("cloud_users").findOne({id:b.user_id},{projection:{_id:0,password_hash:0,reset_token:0,session_token:0}}) as Record<string,unknown>|null;
      if(!row)return reply.code(404).send({error:"not_found",message:"User not found.",request_id:request.id,retryable:false});
      const op=b.operation==="unlock_user"?"enable_user":b.operation;
      const snapshot={id:b.user_id,disabled_at:row["disabled_at"]??null,updated_at:row["updated_at"]??null,email_verified:Boolean(row["email_verified"]??row["verified"]),session_version:Number(row["session_version"]??0),reason:b.reason??""};
      return{operation:b.operation,target:sanitizeUser(row),...await issueAdminConfirmation("gateway_user",b.user_id,op,snapshot)};
    }catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/users/execute", cfg("executeUserAction","admin.users.write"), async(request,reply)=>{
    try{
      requireActionPermission("admin.users.write");
      const b=z.object({operation:UserPrepareOperation,user_id:Id,reason:Reason.optional()}).merge(Confirm).parse(request.body);
      const action=`gateway:${b.operation}`;
      const old=await idempotentResult(b.idempotency_key,action);if(old)return{...old,duplicate:true};
      const row=await getDb().collection("cloud_users").findOne({id:b.user_id},{projection:{_id:0,password_hash:0,reset_token:0,session_token:0}}) as Record<string,unknown>|null;
      if(!row)return reply.code(404).send({error:"not_found",message:"User not found.",request_id:request.id,retryable:false});
      const op=b.operation==="unlock_user"?"enable_user":b.operation;
      const snapshot={id:b.user_id,disabled_at:row["disabled_at"]??null,updated_at:row["updated_at"]??null,email_verified:Boolean(row["email_verified"]??row["verified"]),session_version:Number(row["session_version"]??0),reason:b.reason??""};
      await consumeAdminConfirmation(b.confirmation_token,"gateway_user",b.user_id,op,snapshot);
      const at=nowIso();
      let result:Record<string,unknown>;
      if(op==="disable_user"){
        await getDb().collection("cloud_users").updateOne({id:b.user_id},{$set:{disabled_at:at,disabled_reason:b.reason??"GPT Admin",updated_at:at},$inc:{session_version:1}});
        result={disabled:true,sessions_revoked:true};
      }else if(op==="enable_user"){
        await getDb().collection("cloud_users").updateOne({id:b.user_id},{$unset:{disabled_at:"",disabled_reason:""},$set:{updated_at:at}});
        result={enabled:true};
      }else if(op==="revoke_sessions"){
        await getDb().collection("cloud_users").updateOne({id:b.user_id},{$inc:{session_version:1},$set:{sessions_revoked_at:at,updated_at:at}});
        result={sessions_revoked:true};
      }else if(op==="resend_verification_email"){
        const sent=await sendVerificationEmailForUser(row,"chatgpt_admin");
        result={verification_delivery:sent};
      }else if(op==="send_password_reset"){
        const sent=await sendPasswordResetEmailForUser(row,"chatgpt_admin");
        result={password_reset_delivery:sent};
      }else{
        result={executed:false};
      }
      const final={operation:b.operation,user_id:b.user_id,executed:true,at,...result};
      await saveIdempotentResult(b.idempotency_key,action,final);
      return final;
    }catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/licenses/query", cfg("queryLicenses","admin.read"), async(request,reply)=>{try{requireActionPermission("admin.read");const b=z.object({operation:LicenseQueryOperation,q:z.string().max(320).optional(),license_id:Id.optional(),limit:Limit.optional()}).parse(request.body);if(b.operation==="list_licenses"){const f:Record<string,unknown>={};if(b.q)f["$or"]=[{buyer_email:{$regex:escapeRegex(b.q),$options:"i"}},{pin:{$regex:escapeRegex(b.q),$options:"i"}},{mt5_account:{$regex:escapeRegex(b.q),$options:"i"}}];const rows=await getDb().collection("pin_licenses").find(f,{projection:{_id:0}}).sort({created_at:-1}).limit(b.limit??25).toArray();return{licenses:rows.map(r=>sanitizeLicense(r as Record<string,unknown>))};}if(!b.license_id)throw new z.ZodError([{code:"custom",path:["license_id"],message:"license_id is required."}]);const row=await getDb().collection("pin_licenses").findOne({$or:[{id:b.license_id},{pin:b.license_id}]},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)return reply.code(404).send({error:"not_found",message:"License not found.",retryable:false});if(b.operation==="get_license")return{license:sanitizeLicense(row)};if(b.operation==="get_activation_summary")return{license_id:targetId(row),active:Boolean(row["is_active"]),used:Boolean(row["is_used"]),mt5_account:row["mt5_account"]?String(row["mt5_account"]):null,activated_at:row["activated_at"]??null,activation_tracking_available:Boolean(row["mt5_account"])};const history=await getDb().collection("admin_action_audit").find({target:{$regex:escapeRegex(targetId(row))}},{projection:{_id:0}}).sort({at:-1}).limit(100).toArray();return{license:sanitizeLicense(row),history};}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/licenses/prepare", cfg("prepareLicenseAction","admin.licenses.write"), async(request,reply)=>{try{requireActionPermission("admin.licenses.write");const b=z.object({operation:LicensePrepareOperation,license_id:Id,new_email:Email.optional(),reason:Reason.optional()}).parse(request.body);const row=await getDb().collection("pin_licenses").findOne({$or:[{id:b.license_id},{pin:b.license_id}]},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)return reply.code(404).send({error:"not_found",message:"License not found.",retryable:false});const target=targetId(row);const snapshot={operation:b.operation,active:row["is_active"],used:row["is_used"],mt5_account:row["mt5_account"]??null,buyer_email:row["buyer_email"],new_email:b.new_email?.toLowerCase()??null,reason:b.reason??""};return{operation:b.operation,license:sanitizeLicense(row),...await issueAdminConfirmation("gateway_license",target,b.operation,snapshot)};}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/licenses/execute", cfg("executeLicenseAction","admin.licenses.write"), async(request,reply)=>{try{requireActionPermission("admin.licenses.write");const b=z.object({operation:LicensePrepareOperation,license_id:Id,new_email:Email.optional(),reason:Reason.optional()}).merge(Confirm).parse(request.body);const action=`gateway:${b.operation}`;const old=await idempotentResult(b.idempotency_key,action);if(old)return{...old,duplicate:true};const row=await getDb().collection("pin_licenses").findOne({$or:[{id:b.license_id},{pin:b.license_id}]},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)return reply.code(404).send({error:"not_found",message:"License not found.",retryable:false});const target=targetId(row);const snapshot={operation:b.operation,active:row["is_active"],used:row["is_used"],mt5_account:row["mt5_account"]??null,buyer_email:row["buyer_email"],new_email:b.new_email?.toLowerCase()??null,reason:b.reason??""};await consumeAdminConfirmation(b.confirmation_token,"gateway_license",target,b.operation,snapshot);const at=nowIso();let result:Record<string,unknown>;if(b.operation==="transfer_license"){if(!b.new_email)throw Object.assign(new Error("new_email is required."),{statusCode:422});await getDb().collection("pin_licenses").updateOne({$or:[{id:b.license_id},{pin:b.license_id}]},{$set:{buyer_email:b.new_email.toLowerCase(),transferred_at:at,transfer_reason:b.reason??"GPT Admin"}});result={transferred:true,new_email:b.new_email.toLowerCase()};}else if(b.operation==="deactivate_license"){await getDb().collection("pin_licenses").updateOne({$or:[{id:b.license_id},{pin:b.license_id}]},{$set:{is_active:false,revoked_at:at,revoked_reason:b.reason??"GPT Admin"}});result={deactivated:true};}else if(b.operation==="activate_license"){await getDb().collection("pin_licenses").updateOne({$or:[{id:b.license_id},{pin:b.license_id}]},{$set:{is_active:true,reactivated_at:at},$unset:{revoked_at:"",revoked_reason:""}});result={activated:true};}else if(b.operation==="reset_activation"){await getDb().collection("pin_licenses").updateOne({$or:[{id:b.license_id},{pin:b.license_id}]},{$set:{is_used:false,activation_reset_at:at},$unset:{mt5_account:"",activated_at:""}});result={activation_reset:true};}else{const sent=await sendPinEmail(String(row["buyer_email"]??""),String(row["buyer_name"]??""),String(row["pin"]??""));result={resent:sent,recipient:String(row["buyer_email"]??"").replace(/^(.{2}).*(@.*)$/,"$1***$2")};}const final={operation:b.operation,license_id:target,executed:true,at,...result};await saveIdempotentResult(b.idempotency_key,action,final);return final;}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/orders/query", cfg("queryOrdersPayments","admin.orders.read"), async(request,reply)=>{try{requireActionPermission("admin.orders.read");const b=z.object({operation:OrderQueryOperation,q:z.string().max(320).optional(),order_id:Id.optional(),status:z.string().max(80).optional(),limit:Limit.optional()}).parse(request.body);if(b.operation==="list_orders"){const f:Record<string,unknown>={};if(b.q)f["$or"]=[{reference:{$regex:escapeRegex(b.q),$options:"i"}},{buyer_email:{$regex:escapeRegex(b.q),$options:"i"}},{buyer_name:{$regex:escapeRegex(b.q),$options:"i"}}];if(b.status)f["payment_status"]=b.status;const rows=await getDb().collection("payment_transactions").find(f,{projection:{_id:0}}).sort({created_at:-1}).limit(b.limit??25).toArray();return{orders:rows.map(r=>sanitizeOrder(r as Record<string,unknown>))};}if(b.operation==="failed_payments"){const rows=await getDb().collection("payment_transactions").find({payment_status:{$nin:["success","FULFILLED","PAID"]}},{projection:{_id:0}}).sort({created_at:-1}).limit(b.limit??25).toArray();return{payments:rows.map(r=>sanitizeOrder(r as Record<string,unknown>))};}if(!b.order_id)throw Object.assign(new Error("order_id is required."),{statusCode:422});if(b.operation==="recovery_status")return await orderRecovery(b.order_id);const row=await getDb().collection("payment_transactions").findOne({reference:b.order_id},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)return reply.code(404).send({error:"not_found",message:"Order not found.",retryable:false});if(b.operation==="get_order")return{order:sanitizeOrder(row),refund_status:row["refund_status"]??"not_recorded"};const paid=["SUCCESS","FULFILLED","PAID"].includes(String(row["payment_status"]??"").toUpperCase());const already=Number(row["refunded_amount_kobo"]??0);const max=Math.max(0,Number(row["amount_kobo"]??0)-already);return{operation:"refund_eligibility",available:false,provider:String(row["provider"]??""),paid,already_refunded_minor:already,maximum_refundable_minor:max,currency:String(row["currency"]??"NGN"),reason:"No verified automated refund primitive is exposed by this backend. Status/eligibility only."};}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/orders/prepare", cfg("prepareOrderPaymentAction","admin.payments.write"), async(request,reply)=>{try{requireActionPermission("admin.payments.write");const b=z.object({operation:OrderPrepareOperation,order_id:Id,amount_minor:z.number().int().positive().optional(),reason:Reason.optional()}).parse(request.body);if(b.operation==="issue_refund")return reply.code(404).send(unavailable(b.operation,"No verified provider refund API is exposed by the current backend."));const recovery=await orderRecovery(b.order_id);if(b.operation==="retry_fulfillment" && (!recovery["paid"]||recovery["refunded"]||recovery["fulfillment_complete"]))throw Object.assign(new Error("Order is not eligible for fulfillment retry."),{statusCode:409});const snapshot={operation:b.operation,order_id:b.order_id,recovery};return{operation:b.operation,summary:recovery,...await issueAdminConfirmation("gateway_order",b.order_id,b.operation,snapshot)};}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/orders/execute", cfg("executeOrderPaymentAction","admin.payments.write"), async(request,reply)=>{try{requireActionPermission("admin.payments.write");const b=z.object({operation:OrderPrepareOperation,order_id:Id,amount_minor:z.number().int().positive().optional(),reason:Reason.optional()}).merge(Confirm).parse(request.body);if(b.operation==="issue_refund")return reply.code(404).send(unavailable(b.operation,"No verified provider refund API is exposed by the current backend."));const action=`gateway:${b.operation}`;const old=await idempotentResult(b.idempotency_key,action);if(old)return{...old,duplicate:true};const recovery=await orderRecovery(b.order_id);const snapshot={operation:b.operation,order_id:b.order_id,recovery};await consumeAdminConfirmation(b.confirmation_token,"gateway_order",b.order_id,b.operation,snapshot);let result:Record<string,unknown>;if(b.operation==="retry_fulfillment"){if(!recovery["paid"]||recovery["refunded"]||recovery["fulfillment_complete"])throw Object.assign(new Error("Order is no longer eligible for fulfillment retry."),{statusCode:409});const order=(await getDb().collection("payment_transactions").findOne({reference:b.order_id},{projection:{_id:0}})) as Record<string,unknown>;const provider=String(order["provider"]??"").toLowerCase();const r=provider.includes("nomba")?await fulfillNombaPayment(b.order_id,"chatgpt_admin_recovery"):await fulfillPayment(b.order_id,"chatgpt_admin_recovery");result={fulfillment:r};}else{const order=(await getDb().collection("payment_transactions").findOne({reference:b.order_id},{projection:{_id:0}})) as Record<string,unknown>|null;if(!order)return reply.code(404).send({error:"not_found",message:"Order not found.",retryable:false});if(order["pin_generated"]){const sent=await sendPinEmail(String(order["buyer_email"]??""),String(order["buyer_name"]??""),String(order["pin_generated"]));result={resent_license_delivery:sent};}else result={sent:false,note:"No license exists yet; retry fulfillment first."};}const final={operation:b.operation,order_id:b.order_id,executed:true,...result};await saveIdempotentResult(b.idempotency_key,action,final);return final;}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/email/query", cfg("queryTransactionalEmail","admin.email.read"), async(request,reply)=>{try{requireActionPermission("admin.email.read");const b=z.object({operation:EmailQueryOperation,template_id:TransactionalTemplateIdSchema.optional(),delivery_id:Id.optional(),limit:z.number().int().min(1).max(500).optional().default(100)}).parse(request.body);if(b.operation==="list_templates")return{templates:await listTransactionalTemplates()};if(b.operation==="get_template"){if(!b.template_id)throw Object.assign(new Error("template_id is required."),{statusCode:422});return await transactionalTemplate(b.template_id);}if(b.operation==="delivery_logs")return await emailDeliverySummary(b.limit);if(!b.delivery_id)throw Object.assign(new Error("delivery_id is required."),{statusCode:422});const row=await getDb().collection("admin_email_log").findOne({$or:[{id:b.delivery_id},{campaign_id:b.delivery_id}]},{projection:{_id:0,html:0,document:0}});if(!row)return reply.code(404).send({error:"not_found",message:"Email delivery record not found.",retryable:false});return{delivery:row};}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/email/draft", cfg("manageTransactionalEmailDraft","admin.email.write"), async(request,reply)=>{try{const b=z.object({operation:EmailDraftOperation,template_id:TransactionalTemplateIdSchema,subject:z.string().min(1).max(300).optional(),preheader:z.string().max(300).optional(),document:z.unknown().optional(),sample_context:z.record(z.string(),z.string().max(1000)).optional().default({})}).parse(request.body);if(b.operation==="save_template_draft"){requireActionPermission("admin.email.write");const parsed=TransactionalTemplateDraftSchema.parse({template_id:b.template_id,subject:b.subject,preheader:b.preheader??"",document:b.document});const at=nowIso();await getDb().collection("transactional_email_templates").updateOne({template_id:b.template_id},{$set:{template_id:b.template_id,draft_subject:parsed.subject,draft_preheader:parsed.preheader,draft_document:parsed.document,updated_at:at,updated_by:"chatgpt_action"},$setOnInsert:{created_at:at}},{upsert:true});return{template_id:b.template_id,status:"draft",updated_at:at};}requireActionPermission("admin.email.read");const row=await getDb().collection("transactional_email_templates").findOne({template_id:b.template_id},{projection:{_id:0}});if(!row?.["draft_document"]&&!row?.["published_document"])return reply.code(404).send({error:"not_found",message:"No structured draft or published override exists.",retryable:false});return await renderTransactional((row["draft_document"]??row["published_document"]) as never,String(row["draft_subject"]??row["published_subject"]??"XauCloud"),String(row["draft_preheader"]??row["published_preheader"]??""),b.sample_context);}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/email/prepare", cfg("prepareTransactionalEmailAction","admin.email.publish"), async(request,reply)=>{
    try{
      requireActionPermission("admin.email.publish");
      const b=z.object({operation:EmailPrepareOperation,template_id:TransactionalTemplateIdSchema.optional(),delivery_id:Id.optional()}).parse(request.body);
      if(b.operation==="retry_delivery"){
        if(!b.delivery_id)throw Object.assign(new Error("delivery_id is required."),{statusCode:422});
        const row=await getDb().collection("admin_email_log").findOne({$or:[{id:b.delivery_id},{delivery_id:b.delivery_id}]},{projection:{_id:0,html:0,document:0}});
        if(!row)return reply.code(404).send({error:"not_found",message:"Email delivery record not found.",request_id:request.id,retryable:false});
        if(row["canonical_retryable"]!==true)return reply.code(409).send({error:"state_conflict",message:"This delivery does not have a canonical replay reference.",request_id:request.id,retryable:false});
        const snapshot={delivery_id:b.delivery_id,template_id:row["template_id"],related_user_id:row["related_user_id"],status:row["status"]};
        return{operation:b.operation,delivery:{id:b.delivery_id,template_id:row["template_id"],recipient:row["canonical_recipient"],status:row["status"]},...await issueAdminConfirmation("gateway_email",b.delivery_id,b.operation,snapshot)};
      }
      if(!b.template_id)throw Object.assign(new Error("template_id is required."),{statusCode:422});
      const row=await getDb().collection("transactional_email_templates").findOne({template_id:b.template_id},{projection:{_id:0}});
      if(!row)return reply.code(404).send({error:"not_found",message:"Template not found.",request_id:request.id,retryable:false});
      let snapshot:Record<string,unknown>;
      if(b.operation==="publish_template"){
        if(!row["draft_document"])throw Object.assign(new Error("Template draft not found."),{statusCode:404});
        snapshot={template_id:b.template_id,subject:row["draft_subject"],preheader:row["draft_preheader"],document:row["draft_document"],updated_at:row["updated_at"]};
      }else{
        const versions=await getDb().collection("transactional_email_template_versions").find({template_id:b.template_id},{projection:{_id:0}}).sort({version:-1}).limit(2).toArray();
        if(versions.length<2)throw Object.assign(new Error("No prior published version exists."),{statusCode:404});
        snapshot={template_id:b.template_id,target_version:versions[1]?.["version"],document:versions[1]?.["document"]};
      }
      return{operation:b.operation,template_id:b.template_id,...await issueAdminConfirmation("gateway_email",b.template_id,b.operation,snapshot)};
    }catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/email/execute", cfg("executeTransactionalEmailAction","admin.email.publish"), async(request,reply)=>{
    try{
      requireActionPermission("admin.email.publish");
      const b=z.object({operation:EmailPrepareOperation,template_id:TransactionalTemplateIdSchema.optional(),delivery_id:Id.optional()}).merge(Confirm).parse(request.body);
      const action=`gateway:${b.operation}`;
      const old=await idempotentResult(b.idempotency_key,action);if(old)return{...old,duplicate:true};
      if(b.operation==="retry_delivery"){
        if(!b.delivery_id)throw Object.assign(new Error("delivery_id is required."),{statusCode:422});
        const row=await getDb().collection("admin_email_log").findOne({$or:[{id:b.delivery_id},{delivery_id:b.delivery_id}]},{projection:{_id:0,html:0,document:0}});
        if(!row)return reply.code(404).send({error:"not_found",message:"Email delivery record not found.",request_id:request.id,retryable:false});
        const snapshot={delivery_id:b.delivery_id,template_id:row["template_id"],related_user_id:row["related_user_id"],status:row["status"]};
        await consumeAdminConfirmation(b.confirmation_token,"gateway_email",b.delivery_id,b.operation,snapshot);
        const replay=await retryCanonicalTransactionalDelivery(b.delivery_id);
        const final={operation:b.operation,delivery_id:b.delivery_id,executed:true,replay};
        await saveIdempotentResult(b.idempotency_key,action,final);
        return final;
      }
      if(!b.template_id)throw Object.assign(new Error("template_id is required."),{statusCode:422});
      const row=await getDb().collection("transactional_email_templates").findOne({template_id:b.template_id},{projection:{_id:0}}) as Record<string,unknown>|null;
      if(!row)return reply.code(404).send({error:"not_found",message:"Template not found.",request_id:request.id,retryable:false});
      let result:Record<string,unknown>;
      if(b.operation==="publish_template"){
        const snapshot={template_id:b.template_id,subject:row["draft_subject"],preheader:row["draft_preheader"],document:row["draft_document"],updated_at:row["updated_at"]};
        await consumeAdminConfirmation(b.confirmation_token,"gateway_email",b.template_id,b.operation,snapshot);
        const version=Number(row["published_version"]??0)+1;
        await getDb().collection("transactional_email_template_versions").insertOne({id:`tx-template-${randomUUID()}`,template_id:b.template_id,version,subject:row["draft_subject"],preheader:row["draft_preheader"],document:row["draft_document"],published_at:nowIso(),source:"chatgpt_action"});
        await getDb().collection("transactional_email_templates").updateOne({template_id:b.template_id},{$set:{published_version:version,published_subject:row["draft_subject"],published_preheader:row["draft_preheader"],published_document:row["draft_document"],published_at:nowIso()}});
        result={published:true,version};
      }else{
        const versions=await getDb().collection("transactional_email_template_versions").find({template_id:b.template_id},{projection:{_id:0}}).sort({version:-1}).limit(2).toArray();
        if(versions.length<2)throw Object.assign(new Error("No prior published version exists."),{statusCode:404});
        const target=versions[1]!;
        const snapshot={template_id:b.template_id,target_version:target["version"],document:target["document"]};
        await consumeAdminConfirmation(b.confirmation_token,"gateway_email",b.template_id,b.operation,snapshot);
        await getDb().collection("transactional_email_templates").updateOne({template_id:b.template_id},{$set:{published_version:target["version"],published_subject:target["subject"],published_preheader:target["preheader"],published_document:target["document"],published_at:nowIso()}});
        result={rolled_back:true,version:target["version"]};
      }
      const final={operation:b.operation,template_id:b.template_id,executed:true,...result};
      await saveIdempotentResult(b.idempotency_key,action,final);
      return final;
    }catch(e){return structuredError(reply,e);}
  });

  const customDraftInput = z.object({ kind: z.enum(["custom", "marketing"]).optional(), draft_id: Id.optional(), test_to: Email.optional(), title: z.string().optional(), subject: z.string().optional(), preheader: z.string().optional(), recipient_mode: z.enum(["single","selected","registered_users","active_customers","active_license_holders","eligible_prospects","pending_checkout"]).optional(), to: Email.optional(), selected_recipients: z.array(Email).max(250).optional(), document: z.unknown().optional(), campaign_id: Id.optional(), reference_id: Id.optional() });
  const customSendInput = z.object({ draft_id: Id, operation: z.enum(["send", "test"]), test_to: Email.optional() });
  app.post("/admin/actions/gateway/custom-email/draft", cfg("manageCustomEmailDraft","admin.email.write"), async(request,reply)=>{try{
    const b=customDraftInput.extend({operation:z.enum(["create","preview","checkout_audience","live_performance"])}).parse(request.body); requireActionPermission(b.operation==="preview"||b.operation==="checkout_audience"||b.operation==="live_performance"?"admin.email.read":"admin.email.write");
    if(b.operation==="live_performance")return await liveTradingPerformanceSummary();
    if(b.operation==="checkout_audience"){const recipients=await resolveCustomEmailRecipients({recipient_mode:"pending_checkout",selected_recipients:[]});return{audience:"pending_checkout",recipient_count:recipients.length,warnings:["Server-resolved; paid, fulfilled, cancelled and known-buyer addresses are excluded." ]};}
    if(b.operation==="create"){const draft=CustomEmailDraftSchema.parse({title:b.title,subject:b.subject,preheader:b.preheader??"",recipient_mode:b.recipient_mode,to:b.to,selected_recipients:b.selected_recipients??[],document:b.document,campaign_id:b.campaign_id,reference_id:b.reference_id});const row=await saveCustomEmailDraft(draft,b.kind??"custom");return{draft_id:row["id"],status:"draft",recipient_mode:draft.recipient_mode};}
    if(!b.draft_id)throw Object.assign(new Error("draft_id is required."),{statusCode:422});const row=await getDb().collection("admin_custom_email_drafts").findOne({id:b.draft_id},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)return reply.code(404).send({error:"not_found",message:"Custom email draft not found.",request_id:request.id,retryable:false});
    const recipients=await resolveCustomEmailRecipients({recipient_mode:row["recipient_mode"] as never,to:row["to"] as string|undefined,selected_recipients:(row["selected_recipients"] as string[]??[])});const document=draftDocument(row);const rendered=(await import("../../services/emailCampaign.js")).renderEmailCampaign(document,{previewText:String(row["preheader"]??"")},await (await import("../../services/emailBranding.js")).emailBranding(),recipients[0]??{});return{draft_id:b.draft_id,subject:row["subject"],recipient_count:recipients.length,html:rendered.html,text:rendered.text};
  }catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/custom-email/prepare", cfg("prepareCustomEmailSend","admin.email.publish"), async(request,reply)=>{try{const b=customSendInput.parse(request.body);requireActionPermission("admin.email.publish");if(b.operation==="test"&&!b.test_to)throw Object.assign(new Error("test_to is required for a test send."),{statusCode:422});const row=await getDb().collection("admin_custom_email_drafts").findOne({id:b.draft_id},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)return reply.code(404).send({error:"not_found",message:"Custom email draft not found.",request_id:request.id,retryable:false});const recipients=b.operation==="test"?[{account_email:Email.parse(b.test_to)}]:await resolveCustomEmailRecipients({recipient_mode:row["recipient_mode"] as never,to:row["to"] as string|undefined,selected_recipients:(row["selected_recipients"] as string[]??[])});const snapshot={draft_id:b.draft_id,kind:row["kind"],subject:row["subject"],recipients:recipients.map(x=>x.account_email),test:b.operation==="test"};return{operation:b.operation,draft_id:b.draft_id,recipient_count:recipients.length,warnings:b.operation==="test"?["Test send only; campaign audience is untouched."]:[],...await issueAdminConfirmation("custom_email",b.draft_id,b.operation,snapshot)};}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/custom-email/execute", cfg("sendCustomEmail","admin.email.publish"), async(request,reply)=>{try{const b=customSendInput.merge(Confirm).parse(request.body);requireActionPermission("admin.email.publish");if(b.operation==="test"&&!b.test_to)throw Object.assign(new Error("test_to is required for a test send."),{statusCode:422});const action=`custom_email:${b.operation}`;const old=await idempotentResult(b.idempotency_key,action);if(old)return{...old,duplicate:true};const row=await getDb().collection("admin_custom_email_drafts").findOne({id:b.draft_id},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)throw Object.assign(new Error("Custom email draft not found."),{statusCode:404});const recipients=b.operation==="test"?[{account_email:Email.parse(b.test_to)}]:await resolveCustomEmailRecipients({recipient_mode:row["recipient_mode"] as never,to:row["to"] as string|undefined,selected_recipients:(row["selected_recipients"] as string[]??[])});const snapshot={draft_id:b.draft_id,kind:row["kind"],subject:row["subject"],recipients:recipients.map(x=>x.account_email),test:b.operation==="test"};await consumeAdminConfirmation(b.confirmation_token,"custom_email",b.draft_id,b.operation,snapshot);const outcome=await deliverAdminCampaign({req:{subject:String(row["subject"]),preview_text:String(row["preheader"]??""),document:draftDocument(row),audience:"selected",selected_recipients:[]},actorEmail:"chatgpt-action@xaucloud.internal",actorName:"XauCloud Admin",source:"chatgpt_action",draftId:b.draft_id,recipients,idempotencyKey:b.idempotency_key,reserveHistoryBeforeDelivery:true});const result={draft_id:b.draft_id,test:b.operation==="test",delivery:outcome.record};await saveIdempotentResult(b.idempotency_key,action,result);return result;}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/x-posting/query", cfg("queryXPosting","admin.notifications.write"), async(request,reply)=>{try{requireActionPermission("admin.notifications.write");const b=z.object({operation:z.enum(["status","list","preview"]),closed_trade_id:Id.optional(),limit:Limit.optional()}).parse(request.body);if(b.operation==="status")return await xPostingSettings();if(b.operation==="list")return{posts:await getDb().collection("x_trade_posts").find({},{projection:{_id:0,trade:0}}).sort({created_at:-1}).limit(b.limit??25).toArray()};if(!b.closed_trade_id)throw Object.assign(new Error("closed_trade_id is required."),{statusCode:422});const trade=await getDb().collection("trade_journal").findOne({$or:[{trade_identity:b.closed_trade_id},{id:b.closed_trade_id}]},{projection:{_id:0}}) as Record<string,unknown>|null;if(!trade)return reply.code(404).send({error:"not_found",message:"Closed trade not found.",request_id:request.id,retryable:false});return xTradePostSnapshot(trade);}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/x-posting/prepare", cfg("prepareXTradePost","admin.notifications.write"), async(request,reply)=>{try{requireActionPermission("admin.notifications.write");const b=z.object({operation:z.enum(["post_trade","enable_auto","disable_auto"]),closed_trade_id:Id.optional()}).parse(request.body);const settings=await xPostingSettings();let snapshot:Record<string,unknown>={operation:b.operation,auto_post_enabled:settings["auto_post_enabled"]};if(b.operation==="post_trade"){if(!b.closed_trade_id)throw Object.assign(new Error("closed_trade_id is required."),{statusCode:422});const trade=await getDb().collection("trade_journal").findOne({$or:[{trade_identity:b.closed_trade_id},{id:b.closed_trade_id}]},{projection:{_id:0}}) as Record<string,unknown>|null;if(!trade)throw Object.assign(new Error("Closed trade not found."),{statusCode:404});snapshot={...snapshot,...xTradePostSnapshot(trade)};}return{...snapshot,...await issueAdminConfirmation("x_posting",b.closed_trade_id??"trade_posts",b.operation,snapshot)};}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/x-posting/execute", cfg("executeXTradePost","admin.notifications.write"), async(request,reply)=>{try{requireActionPermission("admin.notifications.write");const b=z.object({operation:z.enum(["post_trade","enable_auto","disable_auto"]),closed_trade_id:Id.optional()}).merge(Confirm).parse(request.body);const action=`x_posting:${b.operation}`;const old=await idempotentResult(b.idempotency_key,action);if(old)return{...old,duplicate:true};const settings=await xPostingSettings();let snapshot:Record<string,unknown>={operation:b.operation,auto_post_enabled:settings["auto_post_enabled"]};let result:Record<string,unknown>;if(b.operation==="post_trade"){if(!b.closed_trade_id)throw Object.assign(new Error("closed_trade_id is required."),{statusCode:422});const trade=await getDb().collection("trade_journal").findOne({$or:[{trade_identity:b.closed_trade_id},{id:b.closed_trade_id}]},{projection:{_id:0}}) as Record<string,unknown>|null;if(!trade)throw Object.assign(new Error("Closed trade not found."),{statusCode:404});snapshot={...snapshot,...xTradePostSnapshot(trade)};await consumeAdminConfirmation(b.confirmation_token,"x_posting",b.closed_trade_id,b.operation,snapshot);result=await publishApprovedXTrade(trade);}else{await consumeAdminConfirmation(b.confirmation_token,"x_posting","trade_posts",b.operation,snapshot);await getDb().collection("x_posting_settings").updateOne({id:"trade_posts"},{$set:{id:"trade_posts",auto_post_enabled:b.operation==="enable_auto",post_wins:true,post_losses:true,post_breakeven:false,last_auto_post_at:null,updated_at:nowIso()}},{upsert:true});result={auto_post_enabled:b.operation==="enable_auto"};}await saveIdempotentResult(b.idempotency_key,action,result);return result;}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/support/query", cfg("querySupport","admin.read"), async(request,reply)=>{
    try{
      requireActionPermission("admin.read");
      const b=z.object({
        operation:SupportQueryOperation,ticket_id:Id.optional(),email:Email.optional(),user_id:Id.optional(),license_id:Id.optional(),mt5_account:Id.optional(),
        from:z.string().datetime().optional(),to:z.string().datetime().optional(),offset:z.number().int().min(0).optional().default(0),limit:Limit.optional()
      }).parse(request.body);

      if(b.operation==="list_tickets"){
        const rows=await getDb().collection("support_tickets").find({},{projection:{_id:0,customer_private_notes:0,internal_notes:0}}).sort({updated_at:-1}).limit(b.limit??25).toArray();
        const enriched=[];
        for(const row of rows){
          const links=await resolveSupportLinks({user_id:String(row["customer_user_id"]??"")||undefined,email:String(row["customer_email"]??"")||undefined});
          enriched.push({...row,related_license_ids:links["related_license_ids"],related_order_ids:links["related_order_ids"],related_email_delivery_ids:links["related_email_delivery_ids"]});
        }
        return{available:enriched.length>0,tickets:enriched,note:enriched.length?undefined:"No support ticket records currently exist."};
      }

      if(b.operation==="prepare_case_response"){
        if(!b.ticket_id)throw Object.assign(new Error("ticket_id is required."),{statusCode:422});
        return await buildSupportCaseContext(b.ticket_id);
      }

      const lookup={user_id:b.user_id,email:b.email,license_id:b.license_id,mt5_account:b.mt5_account,from:b.from,to:b.to,offset:b.offset,limit:b.limit};
      if(b.operation==="customer_trading_summary")return await getCustomerTradingSummary(lookup);
      if(b.operation==="customer_trading_history")return await getCustomerTradingHistory(lookup);
      if(b.operation==="customer_open_positions")return await getCustomerOpenPositions(lookup);
      if(b.operation==="customer_closed_trades")return await getCustomerClosedTrades(lookup);
      if(b.operation==="customer_performance_range")return await getCustomerPerformanceRange(lookup);

      if(b.operation==="customer_context"){
        if(!b.email&&!b.user_id&&!b.license_id)throw Object.assign(new Error("email, user_id or license_id is required."),{statusCode:422});
        return await customer360({email:b.email,user_id:b.user_id,license_id:b.license_id});
      }
      if(!b.ticket_id)throw Object.assign(new Error("ticket_id is required."),{statusCode:422});
      return await buildSupportCaseContext(b.ticket_id);
    }catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/support/draft", cfg("manageSupportDraft","admin.support.write"), async(request,reply)=>{
    try{
      requireActionPermission("admin.support.write");
      const b=z.object({operation:SupportDraftOperation,ticket_id:Id,body:z.string().min(1).max(10000)}).parse(request.body);
      const ticket=await getDb().collection("support_tickets").findOne({id:b.ticket_id},{projection:{_id:0}});
      if(!ticket)return reply.code(404).send({error:"not_found",message:"Support ticket not found.",request_id:request.id,retryable:false});
      if(b.operation==="internal_note"){
        const note={id:`support-note-${randomUUID()}`,body:b.body,created_at:nowIso(),source:"chatgpt_action"};
        await getDb().collection("support_tickets").updateOne({id:b.ticket_id},{$push:{internal_notes:note as never},$set:{updated_at:nowIso()}});
        await getDb().collection("support_ticket_events").insertOne({id:`support-event-${randomUUID()}`,ticket_id:b.ticket_id,event:"internal_note",at:nowIso(),source:"chatgpt_action"});
        return{ticket_id:b.ticket_id,note_added:true,note_id:note.id};
      }
      const draft={id:`support-draft-${randomUUID()}`,ticket_id:b.ticket_id,body:b.body,status:"draft",created_at:nowIso(),source:"chatgpt_action"};
      await getDb().collection("support_reply_drafts").insertOne(draft);
      return draft;
    }catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/support/prepare", cfg("prepareSupportAction","admin.support.write"), async(request,reply)=>{
    try{
      requireActionPermission("admin.support.write");
      const b=z.object({operation:SupportPrepareOperation,ticket_id:Id,draft_id:Id.optional(),assignee:z.string().max(160).optional()}).parse(request.body);
      const ticket=await getDb().collection("support_tickets").findOne({id:b.ticket_id},{projection:{_id:0}}) as Record<string,unknown>|null;
      if(!ticket)return reply.code(404).send({error:"not_found",message:"Support ticket not found.",request_id:request.id,retryable:false});
      let draft:null|Record<string,unknown>=null;
      if(b.operation==="send_reply"){
        if(!b.draft_id)throw Object.assign(new Error("draft_id is required."),{statusCode:422});
        draft=await getDb().collection("support_reply_drafts").findOne({id:b.draft_id,ticket_id:b.ticket_id},{projection:{_id:0}}) as Record<string,unknown>|null;
        if(!draft)throw Object.assign(new Error("Reply draft not found."),{statusCode:404});
      }
      const snapshot={operation:b.operation,ticket_id:b.ticket_id,status:ticket["status"]??null,updated_at:ticket["updated_at"]??null,draft_id:b.draft_id??null,draft_body:draft?.["body"]??null,assignee:b.assignee??null};
      return{operation:b.operation,ticket:{id:b.ticket_id,email:ticket["customer_email"]??ticket["email"]??null,subject:ticket["subject"]??null,status:ticket["status"]??null},draft:draft?{id:draft["id"],body:draft["body"]}:null,transport:b.operation==="send_reply"?"command_center_thread":null,...await issueAdminConfirmation("gateway_support",b.ticket_id,b.operation,snapshot)};
    }catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/support/execute", cfg("executeSupportAction","admin.support.write"), async(request,reply)=>{
    try{
      requireActionPermission("admin.support.write");
      const b=z.object({operation:SupportPrepareOperation,ticket_id:Id,draft_id:Id.optional(),assignee:z.string().max(160).optional()}).merge(Confirm).parse(request.body);
      const action=`gateway:${b.operation}`;
      const old=await idempotentResult(b.idempotency_key,action);if(old)return{...old,duplicate:true};
      const ticket=await getDb().collection("support_tickets").findOne({id:b.ticket_id},{projection:{_id:0}}) as Record<string,unknown>|null;
      if(!ticket)return reply.code(404).send({error:"not_found",message:"Support ticket not found.",request_id:request.id,retryable:false});
      let draft:null|Record<string,unknown>=null;
      if(b.operation==="send_reply"){
        if(!b.draft_id)throw Object.assign(new Error("draft_id is required."),{statusCode:422});
        draft=await getDb().collection("support_reply_drafts").findOne({id:b.draft_id,ticket_id:b.ticket_id},{projection:{_id:0}}) as Record<string,unknown>|null;
        if(!draft)throw Object.assign(new Error("Reply draft not found."),{statusCode:404});
      }
      const snapshot={operation:b.operation,ticket_id:b.ticket_id,status:ticket["status"]??null,updated_at:ticket["updated_at"]??null,draft_id:b.draft_id??null,draft_body:draft?.["body"]??null,assignee:b.assignee??null};
      await consumeAdminConfirmation(b.confirmation_token,"gateway_support",b.ticket_id,b.operation,snapshot);
      let result:Record<string,unknown>;

      if(b.operation==="send_reply"){
        const at=nowIso();
        const body=String(draft?.["body"]??"");
        const message={id:`msg-${randomUUID()}`,author_type:"support",body,created_at:at};
        await getDb().collection("support_tickets").updateOne(
          {id:b.ticket_id},
          {$push:{messages:message as never},$set:{status:"open",updated_at:at}}
        );
        await getDb().collection("support_reply_drafts").updateOne({id:b.draft_id},{$set:{status:"sent",sent_at:at,transport:"command_center_thread"}});
        await getDb().collection("support_ticket_events").insertOne({id:`support-event-${randomUUID()}`,ticket_id:b.ticket_id,event:"support_reply",message_id:message.id,at,source:"chatgpt_action"});
        result={sent:true,transport:"command_center_thread",message_id:message.id,email_sent:false};
      }else if(b.operation==="close_ticket"){
        await getDb().collection("support_tickets").updateOne({id:b.ticket_id},{$set:{status:"closed",closed_at:nowIso(),updated_at:nowIso()}});
        result={closed:true};
      }else if(b.operation==="reopen_ticket"){
        await getDb().collection("support_tickets").updateOne({id:b.ticket_id},{$set:{status:"open",updated_at:nowIso()},$unset:{closed_at:""}});
        result={reopened:true};
      }else{
        await getDb().collection("support_tickets").updateOne({id:b.ticket_id},{$set:{assigned_admin:b.assignee??"",updated_at:nowIso()}});
        result={assigned:true,assignee:b.assignee??""};
      }
      const final={operation:b.operation,ticket_id:b.ticket_id,executed:true,...result};
      await saveIdempotentResult(b.idempotency_key,action,final);
      return final;
    }catch(e){return structuredError(reply,e);}
  });

  app.post("/admin/actions/gateway/content/query", cfg("queryContentAndNotifications","admin.read"), async(request,reply)=>{try{requireActionPermission("admin.read");const b=z.object({operation:ContentQueryOperation,user_id:Id.optional(),audience:z.enum(["all_authenticated_users","existing_customers","active_customers"]).optional(),resource_id:Id.optional(),limit:Limit.optional()}).parse(request.body);if(b.operation==="website_content"){const [assets,ann]=await Promise.all([getDb().collection("marketing_website_assets").find({status:"published"},{projection:{_id:0}}).toArray(),getDb().collection("marketing_announcements").find({status:"published"},{projection:{_id:0}}).sort({published_at:-1}).limit(20).toArray()]);return{website_assets:assets,announcements:ann};}if(b.operation==="notifications"){const rows=await getDb().collection("cloud_notification_log").find({},{projection:{_id:0}}).sort({scheduled_time:-1}).limit(b.limit??25).toArray();return{notifications:rows};}if(b.operation==="notification_status"){if(!b.user_id)throw Object.assign(new Error("user_id is required."),{statusCode:422});return await getNotificationStatus(b.user_id);}if(b.operation==="notification_audience_count"){const audience=b.audience??"all_authenticated_users";let filter:Record<string,unknown>={active:{$ne:false},opted_in:true};const subs=await getDb().collection("web_push_subscriptions").find(filter,{projection:{_id:0,user_id:1}}).toArray();let ids=[...new Set(subs.map(x=>String(x["user_id"]??"")).filter(Boolean))];if(audience!=="all_authenticated_users"){const users=await getDb().collection("cloud_users").find({id:{$in:ids}},{projection:{_id:0,id:1,email:1}}).toArray();const emails=users.map(x=>String(x["email"]??"").toLowerCase());const licenses=await getDb().collection("pin_licenses").find({buyer_email:{$in:emails},...(audience==="active_customers"?{is_active:true}:{})},{projection:{_id:0,buyer_email:1}}).toArray();const allowed=new Set(licenses.map(x=>String(x["buyer_email"]??"").toLowerCase()));ids=users.filter(x=>allowed.has(String(x["email"]??"").toLowerCase())).map(x=>String(x["id"]??""));}return{audience,recipient_count:ids.length,rule:"Authorized opted-in push recipients only."};}if(b.operation==="live_announcement")return{announcements:await getDb().collection("marketing_announcements").find({status:"published"},{projection:{_id:0}}).sort({published_at:-1}).limit(20).toArray()};if(!b.resource_id)throw Object.assign(new Error("resource_id is required."),{statusCode:422});const row=await getDb().collection("marketing_landing_pages").findOne({$or:[{id:b.resource_id},{slug:b.resource_id}]},{projection:{_id:0}});if(!row)return reply.code(404).send({error:"not_found",message:"Landing page not found.",retryable:false});return{landing_page:row};}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/content/draft", cfg("manageContentDraft","admin.notifications.write"), async(request,reply)=>{try{const b=z.object({operation:ContentDraftOperation,title:z.string().max(160).optional(),body:z.string().max(4000).optional(),slot:WebsiteSlotSchema.optional(),audience:z.enum(["all_authenticated_users","existing_customers","active_customers"]).optional(),destination:DestinationSchema.optional(),replay_id:Id.optional(),content:z.record(z.string(),z.unknown()).optional()}).parse(request.body);const at=nowIso();if(b.operation==="website_draft"){requireActionPermission("admin.notifications.write");if(!b.slot||!b.title)throw Object.assign(new Error("slot and title are required."),{statusCode:422});const row={id:`gateway-web-${randomUUID()}`,slot:b.slot,title:b.title,body:b.body??"",content:b.content??{},status:"draft",source:"chatgpt_action",created_at:at,updated_at:at};await getDb().collection("marketing_website_assets").insertOne(row);return row;}if(b.operation==="notification_draft"){requireActionPermission("admin.notifications.write");if(!b.title||!b.body)throw Object.assign(new Error("title and body are required."),{statusCode:422});const row={id:`gateway-push-${randomUUID()}`,title:b.title,body:b.body,audience:b.audience??"all_authenticated_users",destination:b.destination??"command_center",status:"draft",source:"chatgpt_action",created_at:at,updated_at:at};await getDb().collection("marketing_push_drafts").insertOne(row);return row;}requireActionPermission("admin.read");const d=await replayData();if((b.replay_id??"current-30-day-gold-replay")!=="current-30-day-gold-replay")return reply.code(404).send({error:"not_found",message:"Replay not found in approved registry.",retryable:false});const row={id:`gateway-replay-pub-${randomUUID()}`,replay_id:"current-30-day-gold-replay",meta:d["meta"],summary:d["summary"],status:"draft",historical:true,guaranteed:false,created_at:at,source:"chatgpt_action"};await getDb().collection("replay_publication_drafts").insertOne(row);return row;}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/content/prepare", cfg("prepareContentAction","admin.notifications.write"), async(request,reply)=>{try{requireActionPermission("admin.notifications.write");const b=z.object({operation:ContentPrepareOperation,resource_id:Id}).parse(request.body);let collection="";if(["publish_website","rollback_website"].includes(b.operation))collection="marketing_website_assets";else if(b.operation==="send_notification")collection="marketing_push_drafts";else collection="replay_publication_drafts";const row=await getDb().collection(collection).findOne({id:b.resource_id},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)return reply.code(404).send({error:"not_found",message:"Draft/resource not found.",retryable:false});let extra:Record<string,unknown>={};if(b.operation==="send_notification"){const audience=String(row["audience"]??"all_authenticated_users");const subs=await getDb().collection("web_push_subscriptions").find({active:{$ne:false},opted_in:true},{projection:{_id:0,user_id:1}}).toArray();extra={audience,recipient_count:new Set(subs.map(x=>String(x["user_id"]??"")).filter(Boolean)).size,deep_link:await resolveDestination(DestinationSchema.parse(row["destination"]??"command_center"),undefined,"push")};}return{operation:b.operation,resource:row,...extra,...await issueAdminConfirmation("gateway_content",b.resource_id,b.operation,row)};}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/content/execute", cfg("executeContentAction","admin.notifications.write"), async(request,reply)=>{try{requireActionPermission("admin.notifications.write");const b=z.object({operation:ContentPrepareOperation,resource_id:Id}).merge(Confirm).parse(request.body);const action=`gateway:${b.operation}`;const old=await idempotentResult(b.idempotency_key,action);if(old)return{...old,duplicate:true};let collection="";if(["publish_website","rollback_website"].includes(b.operation))collection="marketing_website_assets";else if(b.operation==="send_notification")collection="marketing_push_drafts";else collection="replay_publication_drafts";const row=await getDb().collection(collection).findOne({id:b.resource_id},{projection:{_id:0}}) as Record<string,unknown>|null;if(!row)return reply.code(404).send({error:"not_found",message:"Draft/resource not found.",retryable:false});await consumeAdminConfirmation(b.confirmation_token,"gateway_content",b.resource_id,b.operation,row);let result:Record<string,unknown>;if(b.operation==="publish_website"){await getDb().collection(collection).updateMany({slot:row["slot"],status:"published"},{$set:{status:"superseded",superseded_at:nowIso()}});await getDb().collection(collection).updateOne({id:b.resource_id},{$set:{status:"published",published_at:nowIso()}});result={published:true};}else if(b.operation==="rollback_website"){const previous=await getDb().collection(collection).find({slot:row["slot"],id:{$ne:b.resource_id},status:{$in:["superseded","published"]}},{projection:{_id:0}}).sort({published_at:-1}).limit(1).toArray();if(!previous[0])throw Object.assign(new Error("No prior website version exists."),{statusCode:404});await getDb().collection(collection).updateOne({id:b.resource_id},{$set:{status:"rolled_back",rolled_back_at:nowIso()}});await getDb().collection(collection).updateOne({id:previous[0]["id"]},{$set:{status:"published",published_at:nowIso()}});result={rolled_back:true,restored_id:previous[0]["id"]};}else if(b.operation==="send_notification"){const subs=await getDb().collection("web_push_subscriptions").find({active:{$ne:false},opted_in:true},{projection:{_id:0,user_id:1}}).toArray();const userIds=[...new Set(subs.map(x=>String(x["user_id"]??"")).filter(Boolean))];const deepLink=await resolveDestination(DestinationSchema.parse(row["destination"]??"command_center"),undefined,"push");let sent=0;for(const userId of userIds)sent+=await sendWebPushToUser(userId,{title:String(row["title"]??"XauCloud"),body:String(row["body"]??""),deep_link:deepLink,category:"MARKETING",tag:`gateway-${b.resource_id}`});const sentAt=nowIso();
await getDb().collection(collection).updateOne({id:b.resource_id},{$set:{status:"sent",sent_at:sentAt,sent_count:sent}});
await getDb().collection("cloud_notification_log").insertOne({
  id:`notification-${randomUUID()}`,source_draft_id:b.resource_id,title:row["title"],body:row["body"],audience:row["audience"],
  destination:row["destination"],recipient_count:userIds.length,sent_count:sent,status:"sent",scheduled_time:sentAt,sent_at:sentAt,source:"chatgpt_action"
});
result={sent,recipient_count:userIds.length};}else if(b.operation==="publish_replay"){await getDb().collection(collection).updateOne({id:b.resource_id},{$set:{status:"published",published_at:nowIso()}});result={published:true,historical:true,guaranteed:false};}else{await getDb().collection(collection).updateOne({id:b.resource_id},{$set:{status:"unpublished",unpublished_at:nowIso()}});result={unpublished:true};}const final={operation:b.operation,resource_id:b.resource_id,executed:true,...result};await saveIdempotentResult(b.idempotency_key,action,final);return final;}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/replays-releases/query", cfg("queryReplaysReleases","admin.read"), async(request,reply)=>{try{requireActionPermission("admin.read");const b=z.object({operation:ReplayReleaseQueryOperation,replay_id:Id.optional(),version:Id.optional(),offset:z.number().int().min(0).optional().default(0),limit:z.number().int().min(1).max(100).optional().default(50)}).parse(request.body);if(b.operation==="list_replays"){const d=await replayData();return{replays:[{id:"current-30-day-gold-replay",meta:d["meta"],summary:d["summary"],historical:true,guaranteed:false}]};}if(b.operation==="get_replay"||b.operation==="get_replay_trades"){const id=b.replay_id??"current-30-day-gold-replay";if(id!=="current-30-day-gold-replay")return reply.code(404).send({error:"not_found",message:"Replay not found.",retryable:false});const d=await replayData();if(b.operation==="get_replay")return{id,meta:d["meta"],summary:d["summary"],historical:true,guaranteed:false};const trades=(d["trades"] as Record<string,unknown>[]??[]).map((t,i)=>({trade_id:String(i+1),trade_number:i+1,symbol:String((d["meta"] as Record<string,unknown>)?.["symbol"]??"XAUUSD"),side:t["direction"],entry_time:t["open_time"],exit_time:t["close_time"],entry_price:t["entry_price"],exit_price:t["exit_price"],stop_loss:t["stop_loss"]??null,take_profit:t["take_profit"]??null,result:t["result"],profit_loss_usd:t["profit_usd"],pips:t["pips"],setup_label:t["setup"]??t["pattern"]??null,replay_id:id,historical:true}));return{total:trades.length,trades:trades.slice(b.offset,b.offset+b.limit),historical:true,guaranteed:false};}if(b.operation==="production_release")return await releaseSummary();const manifest=await loadEaReleaseManifest();if(b.operation==="list_release_candidates")return{current_version:manifest.current_version,candidates:Object.entries(manifest.releases??{}).map(([version,r])=>({version,...(r as Record<string,unknown>)}))};if(b.operation==="get_release_candidate"){if(!b.version)throw Object.assign(new Error("version is required."),{statusCode:422});const rel=manifest.releases?.[b.version];if(!rel)return reply.code(404).send({error:"not_found",message:"Release candidate not found.",retryable:false});return{version:b.version,release:rel,artifact_check:await verifyReleaseArtifact(b.version,rel)};}const current=await currentEaRelease();return{ready:readinessSnapshot().state==="READY",current_release:current??null,automated_promotion_available:false};}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/replays-releases/prepare", cfg("prepareReplayReleaseAction","admin.releases.write"), async(request,reply)=>{try{requireActionPermission("admin.releases.write");const b=z.object({operation:ReplayReleasePrepareOperation,version:Id}).parse(request.body);return reply.code(404).send(unavailable(b.operation,"No verified automated production promotion/rollback primitive exists. Read-only release diagnostics remain available."));}catch(e){return structuredError(reply,e);}});
  app.post("/admin/actions/gateway/replays-releases/execute", cfg("executeReplayReleaseAction","admin.releases.write"), async(request,reply)=>{try{requireActionPermission("admin.releases.write");const b=z.object({operation:ReplayReleasePrepareOperation,version:Id}).merge(Confirm).parse(request.body);return reply.code(404).send(unavailable(b.operation,"No verified automated production promotion/rollback primitive exists. Execution is intentionally unavailable."));}catch(e){return structuredError(reply,e);}});

  app.post("/admin/actions/gateway/diagnostics/query", cfg("queryDiagnosticsAuditAnalytics","admin.system.read"), async(request,reply)=>{try{const b=z.object({operation:DiagnosticsOperation,limit:z.number().int().min(1).max(200).optional().default(50),id:Id.optional(),email:Email.optional(),user_id:Id.optional(),license_id:Id.optional(),order_id:Id.optional(),ticket_id:Id.optional(),from:z.string().datetime().optional(),to:z.string().datetime().optional()}).parse(request.body);if(["dashboard_metrics","dashboard_metrics_range","compare_dashboard_periods","conversion_funnel","revenue_summary","license_summary","support_summary"].includes(b.operation))requireActionPermission("admin.analytics.read");else requireActionPermission("admin.system.read");const db=getDb();if(b.operation==="system_health")return{readiness:readinessSnapshot(),database:await db.command({ping:1}),time:nowIso()};if(b.operation==="recent_errors")return{errors:recentDiagnostics("error",b.limit)};if(b.operation==="recent_warnings")return{warnings:recentDiagnostics("warning",b.limit)};if(b.operation==="service_status")return{readiness:readinessSnapshot(),node:process.version,started_at:readinessSnapshot().initialized_at,release:await releaseSummary()};if(b.operation==="integration_health"){const s=await getSettings();return{database:readinessSnapshot().dependencies["database"],email:{configured:Boolean(s["smtp_email"]&&s["smtp_password"])},push:{configured:Boolean(s["vapid_public_key"]||s["onesignal_app_id"])},payments:{paystack_configured:Boolean(s["paystack_secret_key"]),nomba_configured:Boolean(s["nomba_client_id"]&&s["nomba_client_secret"])}};}
if(b.operation==="payment_provider_status"){
  const s=await getSettings();
  const providers=[["PAYSTACK",Boolean(s["paystack_secret_key"])],["NOMBA",Boolean(s["nomba_client_id"]&&s["nomba_client_secret"])] ] as const;
  const out=[];
  for(const [provider,configured] of providers){
    const lastSuccess=await db.collection("payment_transactions").findOne({provider,payment_status:{$in:["SUCCESS","FULFILLED","PAID"]}},{projection:{_id:0,reference:1,updated_at:1,created_at:1},sort:{updated_at:-1,created_at:-1}});
    const recentFailureCount=await db.collection("payment_transactions").countDocuments({provider,payment_status:{$in:["FAILED","ERROR"]}});
    out.push({provider,configured,healthy:configured&&recentFailureCount===0,last_successful_event:lastSuccess?.["updated_at"]??lastSuccess?.["created_at"]??null,recent_failure_count:recentFailureCount,sanitized_error:null,health_basis:"configuration + persisted payment events; no provider secrets or live credential probe"});
  }
  return{providers:out};
}if(b.operation==="audit_event"){if(!b.id)throw Object.assign(new Error("id is required."),{statusCode:422});const row=await db.collection("admin_action_audit").findOne({$or:[{id:b.id},{request_id:b.id},{correlation_id:b.id}]},{projection:{_id:0}});return{event:row??null};}if(b.operation==="audit_search"){const f:Record<string,unknown>={};const ors:Record<string,unknown>[]=[];if(b.user_id)ors.push({target:{$regex:escapeRegex(b.user_id)}});if(b.license_id)ors.push({target:{$regex:escapeRegex(b.license_id)}});if(b.order_id)ors.push({target:{$regex:escapeRegex(b.order_id)}});if(b.ticket_id)ors.push({target:{$regex:escapeRegex(b.ticket_id)}});if(b.email)ors.push({"detail.email":b.email.toLowerCase()});if(ors.length)f["$or"]=ors;if(b.from||b.to)f["at"]={...(b.from?{$gte:b.from}:{}),...(b.to?{$lte:b.to}:{})};return{events:await db.collection("admin_action_audit").find(f,{projection:{_id:0}}).sort({at:-1}).limit(b.limit).toArray()};}const dateFilter:Record<string,unknown>={};if(b.from||b.to)dateFilter["created_at"]={...(b.from?{$gte:b.from}:{}),...(b.to?{$lte:b.to}:{})};const [users,licenses,activeLicenses,orders,revenueRows,tickets]=await Promise.all([db.collection("cloud_users").countDocuments(dateFilter),db.collection("pin_licenses").countDocuments(dateFilter),db.collection("pin_licenses").countDocuments({...dateFilter,is_active:true}),db.collection("payment_transactions").countDocuments(dateFilter),db.collection("payment_transactions").aggregate([{$match:{...dateFilter,payment_status:{$in:["success","FULFILLED","PAID"]}}},{$group:{_id:null,total:{$sum:"$amount_kobo"}}}]).toArray(),db.collection("support_tickets").countDocuments(dateFilter)]);const base={registrations:users,licenses:{total:licenses,active:activeLicenses},orders,revenue:{currency:"NGN",amount_minor:Number(revenueRows[0]?.["total"]??0),amount:Number(revenueRows[0]?.["total"]??0)/100},support:{tickets}};if(b.operation==="dashboard_metrics"||b.operation==="dashboard_metrics_range")return base;if(b.operation==="compare_dashboard_periods")return{current:base,note:"Pass explicit from/to for a bounded current period. Automatic previous-period derivation is intentionally not guessed."};if(b.operation==="conversion_funnel")return{registrations:users,orders,fulfilled_licenses:activeLicenses,registration_to_order_rate:users?orders/users:0,order_to_active_license_rate:orders?activeLicenses/orders:0};if(b.operation==="revenue_summary")return base.revenue;if(b.operation==="license_summary")return base.licenses;return base.support;}catch(e){return structuredError(reply,e);}});

  app.get("/admin/actions/gateway/request-trace/:id", cfg("getRequestTrace","admin.system.read"), async(request,reply)=>{try{requireActionPermission("admin.system.read");const id=z.object({id:Id}).parse(request.params).id;const [audit,emailAudit,marketingAudit,requestTrace]=await Promise.all([getDb().collection("admin_action_audit").find({$or:[{request_id:id},{correlation_id:id}]},{projection:{_id:0}}).limit(50).toArray(),getDb().collection("admin_email_action_audit").find({request_id:id},{projection:{_id:0}}).limit(50).toArray(),getDb().collection("marketing_action_audit").find({request_id:id},{projection:{_id:0}}).limit(50).toArray(),getDb().collection("admin_action_request_trace").find({$or:[{request_id:id},{correlation_id:id}]},{projection:{_id:0}}).limit(50).toArray()]);return{correlation_id:id,diagnostics:diagnosticByRequest(id),audit,email_audit:emailAudit,marketing_audit:marketingAudit,request_trace:requestTrace};}catch(e){return structuredError(reply,e);}});
}
