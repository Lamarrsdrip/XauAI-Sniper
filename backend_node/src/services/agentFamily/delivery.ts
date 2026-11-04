import { createHash } from "node:crypto";
import type { TermixClient } from "./termix.js";
import type { CommerceOrder } from "./orderEngine.js";

export function deliveryFiles(order: CommerceOrder): { fileName: string; contentType: string; body: string }[] {
  const json = JSON.stringify(order.output ?? {}, null, 2);
  const report = typeof order.output?.["report"] === "string" ? String(order.output["report"]) : json;
  return [
    { fileName: `${order.marketplaceOrderId}.json`, contentType: "application/json", body: json },
    { fileName: `${order.marketplaceOrderId}.md`, contentType: "text/markdown", body: report },
  ];
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? v as Record<string, unknown> : null;
}

/**
 * Uploads the validated JSON and markdown, registers artifacts, then asks
 * TermiX for a submitDelivery transaction intent. The intent is not signed here.
 */
export async function prepareSubmitDelivery(client: TermixClient, order: CommerceOrder, put: typeof fetch = fetch): Promise<{ intent: unknown; artifactIds: string[] }> {
  if (!order.output || !order.outputHash) throw new Error("Refusing to deliver an order with no validated output.");
  const artifactIds = [...order.artifactIds];
  if (artifactIds.length === 0) {
    for (const file of deliveryFiles(order)) {
      const bytes = Buffer.byteLength(file.body);
      const upload = asRecord(await client.request("POST", `/api/v1/orders/${encodeURIComponent(order.marketplaceOrderId)}/delivery/upload-url`, {
        fileName: file.fileName, contentType: file.contentType, sizeBytes: bytes,
      }));
      const uploadUrl = String(upload?.["uploadUrl"] ?? "");
      const s3Key = String(upload?.["s3Key"] ?? upload?.["key"] ?? "");
      const publicUrl = String(upload?.["publicUrl"] ?? upload?.["url"] ?? "");
      if (!uploadUrl.startsWith("https://") || !s3Key) throw new Error("TermiX did not return an https upload URL.");
      const putResponse = await put(uploadUrl, { method: "PUT", headers: { "Content-Type": file.contentType }, body: file.body });
      if (!putResponse.ok) throw new Error(`Artifact upload failed with ${putResponse.status}.`);
      const registered = asRecord(await client.request("POST", `/api/v1/orders/${encodeURIComponent(order.marketplaceOrderId)}/delivery/artifacts`, {
        s3Key, url: publicUrl || uploadUrl, sha256: sha256(file.body), contentType: file.contentType, sizeBytes: bytes,
      }));
      const artifactId = String(registered?.["id"] ?? registered?.["artifactId"] ?? "");
      if (!artifactId) throw new Error("TermiX did not return an artifact id.");
      artifactIds.push(artifactId);
    }
  }
  const intent = await client.request("POST", `/api/v1/orders/${encodeURIComponent(order.marketplaceOrderId)}/delivery/submit`, {
    artifactIds, note: "XauCloud validated JSON and markdown. Not a live trade.",
  });
  return { intent, artifactIds };
}

export async function prepareOrderIntent(client: TermixClient, kind: "acceptOrder" | "claimAfterTimeout" | "cancelExpired", marketplaceOrderId: string): Promise<unknown> {
  const path = kind === "acceptOrder" ? "provider-accept/prepare"
    : kind === "claimAfterTimeout" ? "claim-after-timeout/prepare"
      : "cancel-expired/prepare";
  return client.request("POST", `/api/v1/orders/${encodeURIComponent(marketplaceOrderId)}/${path}`);
}
