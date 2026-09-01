/**
 * Per-course certificate issuance for the new catalog (academyCatalog.ts) --
 * parallel to, and deliberately independent from, academyCertificates.ts's
 * v1 "forex_academy" certificate. Shares the same academy_certificates
 * Mongo collection (its unique index is {user_id, curriculum_version}, and
 * every course certificate uses a distinct "course:<courseId>" version
 * string, so it can never collide with "v1" or with another course) and the
 * same renderCertificatePdf template, but is issued/looked-up/revoked
 * through its own functions here so the v1 certificate code path is never
 * touched by anything in this file.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { emailBranding, emailLinkButton } from "./emailBranding.js";
import { sendEmail } from "./email.js";
import { publishedTransactionalRender } from "./adminOpsControl.js";
import { findCourse, type Course } from "./academyCatalog.js";
import { getCourseProgress } from "./academyCourseProgress.js";
import type { CertificateStatus } from "./academyCertificates.js";

export interface CourseCertificateDoc {
  certificate_id: string;
  user_id: string;
  program: string; // "course:<courseId>"
  curriculum_version: string; // "course:<courseId>" -- same value, kept distinct fields for clarity at read sites
  course_id: string;
  course_title: string;
  recipient_name: string;
  completed_at: string;
  issued_at: string;
  status: CertificateStatus;
  revoked_at?: string;
  revoked_reason?: string;
}

function courseVersionKey(courseId: string): string {
  return `course:${courseId}`;
}

function generateCertificateId(): string {
  const raw = randomBytes(8).toString("base64url").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
  return `XC-ACADEMY-${raw}`;
}

export function courseCertificateVerifyUrl(certificateId: string): string {
  return `${env.PUBLIC_SITE_URL}/verify-certificate/${certificateId}`;
}

export interface CourseCertificateStatusResult {
  eligible: boolean;
  issued: boolean;
  needs_name: boolean;
  certificate?: Pick<CourseCertificateDoc, "certificate_id" | "recipient_name" | "completed_at" | "issued_at" | "status" | "course_id" | "course_title">;
  progress_pct: number;
}

export async function getCourseCertificateStatus(userId: string, courseId: string): Promise<CourseCertificateStatusResult | null> {
  const course = findCourse(courseId);
  if (!course || !course.certificateEligible) return null;
  const versionKey = courseVersionKey(courseId);
  const [progress, existing] = await Promise.all([
    getCourseProgress(userId, courseId),
    getDb().collection("academy_certificates").findOne({ user_id: userId, curriculum_version: versionKey }, { projection: { _id: 0 } }),
  ]);
  if (!progress) return null;
  if (existing) {
    return {
      eligible: true, issued: true, needs_name: false,
      certificate: existing as unknown as CourseCertificateStatusResult["certificate"],
      progress_pct: progress.progress_pct,
    };
  }
  if (!progress.course_complete) {
    return { eligible: false, issued: false, needs_name: false, progress_pct: progress.progress_pct };
  }
  const user = await getDb().collection("cloud_users").findOne({ id: userId }, { projection: { _id: 0, full_name: 1 } });
  const hasName = Boolean(String(user?.["full_name"] ?? "").trim());
  return { eligible: true, issued: false, needs_name: !hasName, progress_pct: progress.progress_pct };
}

export async function issueCourseCertificateIfEligible(userId: string, courseId: string, recipientNameOverride?: string): Promise<{ issued: boolean; certificate: CourseCertificateDoc }> {
  const course = findCourse(courseId);
  if (!course || !course.certificateEligible) throw Object.assign(new Error("This course does not issue a certificate."), { statusCode: 409 });
  const db = getDb();
  const versionKey = courseVersionKey(courseId);
  const existing = await db.collection("academy_certificates").findOne({ user_id: userId, curriculum_version: versionKey }, { projection: { _id: 0 } });
  if (existing) return { issued: false, certificate: existing as unknown as CourseCertificateDoc };

  const progress = await getCourseProgress(userId, courseId);
  if (!progress?.course_complete) throw Object.assign(new Error("Course is not yet complete -- all module quizzes and the final assessment must be passed."), { statusCode: 409 });

  const user = await db.collection("cloud_users").findOne({ id: userId }, { projection: { _id: 0, full_name: 1, email: 1 } });
  const recipientName = (recipientNameOverride?.trim() || String(user?.["full_name"] ?? "").trim());
  if (!recipientName) throw Object.assign(new Error("A name is required before a certificate can be issued."), { statusCode: 422 });

  const now = new Date().toISOString();
  const doc: CourseCertificateDoc = {
    certificate_id: generateCertificateId(),
    user_id: userId,
    program: versionKey,
    curriculum_version: versionKey,
    course_id: course.id,
    course_title: course.title,
    recipient_name: recipientName,
    completed_at: now,
    issued_at: now,
    status: "valid",
  };

  try {
    await db.collection("academy_certificates").insertOne({ id: randomUUID(), ...doc });
  } catch (error) {
    if (Number((error as { code?: unknown })?.code) === 11000) {
      const winner = await db.collection("academy_certificates").findOne({ user_id: userId, curriculum_version: versionKey }, { projection: { _id: 0 } });
      return { issued: false, certificate: winner as unknown as CourseCertificateDoc };
    }
    throw error;
  }

  if (recipientNameOverride?.trim() && !String(user?.["full_name"] ?? "").trim()) {
    await db.collection("cloud_users").updateOne({ id: userId }, { $set: { full_name: recipientNameOverride.trim() } });
  }

  const buyerEmail = String(user?.["email"] ?? "");
  if (buyerEmail) await sendCourseCertificateEmail(buyerEmail, recipientName, doc, course);

  return { issued: true, certificate: doc };
}

async function sendCourseCertificateEmail(toEmail: string, recipientName: string, cert: CourseCertificateDoc, course: Course): Promise<boolean> {
  const b = await emailBranding();
  const verifyUrl = courseCertificateVerifyUrl(cert.certificate_id);
  const viewUrl = `${b.command_center_url}?academy_certificate=1&course=${encodeURIComponent(course.id)}`;
  const vars = {
    buyer_name: recipientName, first_name: recipientName, buyer_email: toEmail, account_email: toEmail,
    certificate_name: recipientName, certificate_id: cert.certificate_id, course_title: course.title,
    completion_date: new Date(cert.completed_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    verify_url: verifyUrl, view_url: viewUrl,
  };
  const override = await publishedTransactionalRender("academy_certificate_issued", vars);
  if (override) return sendEmail(toEmail, String(override["subject"]), String(override["html"]), { text: String(override["text"] ?? "") });
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
<h2 style="color:#B8860B;">🏆 You've completed ${course.title}</h2>
<p>Hi ${recipientName || "Trader"},</p>
<p>Congratulations — you've completed the <strong>${course.title}</strong> course, including every module quiz and the final assessment.</p>
<p>Your Certificate of Completion has been issued in your name:</p>
<div style="background:#f5f5f5;border:2px solid #B8860B;padding:16px;margin:16px 0;font-size:14px;">
<p style="margin:4px 0;"><strong>Name:</strong> ${recipientName}</p>
<p style="margin:4px 0;"><strong>Course:</strong> ${course.title}</p>
<p style="margin:4px 0;"><strong>Completed:</strong> ${vars.completion_date}</p>
<p style="margin:4px 0;"><strong>Certificate ID:</strong> ${cert.certificate_id}</p>
</div>
<div style="text-align:center;margin:20px 0;">${emailLinkButton("View Certificate", viewUrl, true)}</div>
<p style="font-size:12px;color:#6E6E73;">You can also verify your certificate online using its unique certificate ID or the QR code printed on the certificate: <a href="${verifyUrl}" style="color:#B8860B;">${verifyUrl}</a></p>
<p style="font-size:13px;">Congratulations on completing the course.</p>
<p style="font-size:13px;color:#333;">XauCloud — Built for Gold.</p>
</div>`;
  return sendEmail(toEmail, `🏆 You've completed ${course.title}`, html);
}

export async function getOwnCourseCertificate(userId: string, courseId: string): Promise<CourseCertificateDoc | null> {
  const versionKey = courseVersionKey(courseId);
  const row = await getDb().collection("academy_certificates").findOne({ user_id: userId, curriculum_version: versionKey }, { projection: { _id: 0 } });
  return row as unknown as CourseCertificateDoc | null;
}
