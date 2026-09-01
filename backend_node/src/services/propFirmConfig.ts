/** Port of server.py:6046 `_normalize_prop_firm_config`. */
export interface PropFirmConfig {
  enabled: boolean;
  starting_balance: number;
  daily_loss_pct: number;
  max_loss_pct: number;
  safety_buffer_pct: number;
  risk_per_trade_pct: number;
  max_basket_risk_pct: number;
  allow_retest_add: boolean;
  retest_add_lot_multi: number;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function number(raw: Record<string, unknown>, name: string, fallback: number): number {
  const value = raw[name];
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizePropFirmConfig(payload: Record<string, unknown> | null | undefined): PropFirmConfig {
  const raw = payload ?? {};
  const enabled = asBool(raw["enabled"], false);
  const startingBalance = Math.max(0, number(raw, "starting_balance", 0));
  const dailyLoss = Math.min(20, Math.max(0.5, number(raw, "daily_loss_pct", 4)));
  const maxLoss = Math.min(30, Math.max(dailyLoss, number(raw, "max_loss_pct", 8)));
  const bufferPct = Math.min(Math.max(0, dailyLoss - 0.1), Math.max(0, number(raw, "safety_buffer_pct", 0.5)));
  const riskTrade = Math.min(2.0, Math.max(0.01, number(raw, "risk_per_trade_pct", 0.15)));
  const basketRisk = Math.min(4.0, Math.max(riskTrade, number(raw, "max_basket_risk_pct", 0.75)));
  const retestMulti = Math.min(0.5, Math.max(0.05, number(raw, "retest_add_lot_multi", 0.25)));
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  return {
    enabled,
    starting_balance: round2(startingBalance),
    daily_loss_pct: round2(dailyLoss),
    max_loss_pct: round2(maxLoss),
    safety_buffer_pct: round2(bufferPct),
    risk_per_trade_pct: round2(riskTrade),
    max_basket_risk_pct: round2(basketRisk),
    allow_retest_add: asBool(raw["allow_retest_add"], true),
    retest_add_lot_multi: round2(retestMulti),
  };
}
