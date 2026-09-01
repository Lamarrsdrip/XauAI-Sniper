import { z } from "zod";

/** Port of server.py:6446 `class TradingUniverseSettings(BaseModel)`. */
export const TradingUniverseSettingsSchema = z.object({
  enable_gold: z.boolean().optional().default(true),
  enable_index: z.boolean().optional().default(false),
  selected_index_symbols: z.array(z.string()).optional().default([]),
  max_open_trades_gold: z.number().optional().default(0),
  max_open_trades_index: z.number().optional().default(0),
  max_total_exposure_usd: z.number().optional().default(0),
  gold_risk_mode: z.string().optional().default("BALANCED"),
  index_risk_mode: z.string().optional().default("BALANCED"),
  index_aggression: z.string().optional().default("INDEX_BALANCED"),
  updated_at: z.string().nullable().optional(),
});
export type TradingUniverseSettings = z.infer<typeof TradingUniverseSettingsSchema>;
