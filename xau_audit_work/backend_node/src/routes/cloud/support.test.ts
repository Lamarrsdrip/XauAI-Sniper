import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => { process.env["ENVIRONMENT"] = "test"; });

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, user: null as Record<string, unknown> | null }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth.js")>();
  return { ...actual, requireCloudUser: async (request: unknown) => { (request as { cloudUser?: unknown }).cloudUser = state.user; }, rateLimit: () => {} };
});
vi.mock("../../services/customerTradingTelemetry.js", () => ({ resolveSupportLinks: vi.fn(async () => ({})) }));
vi.mock("../../services/adminOpsControl.js", () => ({ publishedTransactionalRender: vi.fn(async () => null) }));
vi.mock("../../services/emailBranding.js", () => ({
  emailBranding: vi.fn(async () => ({ sender_name: "XauCloud", command_center_url: "https://xaucloud.io/command" })),
  emailLinkButton: () => "",
}));
const sendEmailMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../services/email.js", () => ({ sendEmail: sendEmailMock }));

const { registerCloudSupportRoutes } = await import("./support.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCloudSupportRoutes(app);
  return app;
}

describe("cloud support routes -- customer notification", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    state.db = new FakeDb();
    state.user = { id: "user-1", email: "trader@example.com", full_name: "Trader" };
    sendEmailMock.mockClear();
    app = await createApp();
  });

  it("sends a real confirmation email when a customer opens a ticket -- not silent", async () => {
    const res = await app.inject({
      method: "POST", url: "/cloud/support/tickets",
      payload: { subject: "Cannot link my license", category: "license", message: "The PIN keeps failing." },
    });
    expect(res.statusCode).toBe(201);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [to, subject] = sendEmailMock.mock.calls[0] as [string, string];
    expect(to).toBe("trader@example.com");
    expect(subject).toContain("support request");
  });

  it("ticket creation still succeeds even if the confirmation email fails to send -- best-effort, never blocking", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("smtp down"));
    const res = await app.inject({
      method: "POST", url: "/cloud/support/tickets",
      payload: { subject: "Billing question", category: "payment", message: "Was I charged twice?" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);
  });
});
