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

  it("keeps dangerous generic primitives out of the gateway", () => {
    expect(schema).not.toMatch(/operationId:\s*(executeSql|runShell|readFile|httpProxy|executeCode)/i);
    expect(source).not.toMatch(/child_process|execSync|spawnSync|eval\(|new Function\(/);
  });

  it("documents prepare/execute separation for consequential domains", () => {
    for (const op of ["prepareUserAction","executeUserAction","prepareLicenseAction","executeLicenseAction","prepareOrderPaymentAction","executeOrderPaymentAction","prepareSupportAction","executeSupportAction","prepareContentAction","executeContentAction"]) {
      expect(schema).toContain(`operationId: ${op}`);
    }
  });
});
