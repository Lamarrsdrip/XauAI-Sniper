import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";
import { loadEaReleaseManifest, writeManifest, verifyReleaseArtifact } from "../../services/releaseManifest.js";

const ReleasePromoteRequestSchema = z.object({ version: z.string() });
const ReleaseDisableRequestSchema = z.object({ version: z.string(), reason: z.string().optional().default("") });

// Port of server.py:2162 `ROOT_DIR / "ea_code"` -- sibling directory to
// ea_releases/, following the same process.cwd()-relative convention
// established in releaseManifest.ts.
const EA_CODE_DIR = path.join(process.cwd(), "ea_code");
const EA_CODE_XAUINDEX_DIR = path.join(process.cwd(), "ea_code_xauindex");

/** Port of server.py:2125 `_get_ea_meta` -- extract version/edition/filename/checksum from EA header comments. */
function getEaMeta(src: string, filenamePrefix: string): { version: string; edition: string; filename: string; checksum: string } {
  const head = src.slice(0, 3000);
  const m = /v(\d+\.\d+\.\d+)\s*[—-]+\s*(.+)/.exec(head);
  const version = m ? `v${m[1]}` : "v6.x.x";
  const editionFull = m ? (m[2] ?? "").trim().replace(/\|+$/, "").trim() : "AI Director";
  const editionSlug = editionFull
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const filename = `${filenamePrefix}_${version}_${editionSlug}.mq5`;
  const checksum = createHash("sha256").update(src, "utf8").digest("hex").slice(0, 12);
  return { version, edition: editionFull, filename, checksum };
}

/** Port of server.py:2416 `_log_release_action`. */
async function logReleaseAction(adminEmail: string, action: string, version: string, previousVersion: string | null, detail = ""): Promise<void> {
  await getDb().collection("release_audit_log").insertOne({
    id: randomUUID(),
    admin_email: adminEmail,
    action,
    version,
    previous_version: previousVersion,
    detail,
    at: new Date().toISOString(),
  });
}

