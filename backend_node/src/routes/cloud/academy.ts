import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCloudUser } from "../../auth.js";
import { getAcademyProgress, markLessonComplete, markLessonIncomplete } from "../../services/academyProgress.js";
import { getCertificateStatus, issueCertificateIfEligible, getOwnCertificate, certificateVerifyUrl } from "../../services/academyCertificates.js";
import { renderCertificatePdf } from "../../services/academyCertificatePdf.js";

function cloudUserOf(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

const LessonId = z.object({ lessonId: z.string().min(1).max(80) });
const ConfirmName = z.object({ name: z.string().trim().min(2).max(120) });

/** Academy progress + certificate routes. Every route is server-authoritative -- eligibility and issuance are decided from academy_progress/academy_certificates, never from a client-supplied percentage. */
export async function registerAcademyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cloud/academy/progress", { preHandler: requireCloudUser }, async (request) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    return getAcademyProgress(userId);
  });

  app.post("/cloud/academy/lessons/:lessonId/complete", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { lessonId } = LessonId.parse(request.params);
    try {
      const progress = await markLessonComplete(userId, lessonId);
      // Auto-issue the instant the last required lesson completes, only when
      // a certificate name is already on file -- otherwise the frontend must
      // collect one via /certificate/confirm-name before issuance can happen.
      if (progress.is_complete) {
        try { await issueCertificateIfEligible(userId); } catch { /* needs_name or a race with an existing certificate -- surfaced via /certificate */ }
      }
      return progress;
    } catch (error) {
      return reply.code(Number((error as { statusCode?: unknown }).statusCode ?? 400)).send({ detail: (error as Error).message });
    }
  });

  app.post("/cloud/academy/lessons/:lessonId/uncomplete", { preHandler: requireCloudUser }, async (request) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { lessonId } = LessonId.parse(request.params);
    return markLessonIncomplete(userId, lessonId);
  });

  app.get("/cloud/academy/certificate", { preHandler: requireCloudUser }, async (request) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const status = await getCertificateStatus(userId);
    return status.certificate
      ? { ...status, certificate: { ...status.certificate, verify_url: certificateVerifyUrl(status.certificate.certificate_id) } }
      : status;
  });

  app.post("/cloud/academy/certificate/confirm-name", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const body = ConfirmName.parse(request.body);
    try {
      const { issued, certificate } = await issueCertificateIfEligible(userId, body.name);
      return { issued, certificate: { ...certificate, verify_url: certificateVerifyUrl(certificate.certificate_id) } };
    } catch (error) {
      return reply.code(Number((error as { statusCode?: unknown }).statusCode ?? 400)).send({ detail: (error as Error).message });
    }
  });

  // Own certificate PDF only -- ownership is enforced by looking up the
  // certificate under the authenticated user's own id, never by trusting a
  // certificate_id from the request. /view renders inline (native PDF viewer
  // tab); /download forces a save-as -- same PDF, different disposition.
  async function ownCertificatePdf(userId: string) {
    const cert = await getOwnCertificate(userId);
    if (!cert) return null;
    const pdf = await renderCertificatePdf({
      recipientName: cert.recipient_name,
      certificateId: cert.certificate_id,
      completedAtIso: cert.completed_at,
      verifyUrl: certificateVerifyUrl(cert.certificate_id),
    });
    return { cert, pdf };
  }

  app.get("/cloud/academy/certificate/download", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const result = await ownCertificatePdf(userId);
    if (!result) return reply.code(404).send({ detail: "No certificate issued yet." });
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="XauCloud-Academy-Certificate-${result.cert.certificate_id}.pdf"`);
    return reply.send(result.pdf);
  });

  app.get("/cloud/academy/certificate/view", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const result = await ownCertificatePdf(userId);
    if (!result) return reply.code(404).send({ detail: "No certificate issued yet." });
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `inline; filename="XauCloud-Academy-Certificate-${result.cert.certificate_id}.pdf"`);
    return reply.send(result.pdf);
  });
}
