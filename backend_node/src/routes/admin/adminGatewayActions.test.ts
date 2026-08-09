import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../docs/xaucloud-admin-actions.openapi.yaml", import.meta.url), "utf8");
const source = readFileSync(
  new URL("../../../src/routes/admin/adminGatewayActions.ts", import.meta.url),
  "utf8",
);

const EXPECTED = [
  "getAdminCapabilities","getCustomer360","diagnoseCustomerIssue","queryUsers","prepareUserAction","executeUserAction",
  "queryLicenses","prepareLicenseAction","executeLicenseAction","queryOrdersPayments","prepareOrderPaymentAction","executeOrderPaymentAction",
  "queryTransactionalEmail","manageTransactionalEmailDraft","prepareTransactionalEmailAction","executeTransactionalEmailAction",
  "querySupport","manageSupportDraft","prepareSupportAction","executeSupportAction","queryContentAndNotifications","manageContentDraft",
  "prepareContentAction","executeContentAction","queryReplaysReleases","prepareReplayReleaseAction","executeReplayReleaseAction",
  "queryDiagnosticsAuditAnalytics","getRequestTrace",
];

describe("XauCloud Admin 29-action gateway", () => {
  it("publishes exactly 29 GPT operationIds", () => {
    const ids = [...schema.matchAll(/operationId:\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    expect(ids).toEqual(EXPECTED);
    expect(new Set(ids).size).toBe(29);
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
