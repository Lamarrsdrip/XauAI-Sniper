import { z } from "zod";

/** Port of server.py `class LeaseRequestReq(BaseModel)`. */
export const LeaseRequestReqSchema = z.object({
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  account: z.string().optional().default(""),
  broker_server: z.string().optional().default(""),
  symbol: z.string().optional().default(""),
  installation_id: z.string().optional().default(""),
  terminal_instance_id: z.string().optional().default(""),
  allowed_directions: z.array(z.number()).optional().default([1, -1]),
  allowed_entry_families: z.array(z.string()).optional().default(["CORE"]),
});

/** Port of server.py `class LeaseSurrenderReq(BaseModel)`. */
export const LeaseSurrenderReqSchema = z.object({
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  account: z.string().optional().default(""),
  broker_server: z.string().optional().default(""),
  symbol: z.string().optional().default(""),
  installation_id: z.string().optional().default(""),
  terminal_instance_id: z.string().optional().default(""),
  lease_id: z.string().optional().default(""),
});

const LeaseReconcileEventSchema = z.object({
  execution_key: z.string(),
  lease_id: z.string(),
  lease_sequence: z.number(),
  candidate_evidence_id: z.string().optional().default(""),
  opportunity_id: z.string().optional().default(""),
  direction: z.number(),
  entry_family: z.string().optional().default("CORE"),
  broker_order_id: z.string().optional().default(""),
  broker_deal_id: z.string().optional().default(""),
  broker_position_id: z.string().optional().default(""),
  broker_ticket: z.number().optional().default(0),
  result: z.string().optional().default("CONFIRMED"),
  executed_at: z.string().optional().default(""),
});

/** Port of server.py `class LeaseReconcileReq(BaseModel)`. */
export const LeaseReconcileReqSchema = z.object({
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  account: z.string().optional().default(""),
  broker_server: z.string().optional().default(""),
  symbol: z.string().optional().default(""),
  installation_id: z.string().optional().default(""),
  terminal_instance_id: z.string().optional().default(""),
  events: z.array(LeaseReconcileEventSchema).optional().default([]),
});
export type LeaseReconcileEvent = z.infer<typeof LeaseReconcileEventSchema>;

/** Port of server.py `class TradeThesisStatusReq(BaseModel)`. */
export const TradeThesisStatusReqSchema = z.object({
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  account: z.string().optional().default(""),
  symbol: z.string().optional().default(""),
  ticket: z.string().optional().default(""),
  direction: z.string().optional().default(""),
  lots: z.number().nullable().optional(),
  trade_age_minutes: z.number().nullable().optional(),
  setup_type: z.string().optional().default(""),
  grade: z.string().optional().default(""),
  ai_confidence: z.number().nullable().optional(),
  thesis_score: z.number().nullable().optional(),
  hold_probability: z.number().nullable().optional(),
  exit_probability: z.number().nullable().optional(),
  state: z.string().optional().default(""),
  expected_type: z.string().optional().default(""),
  peak_profit: z.number().nullable().optional(),
  current_profit: z.number().nullable().optional(),
  protected_profit: z.number().nullable().optional(),
  hold_reason: z.string().optional().default(""),
  protect_reason: z.string().optional().default(""),
  exit_reason: z.string().optional().default(""),
  next_action: z.string().optional().default(""),
  entry_reason: z.string().optional().default(""),
  recovery_mode: z.string().optional().default(""),
  recovery_worst_pct: z.number().nullable().optional(),
  recovery_classification: z.string().optional().default(""),
  is_buy: z.boolean().nullable().optional(),
  open_price: z.number().nullable().optional(),
  current_price: z.number().nullable().optional(),
  sl: z.number().nullable().optional(),
  tp: z.number().nullable().optional(),
  dist_to_sl: z.number().nullable().optional(),
  dist_to_tp: z.number().nullable().optional(),
});
