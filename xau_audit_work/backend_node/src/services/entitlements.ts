import { getUserLicense } from "./commandLicense.js";
import { LicenseError } from "./license.js";
import { trialStatus, type TrialRow } from "./signalTrial.js";
import { subscriptionStatus, type SubscriptionRow } from "./signalSubscriptions.js";

export interface Entitlement {
  signals_access: boolean;
  outlook_access: boolean;
  engine_10m_access: boolean;
  signal_notifications: boolean;
  bot_license: boolean;
  bot_operations: boolean;
  bot_activity: boolean;
  performance_access: boolean;
  automation_access: boolean;
  /** Which grant produced signals_access, for UI/admin display only -- never used for authorization branching. */
  source: "lifetime" | "trial" | "subscription" | "none";
  trial: (TrialRow & { days_remaining: number }) | null;
  subscription: (SubscriptionRow & { active: boolean }) | null;
}

/**
 * The single, centralized authorization decision for the whole
 * trial/subscription/lifetime-license product. Every protected route must
 * call this and check the specific capability it needs -- never re-derive
 * "is this user allowed" ad hoc, and never trust a frontend-only hide.
 *
 * Capabilities are computed as a boolean OR across independently-valid
 * grants: an active lifetime license grants everything and is completely
 * unaffected by trial/subscription state; an active trial or subscription
 * grants only the signal-experience capabilities, never bot_license/
 * bot_operations/bot_activity/automation_access. A lifetime customer never
 * loses access because an unrelated signal subscription expired.
 */
export async function effectiveEntitlement(user: Record<string, unknown>): Promise<Entitlement> {
  const userId = String(user["id"] ?? "");
  const [license, trial, subscription] = await Promise.all([
    getUserLicense(user),
    userId ? trialStatus(userId) : Promise.resolve(null),
    userId ? subscriptionStatus(userId) : Promise.resolve(null),
  ]);

  const licensed = Boolean(license?.["is_active"]);
  const trialActive = trial?.status === "ACTIVE";
  const subscriptionActive = Boolean(subscription?.active);
  const signalsGranted = licensed || trialActive || subscriptionActive;
  const source: Entitlement["source"] = licensed ? "lifetime" : trialActive ? "trial" : subscriptionActive ? "subscription" : "none";

  return {
    signals_access: signalsGranted,
    outlook_access: signalsGranted,
    engine_10m_access: signalsGranted,
    signal_notifications: signalsGranted,
    bot_license: licensed,
    bot_operations: licensed,
    bot_activity: licensed,
    performance_access: licensed,
    automation_access: licensed,
    source,
    trial: trial ?? null,
    subscription: subscription ?? null,
  };
}

/** Throws a 403 LicenseError if the entitlement doesn't include the given capability. Route handlers call this, never a frontend-only hide. */
export function requireCapability(entitlement: Entitlement, capability: keyof Omit<Entitlement, "source" | "trial" | "subscription">): void {
  if (!entitlement[capability]) {
    throw new LicenseError(403, { reason: "NOT_ENTITLED", capability, message: "This requires an active trial, signal subscription, or XauCloud bot license." });
  }
}
