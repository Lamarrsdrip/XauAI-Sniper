import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyCertificatePublic } from "../services/academyCertificates.js";

const CertId = z.object({ certificateId: z.string().min(1).max(64) });

/**
 * Public, unauthenticated certificate verification. Deliberately returns
 * only the fields verifyCertificatePublic() allows (name, completion date,
 * certificate id, status) -- never email, user id, account, payment, or
 * license data. A not-found certificate id returns 404 with no distinction
 * from "exists but malformed", so the endpoint can't be used to enumerate ids.
 */
export async function registerAcademyVerifyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/academy/verify/:certificateId", async (request, reply) => {
    const { certificateId } = CertId.parse(request.params);
    const result = await verifyCertificatePublic(certificateId);
    if (!result) return reply.code(404).send({ found: false, detail: "Certificate not found." });
    return { found: true, certificate: result };
  });
}
