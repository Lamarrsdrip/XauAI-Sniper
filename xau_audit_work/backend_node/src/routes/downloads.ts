import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { requireCloudUser } from "../auth.js";
import { getUserLicense } from "../services/commandLicense.js";
import { currentEaRelease, loadEaReleaseManifest, EA_RELEASES_DIR, DOWNLOAD_TOKEN_TTL_SECONDS } from "../services/releaseManifest.js";

const JWT_ALGORITHM = "HS256" as const;

/** Port of server.py's customer-facing download routes (retired public MQ5, licensed EX5 token flow, XauIndex info). */
export async function registerDownloadRoutes(app: FastifyInstance): Promise<void> {
  // GET /download/info -- server.py:2299. PUBLIC metadata only.
  app.get("/download/info", async () => {
    const release = await currentEaRelease();
    if (!release) return { available: false, reason: "NO_RELEASE_PUBLISHED" };
    const sha = String(release["ex5_sha256"] ?? "");
    return {
      available: true,
      version: release.version,
      edition: release.edition,
      filename: release["customer_filename"],
      checksum_sha256_12: sha.slice(0, 12),
      checksum_sha256: sha,
      release_notes: release.release_notes ?? "",
      build_timestamp: release.build_timestamp ?? null,
      stable: Boolean(release.stable_status),
      requires_login: true,
      download_url: "/command",
    };
  });

  // GET /download/ea, /download/package -- server.py:2556,2564. Retired.
  app.get("/download/ea", async (_request, reply) =>
    reply.code(410).send({ detail: "This endpoint is retired. Sign in to Command Center to download your compiled EA build." }),
  );
  app.get("/download/package", async (_request, reply) =>
    reply.code(410).send({ detail: "This endpoint is retired. Sign in to Command Center to download your compiled EA build." }),
  );

  // GET /download/xauindex/info -- server.py:2596
  app.get("/download/xauindex/info", async () => ({
    available: false,
    reason: "NO_COMPILED_RELEASE_ARTIFACT_YET",
    message: "XauIndex download is not yet available through this channel -- no compiled EX5 release has been built.",
  }));

  // GET /download/xauindex/ea, /download/xauindex/package -- server.py:2602,2622. Retired.
  app.get("/download/xauindex/ea", async (_request, reply) =>
    reply.code(410).send({ detail: "This endpoint is retired. XauIndex download is not yet available." }),
  );
  app.get("/download/xauindex/package", async (_request, reply) =>
    reply.code(410).send({ detail: "This endpoint is retired. XauIndex download is not yet available." }),
  );

  // POST /download/request-token -- server.py:6258
  app.post("/download/request-token", { preHandler: requireCloudUser }, async (request, reply) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const lic = await getUserLicense(user);
    if (!lic) return reply.code(403).send({ detail: "No active license linked to this account." });
    const release = await currentEaRelease();
    if (!release) return reply.code(503).send({ detail: "No release currently published." });
    const token = jwt.sign(
      { sub: "ea_download", user_id: user["id"], license_id: lic["id"] ?? "", version: release.version },
      env.JWT_SECRET,
      { algorithm: JWT_ALGORITHM, expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS },
    );
    return { download_token: token, expires_in: DOWNLOAD_TOKEN_TTL_SECONDS, download_url: `/download/ea-release?token=${token}` };
  });

  // GET /download/ea-release -- server.py:2327
  app.get("/download/ea-release", async (request, reply) => {
    const q = z.object({ token: z.string() }).parse(request.query);
    let payload: { sub?: string; user_id?: string; license_id?: string; version?: string };
    try {
      payload = jwt.verify(q.token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as typeof payload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return reply.code(401).send({ detail: "Download link expired -- request a new one from Command Center." });
      }
      return reply.code(401).send({ detail: "Invalid download token." });
    }
    if (payload.sub !== "ea_download") return reply.code(401).send({ detail: "Invalid download token." });

    const db = getDb();
    const licenseId = payload.license_id ?? "";
    const lic = await db.collection("pin_licenses").findOne({ id: licenseId, is_active: true }, { projection: { _id: 0 } });
    if (!lic) return reply.code(403).send({ detail: "License is no longer active." });

    const version = payload.version ?? "";
    const manifest = await loadEaReleaseManifest();
    const release = manifest.releases?.[version];
    const logDownload = (result: string): Promise<unknown> =>
      db.collection("ea_download_log").insertOne({
        id: randomUUID(),
        user_id: payload.user_id ?? "",
        license_id: licenseId,
        version,
        downloaded_at: new Date().toISOString(),
        result,
      });

    if (!release || !release.stable_status) {
      await logDownload("REJECTED_RELEASE_NOT_AVAILABLE");
      return reply.code(404).send({ detail: "Release no longer available." });
    }
    const p = path.join(EA_RELEASES_DIR, version, String(release["ex5_filename"] ?? ""));
    if (!existsSync(p)) {
      app.log.error(`EA_RELEASE_ARTIFACT_MISSING version=${version} path=${p}`);
      await logDownload("REJECTED_ARTIFACT_MISSING");
      return reply.code(404).send({ detail: "Release artifact missing." });
    }
    const bytes = await readFile(p);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    const expectedHash = String(release["ex5_sha256"] ?? "");
    if (actualHash !== expectedHash) {
      app.log.error(`EA_RELEASE_HASH_MISMATCH version=${version} expected=${expectedHash} actual=${actualHash}`);
      await logDownload("REJECTED_HASH_MISMATCH");
      return reply.code(503).send({ detail: "Release integrity check failed. The admin has been alerted." });
    }
    await logDownload("SUCCESS");
    return reply
      .header("Content-Disposition", `attachment; filename="${release["customer_filename"]}"`)
      .type("application/octet-stream")
      .send(bytes);
  });
}
