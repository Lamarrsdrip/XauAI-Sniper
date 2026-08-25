import { vi } from "vitest";
vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-secret";
});

type Doc = Record<string, unknown>;

class FakeCollection {
  docs: Doc[] = [];
  uniqueKeys: string[][] = [];
  async findOne(query: Doc): Promise<Doc | null> {
    const found = this.docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    return found ? structuredClone(found) : null;
  }
  async insertOne(doc: Doc) {
    for (const combo of this.uniqueKeys) {
      const clash = this.docs.some((d) => combo.every((k) => d[k] === doc[k]));
      if (clash) { const e = new Error("duplicate key"); (e as unknown as { code: number }).code = 11000; throw e; }
    }
    this.docs.push(structuredClone(doc));
    return { acknowledged: true };
  }
  async updateOne(query: Doc, update: { $set?: Doc; $addToSet?: Doc; $setOnInsert?: Doc }, options: { upsert?: boolean } = {}) {
    const found = this.docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    if (found) {
      if (update.$set) Object.assign(found, structuredClone(update.$set));
      if (update.$addToSet) {
        for (const [k, v] of Object.entries(update.$addToSet)) {
          const arr = (found[k] as unknown[]) ?? (found[k] = []);
          if (!arr.includes(v)) arr.push(v);
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (options.upsert) {
      const created: Doc = { ...structuredClone(query), ...structuredClone(update.$set ?? {}), ...structuredClone(update.$setOnInsert ?? {}) };
      if (update.$addToSet) for (const [k, v] of Object.entries(update.$addToSet)) created[k] = [v];
      this.docs.push(created);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0 };
  }
  find(query: Doc = {}) {
    const rows = this.docs.filter((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    return { sort: () => ({ limit: () => ({ toArray: async () => structuredClone(rows) }) }) };
  }
}
class FakeDb {
  private map = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    if (!this.map.has(name)) {
      const c = new FakeCollection();
      if (name === "academy_certificates") c.uniqueKeys = [["user_id", "curriculum_version"], ["certificate_id"]];
      this.map.set(name, c);
    }
    return this.map.get(name)!;
  }
}

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const sent = vi.hoisted(() => ({ calls: [] as { to: string; subject: string }[] }));
vi.mock("./email.js", () => ({ sendEmail: vi.fn(async (to: string, subject: string) => { sent.calls.push({ to, subject }); return true; }) }));
vi.mock("./adminOpsControl.js", () => ({ publishedTransactionalRender: vi.fn(async () => null) }));
vi.mock("./settings.js", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("../env.js", () => ({ env: { PUBLIC_SITE_URL: "https://xaucloud.io" } }));

import { beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_LESSON_IDS, CURRICULUM_VERSION } from "./academyCurriculum.js";
const { markLessonComplete } = await import("./academyProgress.js");
const {
  getCertificateStatus, issueCertificateIfEligible, verifyCertificatePublic,
  getOwnCertificate, adminRevokeCertificate, certificateVerifyUrl,
} = await import("./academyCertificates.js");

function seedUser(id: string, fullName: string, email = "learner@example.com") {
  state.db.collection("cloud_users").docs.push({ id, full_name: fullName, email });
}
async function completeAllLessons(userId: string, exceptLast = false) {
  const ids = exceptLast ? REQUIRED_LESSON_IDS.slice(0, -1) : REQUIRED_LESSON_IDS;
  for (const id of ids) await markLessonComplete(userId, id);
}

describe("Academy certificate issuance (server-authoritative)", () => {
  beforeEach(() => { state.db = new FakeDb(); sent.calls = []; });

  it("does not report eligibility at 99% complete (one lesson short)", async () => {
    seedUser("u1", "Ada Lovelace");
    await completeAllLessons("u1", true);
    const status = await getCertificateStatus("u1");
    expect(status.eligible).toBe(false);
    expect(status.issued).toBe(false);
  });

  it("refuses to issue when the curriculum is not actually complete, even if called directly", async () => {
    seedUser("u1", "Ada Lovelace");
    await completeAllLessons("u1", true);
    await expect(issueCertificateIfEligible("u1")).rejects.toThrow(/not yet complete/i);
  });

  it("issues a certificate once 100% of the required curriculum is backend-confirmed complete", async () => {
    seedUser("u1", "Ada Lovelace");
    await completeAllLessons("u1");
    const { issued, certificate } = await issueCertificateIfEligible("u1");
    expect(issued).toBe(true);
    expect(certificate.recipient_name).toBe("Ada Lovelace");
    expect(certificate.certificate_id).toMatch(/^XC-ACADEMY-[A-Z0-9]+$/);
    expect(certificate.curriculum_version).toBe(CURRICULUM_VERSION);
  });

  it("does not use a sequential/guessable certificate id", async () => {
    seedUser("u1", "Ada"); seedUser("u2", "Bob");
    await completeAllLessons("u1"); await completeAllLessons("u2");
    const a = await issueCertificateIfEligible("u1");
    const b = await issueCertificateIfEligible("u2");
    expect(a.certificate.certificate_id).not.toBe(b.certificate.certificate_id);
    // Not sequential: neither id is a substring/increment of the other's numeric tail.
    expect(a.certificate.certificate_id.slice(-10)).not.toBe(b.certificate.certificate_id.slice(-10));
  });

  it("a repeated completion event returns the SAME certificate, not a new one, and sends no duplicate email", async () => {
    seedUser("u1", "Ada Lovelace");
    await completeAllLessons("u1");
    const first = await issueCertificateIfEligible("u1");
    expect(first.issued).toBe(true);
    expect(sent.calls).toHaveLength(1);

    const second = await issueCertificateIfEligible("u1");
    expect(second.issued).toBe(false);
    expect(second.certificate.certificate_id).toBe(first.certificate.certificate_id);
    expect(sent.calls).toHaveLength(1); // still just one email
  });

  it("a concurrent duplicate insert (race) still resolves to one certificate, not two", async () => {
    seedUser("u1", "Ada Lovelace");
    await completeAllLessons("u1");
    const [a, b] = await Promise.all([issueCertificateIfEligible("u1"), issueCertificateIfEligible("u1")]);
    const issuedCount = [a.issued, b.issued].filter(Boolean).length;
    expect(issuedCount).toBe(1);
    expect(a.certificate.certificate_id).toBe(b.certificate.certificate_id);
  });

  it("blocks issuance with no name on file until one is confirmed, then issues immediately", async () => {
    seedUser("u1", ""); // no full_name
    await completeAllLessons("u1");
    const status = await getCertificateStatus("u1");
    expect(status.eligible).toBe(true);
    expect(status.issued).toBe(false);
    expect(status.needs_name).toBe(true);

    const { issued, certificate } = await issueCertificateIfEligible("u1", "Grace Hopper");
    expect(issued).toBe(true);
    expect(certificate.recipient_name).toBe("Grace Hopper");
  });

  it("owner can retrieve their own certificate", async () => {
    seedUser("u1", "Ada Lovelace");
    await completeAllLessons("u1");
    await issueCertificateIfEligible("u1");
    const own = await getOwnCertificate("u1");
    expect(own?.recipient_name).toBe("Ada Lovelace");
  });

  it("a different user has no certificate to retrieve (own-certificate lookup is scoped by user id)", async () => {
    seedUser("u1", "Ada Lovelace"); seedUser("u2", "Someone Else");
    await completeAllLessons("u1");
    await issueCertificateIfEligible("u1");
    const other = await getOwnCertificate("u2");
    expect(other).toBeNull();
  });

  it("public verification exposes only the allowed safe fields, never email/user id/account data", async () => {
    seedUser("u1", "Ada Lovelace", "ada@example.com");
    await completeAllLessons("u1");
    const { certificate } = await issueCertificateIfEligible("u1");
    const view = await verifyCertificatePublic(certificate.certificate_id);
    expect(view).toMatchObject({ recipient_name: "Ada Lovelace", certificate_id: certificate.certificate_id, status: "valid" });
    expect(JSON.stringify(view)).not.toContain("ada@example.com");
    expect(JSON.stringify(view)).not.toContain("u1");
  });

  it("an invalid/unknown certificate id returns null (not-found), not an error or partial data", async () => {
    const view = await verifyCertificatePublic("XC-ACADEMY-NOPE0000");
    expect(view).toBeNull();
  });

  it("a revoked certificate's public verification clearly shows revoked status", async () => {
    seedUser("u1", "Ada Lovelace");
    await completeAllLessons("u1");
    const { certificate } = await issueCertificateIfEligible("u1");
    const revoked = await adminRevokeCertificate(certificate.certificate_id, "issued in error");
    expect(revoked).toBe(true);
    const view = await verifyCertificatePublic(certificate.certificate_id);
    expect(view?.status).toBe("revoked");
  });

  it("revoking an already-revoked (or nonexistent) certificate is not a silent success", async () => {
    const result = await adminRevokeCertificate("XC-ACADEMY-NOPE0000", "n/a");
    expect(result).toBe(false);
  });

  it("the QR/verify URL points at the real production domain, not localhost", () => {
    const url = certificateVerifyUrl("XC-ACADEMY-ABC123");
    expect(url).toBe("https://xaucloud.io/verify-certificate/XC-ACADEMY-ABC123");
  });

  it("sends the certificate email exactly once for a genuine issuance", async () => {
    seedUser("u1", "Ada Lovelace");
    await completeAllLessons("u1");
    await issueCertificateIfEligible("u1");
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]!.to).toBe("learner@example.com");
    expect(sent.calls[0]!.subject).toContain("Forex Academy");
  });
});
