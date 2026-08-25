import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../docs/xaucloud-admin-actions.openapi.yaml", import.meta.url), "utf8");
const source = readFileSync(
  new URL("../../../src/routes/admin/adminGatewayActions.ts", import.meta.url),
  "utf8",
);

const EXPECTED = [
  "diagnoseCustomerIssue","queryUsers","prepareUserAction","executeUserAction",
  "queryLicenses","prepareLicenseAction","executeLicenseAction","queryOrdersPayments","prepareOrderPaymentAction","executeOrderPaymentAction",
  "queryTransactionalEmail","manageTransactionalEmailDraft","prepareTransactionalEmailAction","executeTransactionalEmailAction",
  "querySupport","manageSupportDraft","prepareSupportAction","executeSupportAction","queryContentAndNotifications","manageContentDraft",
  "prepareContentAction","executeContentAction","queryReplaysReleases",
  "queryDiagnosticsAuditAnalytics",
  "manageCustomEmailDraft","prepareCustomEmailSend","sendCustomEmail",
  "queryXPosting","prepareXTradePost","executeXTradePost",
];

describe("XauCloud Admin controlled gateway", () => {
  it("publishes the documented GPT operationIds", () => {
    const ids = [...schema.matchAll(/operationId:\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    expect(ids).toEqual(EXPECTED);
    expect(new Set(ids).size).toBe(EXPECTED.length);
    expect(ids).toHaveLength(30);
  });

  it("exposes the structured document input required to create custom email drafts", () => {
    expect(schema).toContain("document:");
    expect(schema).toContain("required: [version, theme, blocks]");
    expect(schema).toContain("blocks:");
    expect(schema).toContain("type: object");
  });

  it("offers the operational admin overview through the GPT-facing diagnostics query", () => {
    expect(schema).toContain("admin_overview");
    expect(source).toContain('b.operation==="admin_overview"');
  });

  it("keeps dangerous generic primitives out of the gateway", () => {
    expect(schema).not.toMatch(/operationId:\s*(executeSql|runShell|readFile|httpProxy|executeCode)/i);
    expect(source).not.toMatch(/child_process|execSync|spawnSync|eval\(|new Function\(/);
  });

  it("documents prepare/execute separation for consequential domains", () => {
    for (const op of ["prepareUserAction","executeUserAction","prepareLicenseAction","executeLicenseAction","prepareOrderPaymentAction","executeOrderPaymentAction","prepareSupportAction","executeSupportAction","prepareContentAction","executeContentAction"]) {
      expect(schema).toContain(`operationId: ${op}`);
    }
  });

  // 2026-08-25 email-system audit: executeLicenseAction's four operations
  // (transfer/deactivate/activate/reset) each now send license_status. This
  // file has no Fastify-inject harness (single-request, compressed-style
  // route bodies) -- behavioral coverage for the shared send/idempotency
  // logic lives in accountLifecycleEmails.test.ts and admin/pins.test.ts,
  // which exercise byte-identical conditions via the human-admin path.
  it("wires license_status email sends into every executeLicenseAction branch", () => {
    const startIdx = source.indexOf('"/admin/actions/gateway/licenses/execute"');
    const endIdx = source.indexOf('"/admin/actions/gateway/orders/execute"');
    const executeLicenseBlock = source.slice(startIdx, endIdx);
    for (const branch of ["transfer_license", "deactivate_license", "activate_license", "reset_activation"]) {
      const branchIdx = executeLicenseBlock.indexOf(`"${branch}"`);
      expect(branchIdx, `${branch} branch not found`).toBeGreaterThan(-1);
    }
    expect(executeLicenseBlock).toContain("sendLicenseStatusEmail(");
    expect((executeLicenseBlock.match(/sendLicenseStatusEmail\(/g) ?? []).length).toBe(4);
  });

  // 2026-08-25 platform-unification audit: send_reply's own result object
  // used to hardcode email_sent:false -- an admin sending a support reply
  // never actually notified the customer. Fixed to send a real email and
  // report the real outcome.
  it("send_reply actually emails the customer instead of hardcoding email_sent:false", () => {
    const startIdx = source.indexOf('app.post("/admin/actions/gateway/support/execute"');
    const endIdx = source.indexOf("}else if(b.operation===\"close_ticket\")", startIdx);
    const sendReplyBlock = source.slice(startIdx, endIdx);
    expect(sendReplyBlock).toContain("sendAccountNoticeEmail(");
    expect(sendReplyBlock).not.toContain("email_sent:false");
    expect(sendReplyBlock).toMatch(/email_sent:\s*emailSent/);
  });
});