/** Port of server.py's admin release-management + admin download routes (lines 2444-2620). */
export async function registerAdminReleasesRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/releases -- server.py:2444
  app.get("/admin/releases", { preHandler: requireAdmin }, async () => {
    const manifest = await loadEaReleaseManifest();
    const releases = manifest.releases ?? {};
    const current = manifest.current_version;

    const downloadCounts = new Map<string, number>();
    const agg = await getDb()
      .collection("ea_download_log")
      .aggregate<{ _id: string; count: number }>([{ $match: { result: "SUCCESS" } }, { $group: { _id: "$version", count: { $sum: 1 } } }])
      .toArray();
    for (const doc of agg) downloadCounts.set(doc._id, doc.count);

    const out: Record<string, unknown>[] = [];
    for (const [version, release] of Object.entries(releases)) {
      out.push({
        ...release,
        is_current: version === current,
        artifact_ok: (await verifyReleaseArtifact(version, release)) === null,
        download_count: downloadCounts.get(version) ?? 0,
      });
    }
    out.sort((a, b) => String(b["build_timestamp"] ?? "").localeCompare(String(a["build_timestamp"] ?? "")));
    return { current_version: current, releases: out };
  });

  // GET /admin/releases/audit-log -- server.py:2466
  app.get("/admin/releases/audit-log", { preHandler: requireAdmin }, async (request) => {
    const q = z.object({ limit: z.coerce.number().int().optional().default(100) }).parse(request.query);
    const entries = await getDb()
      .collection("release_audit_log")
      .find({}, { projection: { _id: 0 } })
      .sort({ at: -1 })
      .limit(Math.min(q.limit, 500))
      .toArray();
    return { total: entries.length, entries };
  });

  // GET /admin/downloads -- server.py:2471
  app.get("/admin/downloads", { preHandler: requireAdmin }, async (request) => {
    const q = z.object({ limit: z.coerce.number().int().optional().default(100) }).parse(request.query);
    const entries = await getDb()
      .collection("ea_download_log")
      .find({}, { projection: { _id: 0 } })
      .sort({ downloaded_at: -1 })
      .limit(Math.min(q.limit, 500))
      .toArray();
    return { total: entries.length, entries };
  });

  // POST /admin/releases/promote -- server.py:2479
  app.post("/admin/releases/promote", { preHandler: requireAdmin }, async (request, reply) => {
    const req = ReleasePromoteRequestSchema.parse(request.body);
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const manifest = await loadEaReleaseManifest();
    const releases = manifest.releases ?? {};
    const release = releases[req.version];
    if (!release) return reply.code(404).send({ detail: `No release '${req.version}' in the manifest.` });
    if (!release.stable_status) return reply.code(400).send({ detail: `Release '${req.version}' is not marked stable_status=true. Approve it before promoting.` });
    const artifactProblem = await verifyReleaseArtifact(req.version, release);
    if (artifactProblem) return reply.code(422).send({ detail: `Cannot promote '${req.version}': ${artifactProblem}` });

    const previous = manifest.current_version ?? null;
    if (previous === req.version) return { promoted: true, version: req.version, previous_version: previous, no_op: true };
    manifest.current_version = req.version;
    await writeManifest(manifest);
    await logReleaseAction(String(admin["email"]), "promote", req.version, previous);
    app.log.info(`EA_RELEASE_PROMOTED version=${req.version} previous=${previous} admin=${admin["email"]}`);
    return { promoted: true, version: req.version, previous_version: previous, no_op: false };
  });

  // POST /admin/releases/rollback -- server.py:2500
  app.post("/admin/releases/rollback", { preHandler: requireAdmin }, async (request, reply) => {
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const manifest = await loadEaReleaseManifest();
    const current = manifest.current_version ?? null;
    const history = await getDb()
      .collection("release_audit_log")
      .find({ action: { $in: ["promote", "rollback"] } }, { projection: { _id: 0 } })
      .sort({ at: -1 })
      .limit(200)
      .toArray();

    let target: string | null = null;
    for (const entry of history) {
      const candidate = entry["previous_version"] as string | null | undefined;
      if (candidate && candidate !== current && manifest.releases?.[candidate]) {
        target = candidate;
        break;
      }
    }
    if (!target) return reply.code(404).send({ detail: "No prior version found to roll back to." });

    const release = manifest.releases![target]!;
    if (!release.stable_status) {
      return reply.code(409).send({ detail: `Most recent prior version '${target}' is no longer stable_status=true -- use /admin/releases/promote to choose a specific version instead.` });
    }
    const artifactProblem = await verifyReleaseArtifact(target, release);
    if (artifactProblem) return reply.code(422).send({ detail: `Cannot roll back to '${target}': ${artifactProblem}` });

    manifest.current_version = target;
    await writeManifest(manifest);
    await logReleaseAction(String(admin["email"]), "rollback", target, current);
    app.log.warn(`EA_RELEASE_ROLLED_BACK version=${target} previous=${current} admin=${admin["email"]}`);
    return { rolled_back: true, version: target, previous_version: current };
  });

  // POST /admin/releases/disable -- server.py:2532
  app.post("/admin/releases/disable", { preHandler: requireAdmin }, async (request, reply) => {
    const req = ReleaseDisableRequestSchema.parse(request.body);
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const manifest = await loadEaReleaseManifest();
    const release = manifest.releases?.[req.version];
    if (!release) return reply.code(404).send({ detail: `No release '${req.version}' in the manifest.` });
    if (release.stable_status === false) return { disabled: true, version: req.version, no_op: true };

    release.stable_status = false;
    manifest.releases![req.version] = release;
    await writeManifest(manifest);
    await logReleaseAction(String(admin["email"]), "disable", req.version, manifest.current_version ?? null, req.reason);
    app.log.warn(`EA_RELEASE_DISABLED version=${req.version} admin=${admin["email"]} reason=${JSON.stringify(req.reason)}`);
    return { disabled: true, version: req.version, no_op: false, is_current: req.version === manifest.current_version };
  });

  // GET /admin/download/ea-master -- server.py:2570. Admin-only: serves the
  // FULL master MQ5 source with agent token intact. Never exposed publicly.
  app.get("/admin/download/ea-master", { preHandler: requireAdmin }, async (_request, reply) => {
    const p = path.join(EA_CODE_DIR, "XAUUSD_AI_Sniper_EA.mq5");
    if (!existsSync(p)) return reply.code(404).send();
    const src = await readFile(p, "utf8");
    const meta = getEaMeta(src, "XAUUSD_AI_Sniper_EA_MASTER");
    return reply.header("Content-Disposition", `attachment; filename="${meta.filename}"`).type("application/octet-stream").send(await readFile(p));
  });

  // GET /admin/download/xauindex-master -- server.py:2610
  app.get("/admin/download/xauindex-master", { preHandler: requireAdmin }, async (_request, reply) => {
    const p = path.join(EA_CODE_XAUINDEX_DIR, "XauIndex_EA.mq5");
    if (!existsSync(p)) return reply.code(404).send();
    const src = await readFile(p, "utf8");
    const meta = getEaMeta(src, "XauIndex_EA");
    return reply.header("Content-Disposition", `attachment; filename="${meta.filename}"`).type("application/octet-stream").send(await readFile(p));
  });
}
