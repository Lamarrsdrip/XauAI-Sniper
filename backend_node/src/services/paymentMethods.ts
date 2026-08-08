import type { FastifyRequest } from "fastify";
import { getSettings } from "./settings.js";
import { TELEGRAM_SUPPORT_URL } from "./emailBranding.js";

// Nomba removed as a payment option (owner directive 2026-08-08). Checkout now
// offers Nigeria Bank Transfer + Paystack only. Dormant Nomba backend routes
// remain for historical/in-flight transactions but are never surfaced.
export const DEFAULT_PAYMENT_METHOD_ORDER = ["bank_transfer", "paystack"];
export const PAYMENT_METHOD_COPY: Record<string, { label: string; description: string; instant: boolean }> = {
  bank_transfer: {
    label: "Nigeria Bank Transfer",
    description: "Transfer to our Nigerian bank account. Admin verification required. Order fulfilled after confirmation.",
    instant: false,
  },
  paystack: {
    label: "Pay with Paystack",
    description: "Card and supported Paystack payment methods. Instant fulfillment after verified payment.",
    instant: true,
  },
};

export interface PaymentMethodsSettings {
  paystack_enabled: boolean;
  nomba_enabled: boolean;
  default_payment_method: string;
  payment_method_order: string[];
}

/** Port of server.py:1764 `_get_payment_methods_settings`. */
export async function getPaymentMethodsSettings(): Promise<PaymentMethodsSettings> {
  const s = await getSettings();
  let order = (s["payment_method_order"] as string[] | undefined) ?? DEFAULT_PAYMENT_METHOD_ORDER;
  order = [...order.filter((m) => m in PAYMENT_METHOD_COPY), ...DEFAULT_PAYMENT_METHOD_ORDER.filter((m) => !order.includes(m))];
  return {
    paystack_enabled: (s["payment_paystack_enabled"] as boolean | undefined) ?? true,
    nomba_enabled: (s["payment_nomba_enabled"] as boolean | undefined) ?? false,
    default_payment_method: String(s["payment_default_method"] ?? "bank_transfer"),
    payment_method_order: order,
  };
}

export interface BankTransferSettings {
  enabled: boolean;
  bank_name: string;
  account_name: string;
  account_number: string;
  timeout_minutes: number;
  proof_required: boolean;
  support_contact: string;
  instructions: string;
}

/** Port of server.py:1720 `_get_bank_transfer_settings`. */
export async function getBankTransferSettings(): Promise<BankTransferSettings> {
  const s = await getSettings();
  return {
    enabled: (s["bank_transfer_enabled"] as boolean | undefined) ?? false,
    bank_name: String(s["bank_transfer_bank_name"] ?? ""),
    account_name: String(s["bank_transfer_account_name"] ?? ""),
    account_number: String(s["bank_transfer_account_number"] ?? ""),
    timeout_minutes: Number(s["bank_transfer_timeout_minutes"] ?? 60),
    proof_required: (s["bank_transfer_proof_required"] as boolean | undefined) ?? false,
    support_contact: String(s["bank_transfer_support_contact"] ?? TELEGRAM_SUPPORT_URL),
    instructions: String(s["bank_transfer_instructions"] ?? ""),
  };
}

/** Port of server.py:1733 `_bank_transfer_is_configured`. */
export function bankTransferIsConfigured(settings: BankTransferSettings): boolean {
  return Boolean(settings.bank_name && settings.account_name && settings.account_number);
}

/** Port of server.py:1777 `_payment_method_availability` -- each provider computed independently; a broken one only ever turns its own flag False. */
export async function paymentMethodAvailability(_request: FastifyRequest): Promise<Record<string, boolean>> {
  const settings = await getPaymentMethodsSettings();

  let bankTransferAvailable = false;
  try {
    const btSettings = await getBankTransferSettings();
    bankTransferAvailable = btSettings.enabled && bankTransferIsConfigured(btSettings);
  } catch {
    /* logged in Python; own flag stays false */
  }

  let paystackAvailable = false;
  try {
    if (settings.paystack_enabled) {
      const s = await getSettings();
      paystackAvailable = Boolean(s["paystack_secret_key"]);
    }
  } catch {
    /* own flag stays false */
  }

  return { bank_transfer: bankTransferAvailable, paystack: paystackAvailable };
}
