import { z } from "zod";

/** Port of server.py:5476 `class TradeJournalEntry(BaseModel)`. */
export const TradeJournalEntrySchema = z.object({
  pin: z.string().optional().default(""),
  symbol: z.string().optional().default("XAUUSD"),
  direction: z.string().optional().default(""),
  result: z.string().optional().default(""),
  price: z.number().optional().default(0),
  exit_price: z.number().optional().default(0),
  close_price: z.number().optional().default(0),
  profit: z.number().optional().default(0),
  lots: z.number().optional().default(0),
  hour: z.number().optional().default(0),
  day_of_week: z.number().optional().default(0),
  total_trades: z.number().optional().default(0),
  wins: z.number().optional().default(0),
  losses: z.number().optional().default(0),
  balance: z.number().optional().default(0),
  signature: z.string().optional().default(""),
  setup: z.string().optional().default(""),
  regime: z.string().optional().default(""),
  ticket: z.number().optional().default(0),
  entry_price: z.number().optional().default(0),
  opened_at: z.number().optional().default(0),
  closed_at: z.number().optional().default(0),
  commission: z.number().optional().default(0),
  swap: z.number().optional().default(0),
  original_risk_usd: z.number().optional().default(0),
  final_r: z.number().optional().default(0),
  mae_r: z.number().optional().default(0),
  mfe_r: z.number().optional().default(0),
  campaign_id: z.string().optional().default(""),
  ea_version: z.string().optional().default(""),
  account_login: z.string().optional().default(""),
  // MT5 deposit currency is authoritative only when reported by the EA.
  // Older rows remain intentionally unknown rather than guessed as USD.
  account_currency: z.string().optional().default(""),
  exit_reason: z.string().optional().default(""),
  exit_owner: z.string().optional().default(""),
  family: z.string().optional().default(""),
});
export type TradeJournalEntry = z.infer<typeof TradeJournalEntrySchema>;

/** Port of server.py:5709 `class WeeklyReportEntry(BaseModel)`. */
export const WeeklyReportEntrySchema = z.object({
  pin: z.string().optional().default(""),
  account_id: z.string().optional().default(""),
  symbol: z.string().optional().default("XAUUSD"),
  trades: z.number().optional().default(0),
  wins: z.number().optional().default(0),
  losses: z.number().optional().default(0),
  win_rate: z.number().optional().default(0),
  weekly_pnl: z.number().optional().default(0),
  weekly_pct: z.number().optional().default(0),
  balance: z.number().optional().default(0),
  patterns: z.number().optional().default(0),
  best_hour: z.number().optional().default(-1),
  worst_hour: z.number().optional().default(-1),
  best_hour_profit: z.number().optional().default(0),
  worst_hour_profit: z.number().optional().default(0),
});
export type WeeklyReportEntry = z.infer<typeof WeeklyReportEntrySchema>;
