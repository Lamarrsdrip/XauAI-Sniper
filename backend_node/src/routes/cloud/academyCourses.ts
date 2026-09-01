import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCloudUser } from "../../auth.js";
import { publicCatalog, findCourse } from "../../services/academyCatalog.js";
import { getCourseProgress, markCourseLessonComplete, markCourseLessonIncomplete, submitQuizAttempt, quizAttemptHistory } from "../../services/academyCourseProgress.js";
import { getCourseCertificateStatus, issueCourseCertificateIfEligible, getOwnCourseCertificate, courseCertificateVerifyUrl } from "../../services/academyCourseCertificates.js";
import { renderCertificatePdf } from "../../services/academyCertificatePdf.js";

function cloudUserOf(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

const CourseId = z.object({ courseId: z.string().min(1).max(80) });
const CourseLessonId = z.object({ courseId: z.string().min(1).max(80), lessonId: z.string().min(1).max(80) });
const QuizId = z.object({ quizId: z.string().min(1).max(80) });
const QuizSubmitBody = z.object({ courseId: z.string().min(1).max(80), answers: z.record(z.string(), z.array(z.string().max(80))).default({}) });
const ConfirmName = z.object({ name: z.string().trim().min(2).max(120) });

/**
 * Course-catalog Academy routes (2026-08-26 expansion) -- deliberately
 * separate url namespace (/cloud/academy/courses/...,
 * /cloud/academy/quizzes/...) and separate backing services from the
 * original flat 21-lesson routes in academy.ts, which are completely
 * untouched. Every route is server-authoritative: quiz grading, course
 * completion, and certificate eligibility are all decided here, never from
 * anything the client claims.
 */
export async function registerAcademyCourseRoutes(app: FastifyInstance): Promise<void> {
  // GET /cloud/academy/catalog -- public within the app (still requires
  // login, matching every other Academy route) but contains no correct
  // quiz answers; both web and mobile read this same endpoint.
  app.get("/cloud/academy/catalog", { preHandler: requireCloudUser }, async () => {
    return { courses: publicCatalog() };
  });

  app.get("/cloud/academy/courses/:courseId/progress", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { courseId } = CourseId.parse(request.params);
    const progress = await getCourseProgress(userId, courseId);
    if (!progress) return reply.code(404).send({ detail: "Unknown course." });
    return progress;
  });

  app.post("/cloud/academy/courses/:courseId/lessons/:lessonId/complete", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { courseId, lessonId } = CourseLessonId.parse(request.params);
    try {
      return await markCourseLessonComplete(userId, courseId, lessonId);
    } catch (error) {
      return reply.code(Number((error as { statusCode?: unknown }).statusCode ?? 400)).send({ detail: (error as Error).message });
    }
  });

  app.post("/cloud/academy/courses/:courseId/lessons/:lessonId/uncomplete", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { courseId, lessonId } = CourseLessonId.parse(request.params);
    try {
      return await markCourseLessonIncomplete(userId, courseId, lessonId);
    } catch (error) {
      return reply.code(Number((error as { statusCode?: unknown }).statusCode ?? 400)).send({ detail: (error as Error).message });
    }
  });

  // POST /cloud/academy/quizzes/:quizId/submit -- grades entirely
  // server-side from the catalog's own answer key; the request body only
  // ever carries the learner's selected option ids, never a score or a
  // pass/fail claim.
  app.post("/cloud/academy/quizzes/:quizId/submit", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { quizId } = QuizId.parse(request.params);
    const body = QuizSubmitBody.parse(request.body);
    try {
      const result = await submitQuizAttempt(userId, body.courseId, quizId, body.answers);
      return result;
    } catch (error) {
      return reply.code(Number((error as { statusCode?: unknown }).statusCode ?? 400)).send({ detail: (error as Error).message });
    }
  });

  app.get("/cloud/academy/quizzes/:quizId/attempts", { preHandler: requireCloudUser }, async (request) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { quizId } = QuizId.parse(request.params);
    return { attempts: await quizAttemptHistory(userId, quizId) };
  });

  app.get("/cloud/academy/courses/:courseId/certificate", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { courseId } = CourseId.parse(request.params);
    const status = await getCourseCertificateStatus(userId, courseId);
    if (!status) return reply.code(404).send({ detail: "Unknown course or course does not issue a certificate." });
    return status.certificate
      ? { ...status, certificate: { ...status.certificate, verify_url: courseCertificateVerifyUrl(status.certificate.certificate_id) } }
      : status;
  });

  app.post("/cloud/academy/courses/:courseId/certificate/confirm-name", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { courseId } = CourseId.parse(request.params);
    const body = ConfirmName.parse(request.body);
    try {
      const { issued, certificate } = await issueCourseCertificateIfEligible(userId, courseId, body.name);
      return { issued, certificate: { ...certificate, verify_url: courseCertificateVerifyUrl(certificate.certificate_id) } };
    } catch (error) {
      return reply.code(Number((error as { statusCode?: unknown }).statusCode ?? 400)).send({ detail: (error as Error).message });
    }
  });

  async function ownCourseCertificatePdf(userId: string, courseId: string) {
    const cert = await getOwnCourseCertificate(userId, courseId);
    if (!cert) return null;
    const course = findCourse(courseId);
    const pdf = await renderCertificatePdf({
      recipientName: cert.recipient_name,
      certificateId: cert.certificate_id,
      completedAtIso: cert.completed_at,
      verifyUrl: courseCertificateVerifyUrl(cert.certificate_id),
      curriculumVersion: cert.curriculum_version,
      programTitle: course?.title,
    });
    return { cert, pdf };
  }

  app.get("/cloud/academy/courses/:courseId/certificate/download", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { courseId } = CourseId.parse(request.params);
    const result = await ownCourseCertificatePdf(userId, courseId);
    if (!result) return reply.code(404).send({ detail: "No certificate issued yet." });
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="XauCloud-${result.cert.course_id}-Certificate-${result.cert.certificate_id}.pdf"`);
    return reply.send(result.pdf);
  });

  app.get("/cloud/academy/courses/:courseId/certificate/view", { preHandler: requireCloudUser }, async (request, reply) => {
    const userId = String(cloudUserOf(request)["id"] ?? "");
    const { courseId } = CourseId.parse(request.params);
    const result = await ownCourseCertificatePdf(userId, courseId);
    if (!result) return reply.code(404).send({ detail: "No certificate issued yet." });
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `inline; filename="XauCloud-${result.cert.course_id}-Certificate-${result.cert.certificate_id}.pdf"`);
    return reply.send(result.pdf);
  });
}
