/**
 * Academy certificate issuance -- server-authoritative, idempotent per
 * (user_id, curriculum_version). The PDF is generated on demand from the
 * persisted record (name, id, completion date) rather than storing PDF
 * bytes; this repo has no existing blob/object storage, and re-rendering a
 * few KB of vector PDF per request is cheap and avoids adding one just for
 * this feature.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { emailBranding, emailLinkButton } from "./emailBranding.js";
import { sendEmail } from "./email.js";
import { publishedTransactionalRender } from "./adminOpsControl.js";
import { getAcademyProgress } from "./academyProgress.js";
import { CURRICULUM_VERSION } from "./academyCurriculum.js";

export type CertificateStatus = "valid" | "revoked";

export interface AcademyCertificateDoc {
  certificate_id: string;
  user_id: string;
  program: "forex_academy";
  curriculum_version: string;
  recipient_name: string;
  completed_at: string;
  issued_at: string;
  status: CertificateStatus;
  revoked_at?: string;
  revoked_reason?: string;
}

/** Non-guessable, non-sequential: 8 bytes of CSPRNG output, base32-ish alphanumeric. No user-count leakage. */
function generateCertificateId(): string {
  const raw = randomBytes(8).toString("base64url").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
  return `XC-ACADEMY-${raw}`;
}

export function certificateVerifyUrl(certificateId: string): string {
  return `${env.PUBLIC_SITE_URL}/verify-certificate/${certificateId}`;
}

export interface CertificateStatusResult {
  eligible: boolean;
  issued: boolean;
  needs_name: boolean;
  certificate?: Pick<AcademyCertificateDoc, "certificate_id" | "recipient_name" | "completed_at" | "issued_at" | "status">;
  completed_count: number;
  required_count: number;
}

export async function getCertificateStatus(userId: string): Promise<CertificateStatusResult> {
  const [progress, existing] = await Promise.all([
    getAcademyProgress(userId),
    getDb().collection("academy_certificates").findOne({ user_id: userId, curriculum_version: CURRICULUM_VERSION }, { projection: { _id: 0 } }),
  ]);
  if (existing) {
    return {
      eligible: true, issued: true, needs_name: false,
      certificate: existing as unknown as CertificateStatusResult["certificate"],
      completed_count: progress.completed_count, required_count: progress.required_count,
    };
  }
  if (!progress.is_complete) {
    return { eligible: false, issued: false, needs_name: false, completed_count: progress.completed_count, required_count: progress.required_count };
  }
  const user = await getDb().collection("cloud_users").findOne({ id: userId }, { projection: { _id: 0, full_name: 1 } });
  const hasName = Boolean(String(user?.["full_name"] ?? "").trim());
  return { eligible: true, issued: false, needs_name: !hasName, completed_count: progress.completed_count, required_count: progress.required_count };
}

/**
 * Issues once per (user_id, curriculum_version), server-verified at the
 * moment of the call -- never trusts that a prior eligibility check is still
 * true. A unique index on {user_id, curriculum_version} makes a racing
 * duplicate call a no-op (caught via Mongo's E11000, matching the pattern
 * already used by admin_ops_idempotency / transactional_email_events
 * elsewhere in this codebase) rather than a second certificate.
 */
export async function issueCertificateIfEligible(userId: string, recipientNameOverride?: string): Promise<{ issued: boolean; certificate: AcademyCertificateDoc }> {
  const db = getDb();
  const existing = await db.collection("academy_certificates").findOne({ user_id: userId, curriculum_version: CURRICULUM_VERSION }, { projection: { _id: 0 } });
  if (existing) return { issued: false, certificate: existing as unknown as AcademyCertificateDoc };

  const progress = await getAcademyProgress(userId);
  if (!progress.is_complete) throw Object.assign(new Error("Academy curriculum is not yet complete."), { statusCode: 409 });

  const user = await db.collection("cloud_users").findOne({ id: userId }, { projection: { _id: 0, full_name: 1, email: 1 } });
  const recipientName = (recipientNameOverride?.trim() || String(user?.["full_name"] ?? "").trim());
  if (!recipientName) throw Object.assign(new Error("A name is required before a certificate can be issued."), { statusCode: 422 });

  const now = new Date().toISOString();
  const doc: AcademyCertificateDoc = {
    certificate_id: generateCertificateId(),
    user_id: userId,
    program: "forex_academy",
    curriculum_version: CURRICULUM_VERSION,
    recipient_name: recipientName,
    completed_at: now,
    issued_at: now,
    status: "valid",
  };

  try {
    await db.collection("academy_certificates").insertOne({ id: randomUUID(), ...doc });
  } catch (error) {
    // E11000 on the unique {user_id, curriculum_version} index: another
    // concurrent request already issued it. Return that one, not a second.
    if (Number((error as { code?: unknown })?.code) === 11000) {
      const winner = await db.collection("academy_certificates").findOne({ user_id: userId, curriculum_version: CURRICULUM_VERSION }, { projection: { _id: 0 } });
      return { issued: false, certificate: winner as unknown as AcademyCertificateDoc };
    }
    throw error;
  }

  if (recipientNameOverride?.trim() && !String(user?.["full_name"] ?? "").trim()) {
    // Persist the confirmed certificate name back onto the account only when
    // the account had none at all -- never silently overwrite an existing name.
    await db.collection("cloud_users").updateOne({ id: userId }, { $set: { full_name: recipientNameOverride.trim() } });
  }

  const buyerEmail = String(user?.["email"] ?? "");
  if (buyerEmail) await sendAcademyCertificateEmail(buyerEmail, recipientName, doc);

  return { issued: true, certificate: doc };
}

