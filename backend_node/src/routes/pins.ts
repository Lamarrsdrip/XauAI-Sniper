import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LicenseError, resolveMonitorLicense } from "../services/license.js";

const PinValidateRequestSchema = z.object({
  pin: z.string(),
  mt5_account: z.string().optional().default(""),
});

/** Port of server.py:1232 `POST /pins/validate` (public -- EA calls this). */
export async function registerPinRoutes(app: FastifyInstance): Promise<void> {
  app.post("/pins/validate", async (request) => {
    const body = PinValidateRequestSchema.parse(request.body);
    try {
      const lic = await resolveMonitorLicense(body.pin, body.mt5_account ?? "");
      return { valid: true, pin: lic["pin"] ?? body.pin, message: "License verified" };
    } catch (err) {
      if (err instanceof LicenseError) {
        const detail = err.detail;
        const reason = typeof detail === "string" ? detail : (detail["message"] as string | undefined) ?? (detail["reason"] as string | undefined);
        return { valid: false, reason: reason ?? "License check failed" };
      }
      throw err;
    }
  });
}
