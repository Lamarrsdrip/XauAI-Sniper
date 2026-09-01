import type { FastifyRequest } from "fastify";
import { env } from "../env.js";
import { getSettings } from "./settings.js";

/** Port of server.py:1233-1352 -- currency display (indicative only; NGN via Nomba/Paystack is the sole commercial source of truth). */

const FX_RATE_CACHE_TTL_SECONDS = 3600;
let fxRateCache: Record<string, number> = {};
let fxRateCacheTime = 0;

const COUNTRY_TO_DISPLAY_CURRENCY: Record<string, string> = {
  NG: "NGN",
  US: "USD",
  GB: "GBP",
  CA: "USD",
  AU: "USD",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  IE: "EUR",
  ZA: "USD",
  KE: "USD",
  GH: "USD",
  IN: "USD",
  AE: "USD",
};

/** Port of server.py:1270 `_get_fx_rates`. */
async function getFxRates(): Promise<Record<string, number>> {
  const now = Date.now() / 1000;
  if (Object.keys(fxRateCache).length > 0 && now - fxRateCacheTime < FX_RATE_CACHE_TTL_SECONDS) return fxRateCache;
  if (!env.EXCHANGE_RATE_API_KEY) return fxRateCache;
  try {
    const resp = await fetch(`https://v6.exchangerate-api.com/v6/${env.EXCHANGE_RATE_API_KEY}/latest/NGN`, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const data = (await resp.json()) as { result?: string; conversion_rates?: Record<string, number> };
      if (data.result === "success") {
        fxRateCache = data.conversion_rates ?? {};
        fxRateCacheTime = now;
      }
    }
  } catch {
    /* last-known-good (possibly empty) rather than erroring */
  }
  return fxRateCache;
}

/** Port of server.py:1293 `_detect_country_code`. */
export function detectCountryCode(request: FastifyRequest): string {
  let country = String(request.headers["cf-ipcountry"] ?? request.headers["x-vercel-ip-country"] ?? request.headers["x-country-code"] ?? "").toUpperCase();
  if (!country) {
    const acceptLang = String(request.headers["accept-language"] ?? "").toUpperCase();
    const m = /-([A-Z]{2})\b/.exec(acceptLang);
    if (m) country = m[1]!;
  }
  return country;
}

/** Port of server.py:1314 `_detect_display_currency`. */
export function detectDisplayCurrency(request: FastifyRequest, requested?: string | null): string {
  if (requested) return requested.toUpperCase();
  const country = detectCountryCode(request);
  if (country === "NG") return "NGN";
  return COUNTRY_TO_DISPLAY_CURRENCY[country] ?? "USD";
}

export interface PriceDisplay {
  price_kobo: number;
  price_naira: number;
  currency: string;
  charge_currency: string;
  formatted: string;
  display_currency: string;
  display_amount: number | null;
  display_amount_formatted: string | null;
  fx_rate: number | null;
  fx_rate_indicative: boolean;
  fx_rate_as_of: string | null;
}

/** Port of server.py:1325 `_build_price_display`. */
export async function buildPriceDisplay(displayCurrency: string): Promise<PriceDisplay> {
  const s = await getSettings();
  const kobo = Number(s["pin_price_kobo"] ?? 30_000_000);
  const naira = kobo / 100;
  const result: PriceDisplay = {
    price_kobo: kobo,
    price_naira: naira,
    currency: "NGN",
    charge_currency: "NGN",
    formatted: `₦${naira.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    display_currency: displayCurrency,
    display_amount: null,
    display_amount_formatted: null,
    fx_rate: null,
    fx_rate_indicative: true,
    fx_rate_as_of: null,
  };
  if (displayCurrency === "NGN") {
    result.display_amount = naira;
    result.display_amount_formatted = result.formatted;
    result.fx_rate_indicative = false;
    return result;
  }
  const rates = await getFxRates();
  const rate = rates[displayCurrency];
  if (rate) {
    const converted = naira * rate;
    result.display_amount = Math.round(converted * 100) / 100;
    result.display_amount_formatted = `${displayCurrency} ${converted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    result.fx_rate = rate;
    result.fx_rate_as_of = fxRateCacheTime ? new Date(fxRateCacheTime * 1000).toISOString() : null;
  }
  return result;
}