async function sendAcademyCertificateEmail(toEmail: string, recipientName: string, cert: AcademyCertificateDoc): Promise<boolean> {
  const b = await emailBranding();
  const verifyUrl = certificateVerifyUrl(cert.certificate_id);
  const viewUrl = `${b.command_center_url}?academy_certificate=1`;
  const vars = {
    buyer_name: recipientName, first_name: recipientName, buyer_email: toEmail, account_email: toEmail,
    certificate_name: recipientName, certificate_id: cert.certificate_id, completion_date: new Date(cert.completed_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    verify_url: verifyUrl, view_url: viewUrl,
  };
  const override = await publishedTransactionalRender("academy_certificate_issued", vars);
  if (override) return sendEmail(toEmail, String(override["subject"]), String(override["html"]), { text: String(override["text"] ?? "") });
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
<h2 style="color:#B8860B;">🏆 You've completed the XauCloud Forex Academy</h2>
<p>Hi ${recipientName || "Trader"},</p>
<p>Congratulations — you've completed the XauCloud Forex Academy.</p>
<p>Your Certificate of Completion has been issued in your name:</p>
<div style="background:#f5f5f5;border:2px solid #B8860B;padding:16px;margin:16px 0;font-size:14px;">
<p style="margin:4px 0;"><strong>Name:</strong> ${recipientName}</p>
<p style="margin:4px 0;"><strong>Completed:</strong> ${vars.completion_date}</p>
<p style="margin:4px 0;"><strong>Certificate ID:</strong> ${cert.certificate_id}</p>
</div>
<div style="text-align:center;margin:20px 0;">${emailLinkButton("View Certificate", viewUrl, true)}</div>
<p style="font-size:12px;color:#6E6E73;">You can also verify your certificate online using its unique certificate ID or the QR code printed on the certificate: <a href="${verifyUrl}" style="color:#B8860B;">${verifyUrl}</a></p>
<p style="font-size:13px;">Congratulations on completing the Academy.</p>
<p style="font-size:13px;color:#333;">XauCloud — Built for Gold.</p>
</div>`;
  return sendEmail(toEmail, "🏆 You've completed the XauCloud Forex Academy", html);
}

export interface PublicCertificateView {
  program: "XauCloud Forex Academy";
  title: "Certificate of Completion";
  recipient_name: string;
  completed_at: string;
  certificate_id: string;
  status: CertificateStatus;
}

/** Public verification: deliberately returns ONLY the fields the spec allows -- no email, user id, account, payment, or license data. */
export async function verifyCertificatePublic(certificateId: string): Promise<PublicCertificateView | null> {
  const row = await getDb().collection("academy_certificates").findOne({ certificate_id: certificateId }, { projection: { _id: 0, recipient_name: 1, completed_at: 1, certificate_id: 1, status: 1 } });
  if (!row) return null;
  return {
    program: "XauCloud Forex Academy",
    title: "Certificate of Completion",
    recipient_name: String(row["recipient_name"] ?? ""),
    completed_at: String(row["completed_at"] ?? ""),
    certificate_id: String(row["certificate_id"] ?? ""),
    status: (row["status"] as CertificateStatus) ?? "valid",
  };
}

export async function getOwnCertificate(userId: string): Promise<AcademyCertificateDoc | null> {
  const row = await getDb().collection("academy_certificates").findOne({ user_id: userId, curriculum_version: CURRICULUM_VERSION }, { projection: { _id: 0 } });
  return row as unknown as AcademyCertificateDoc | null;
}

export async function getCertificateById(certificateId: string): Promise<AcademyCertificateDoc | null> {
  const row = await getDb().collection("academy_certificates").findOne({ certificate_id: certificateId }, { projection: { _id: 0 } });
  return row as unknown as AcademyCertificateDoc | null;
}

export async function adminListCertificates(limit = 100): Promise<AcademyCertificateDoc[]> {
  const rows = await getDb().collection("academy_certificates").find({}, { projection: { _id: 0 } }).sort({ issued_at: -1 }).limit(Math.min(limit, 500)).toArray();
  return rows as unknown as AcademyCertificateDoc[];
}

export async function adminRevokeCertificate(certificateId: string, reason: string): Promise<boolean> {
  const r = await getDb().collection("academy_certificates").updateOne(
    { certificate_id: certificateId, status: "valid" },
    { $set: { status: "revoked", revoked_at: new Date().toISOString(), revoked_reason: reason } },
  );
  return r.modifiedCount === 1;
}

export async function ensureAcademyInfrastructure(): Promise<void> {
  const db = getDb();
  await Promise.all([
    db.collection("academy_certificates").createIndex({ user_id: 1, curriculum_version: 1 }, { unique: true }),
    db.collection("academy_certificates").createIndex({ certificate_id: 1 }, { unique: true }),
    db.collection("academy_progress").createIndex({ user_id: 1, curriculum_version: 1 }, { unique: true }),
  ]);
}
