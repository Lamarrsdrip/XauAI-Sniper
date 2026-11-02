/**
 * Register one safe read-only browser agent tool if the experimental WebMCP
 * API is present. No payment actions, trading commands, auth tokens, licenses
 * or customer data are exposed to browser agents.
 *
 * WebMCP is an early-preview browser capability, not available on every browser.
 * We register once at application bootstrap, not inside React components.
 */
export function registerPublicWebMcp() {
  if (typeof window === "undefined" || !window.isSecureContext) return;
  const modelContext = document.modelContext || navigator.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") return;
  if (window.__xaucloudAgentToolRegistered) return;
  const controller = new AbortController();
  const publicPages = [
    { title: "Homepage", url: "https://xaucloud.io/" },
    { title: "Performance", url: "https://xaucloud.io/performance" },
    { title: "About", url: "https://xaucloud.io/about" },
    { title: "Contact", url: "https://xaucloud.io/contact" },
    { title: "Terms", url: "https://xaucloud.io/terms" },
    { title: "Risk disclosure", url: "https://xaucloud.io/risk" },
  ];
  try {
    modelContext.registerTool({
      name: "xaucloud_list_public_pages",
      description: "Return official public XauCloud information pages without submitting payment, changing settings or viewing private account data.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            pages: publicPages,
            product: "MetaTrader 5 automation for Gold (XAUUSD)",
            risk: "Trading may result in full loss of capital. No results are guaranteed.",
          }),
        }],
      }),
      annotations: { readOnlyHint: true },
      signal: controller.signal,
    });
    window.__xaucloudAgentToolRegistered = true;
    window.addEventListener("pagehide", () => controller.abort(), { once: true });
  } catch {
    // An unsupported experimental implementation must never break this live site.
  }
}
