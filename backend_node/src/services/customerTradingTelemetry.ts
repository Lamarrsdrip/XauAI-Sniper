import { getDb } from "../db.js";

export interface CustomerTradingLookup {
  user_id?: string;
  email?: string;
  license_id?: string;
  mt5_account?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

type Row = Record<string, unknown>;

function n(value: unknown): number | null {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function explicitProfit(row: Row): number | null {
  const details = (row["details"] ?? {}) as Row;
  for (const key of ["realized_profit", "profit_usd", "profit", "pnl", "profit_loss", "net_profit"]) {
    const value = n(details[key] ?? row[key]);
    if (value !== null) return value;
  }
  return null;
}

function sanitizeActivity(row: Row): Row {
  return {
    id: s(row["id"]),
    ts: iso(row["ts"]),
    event_type: s(row["event_type"]),
    severity: s(row["severity"]),
    category: s(row["event_category"]),
    symbol: s(row["symbol"]),
    message: s(row["message"]).slice(0, 600),
    trade_ticket: s(row["ticket"]) || null,
    profit: explicitProfit(row),
  };
}

export function licenseSourceType(row: Row | null): string {
  if (!row) return "unknown_legacy";
  const source = `${s(row["source"])} ${s(row["source_type"])} ${s(row["issued_by"])}`.toLowerCase();
  const provider = s(row["payment_provider"] ?? row["provider"]).toLowerCase();
  const paymentRef = s(row["payment_ref"] ?? row["payment_reference"]);
  if (source.includes("promo")) return "promotional";
  if (source.includes("bank") || provider.includes("bank")) return "bank_transfer";
  if (source.includes("manual") || source.includes("admin")) return "manual_admin";
  if (source.includes("legacy") || source.includes("migration")) return "legacy_migration";
  if (paymentRef) return "paid_order";
  return "unknown_legacy";
}

async function resolveIdentity(input: CustomerTradingLookup): Promise<{
  user: Row | null;
  license: Row | null;
  email: string;
  mt5Account: string;
  licenseKey: string;
}> {
  const db = getDb();
  let user: Row | null = null;
  let license: Row | null = null;
  let email = s(input.email).toLowerCase();

  if (input.user_id) {
    user = await db.collection("cloud_users").findOne(
      { id: input.user_id },
      { projection: { _id: 0, password_hash: 0, reset_token: 0, session_token: 0 } },
    ) as Row | null;
  } else if (email) {
    user = await db.collection("cloud_users").findOne(
      { email },
      { projection: { _id: 0, password_hash: 0, reset_token: 0, session_token: 0 } },
    ) as Row | null;
  }

  email = email || s(user?.["email"]).toLowerCase();

  if (input.license_id) {
    license = await db.collection("pin_licenses").findOne(
      { $or: [{ id: input.license_id }, { pin: input.license_id }] },
      { projection: { _id: 0 } },
    ) as Row | null;
  } else if (email) {
    license = await db.collection("pin_licenses").findOne(
      { buyer_email: email },
      { projection: { _id: 0 }, sort: { created_at: -1 } },
    ) as Row | null;
  }

  email = email || s(license?.["buyer_email"]).toLowerCase();
  let mt5Account = s(input.mt5_account) || s(license?.["mt5_account"]);
  const licenseKey = s(license?.["pin"]);

  // Fallback for the "No MT5 account or linked license is available" gap:
  // the customer's most-recent license record (the one `sort: created_at
  // -1` above picked) may not carry an mt5_account -- e.g. a renewal or
  // re-linked license that hasn't been backfilled yet -- even though an
  // OLDER license for the same email does, and that older license's account
  // is exactly what the EA's live cloud_bot_activity is keyed under. Search
  // every license for this email, not just the newest, before concluding
  // trade history is genuinely unavailable for this customer.
  if (!mt5Account && email) {
    const linked = await db.collection("pin_licenses").findOne(
      { buyer_email: email, mt5_account: { $exists: true, $ne: "" } },
      { projection: { _id: 0, mt5_account: 1 }, sort: { created_at: -1 } },
    ) as Row | null;
    mt5Account = s(linked?.["mt5_account"]);
  }

  return { user, license, email, mt5Account, licenseKey };
}

function activityScope(mt5Account: string, licenseKey: string): Row | null {
  const ors: Row[] = [];
  if (mt5Account) ors.push({ account: mt5Account });
  if (licenseKey) ors.push({ license_key: licenseKey });
  return ors.length ? { $or: ors } : null;
}

function heartbeatScope(mt5Account: string, licenseKey: string): Row | null {
  const ors: Row[] = [];
  if (mt5Account) ors.push({ account_number: mt5Account });
  if (licenseKey) ors.push({ license_key: licenseKey }, { pin: licenseKey });
  return ors.length ? { $or: ors } : null;
}

export async function getCustomerTradingSummary(input: CustomerTradingLookup): Promise<Row> {
  const db = getDb();
  const identity = await resolveIdentity(input);
  const hScope = heartbeatScope(identity.mt5Account, identity.licenseKey);
  const aScope = activityScope(identity.mt5Account, identity.licenseKey);

  const heartbeat = hScope
    ? await db.collection("cloud_bot_heartbeats").findOne(hScope, { projection: { _id: 0 }, sort: { ts: -1 } }) as Row | null
    : null;

  const recent = aScope
    ? await db.collection("cloud_bot_activity")
        .find({ ...aScope, event_category: { $in: ["entries", "exits"] } }, { projection: { _id: 0 } })
        .sort({ ts: -1 }).limit(500).toArray() as Row[]
    : [];

  const exits = recent.filter((row) => s(row["event_category"]) === "exits" || s(row["severity"]).toUpperCase() === "EXIT");
  const entries = recent.filter((row) => s(row["event_category"]) === "entries" || ["ENTRY", "TRADE"].includes(s(row["severity"]).toUpperCase()));
  const explicit = exits.map(explicitProfit).filter((x): x is number => x !== null);
  const wins = explicit.filter((x) => x > 0).length;
  const losses = explicit.filter((x) => x < 0).length;
  const grossProfit = explicit.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(explicit.filter((x) => x < 0).reduce((a, b) => a + b, 0));

  const balance = heartbeat ? n(heartbeat["balance"]) : null;
  const equity = heartbeat ? n(heartbeat["equity"]) : null;
  const floating =
    balance !== null && equity !== null && (balance !== 0 || equity !== 0)
      ? Number((equity - balance).toFixed(2))
      : null;
  const hbTs = iso(heartbeat?.["ts"]);
  const stale = hbTs ? Date.now() - new Date(hbTs).getTime() > 120_000 : true;
  const available = Boolean(heartbeat || recent.length);

  return {
    available,
    unavailable_reason: available ? null : "No persisted XauCloud EA heartbeat or trading activity was found for this customer.",
    mt5_account: identity.mt5Account || s(heartbeat?.["account_number"]) || null,
    symbol_scope: s(heartbeat?.["symbol"]) || null,
    account_total: {
      balance,
      equity,
      floating_profit: floating,
      daily_pnl: heartbeat ? n(heartbeat["daily_pnl"]) : null,
      realized_profit: null,
      total_profit: null,
      deposits: heartbeat ? n(heartbeat["deposits"]) : null,
      withdrawals: heartbeat ? n(heartbeat["withdrawals"]) : null,
      net_account_change: null,
      note: "The heartbeat reports current account state. Lifetime realized P&L is not claimed unless explicit closed-trade profit is persisted.",
    },
    xaucloud_attributed: {
      realized_profit: explicit.length ? Number(explicit.reduce((a, b) => a + b, 0).toFixed(2)) : null,
      floating_profit: null,
      closed_trades_with_explicit_profit: explicit.length,
      note: explicit.length
        ? "Derived only from persisted XauCloud exit events that contain an explicit profit field."
        : "No explicit per-exit profit values are currently persisted in the retained XauCloud activity rows.",
    },
    open_positions_count: heartbeat ? n(heartbeat["open_positions"]) : null,
    closed_trades_count: exits.length,
    entry_events_count: entries.length,
    winning_trades: explicit.length ? wins : null,
    losing_trades: explicit.length ? losses : null,
    win_rate: explicit.length ? Number(((wins / explicit.length) * 100).toFixed(2)) : null,
    gross_profit: explicit.length ? Number(grossProfit.toFixed(2)) : null,
    gross_loss: explicit.length ? Number(grossLossAbs.toFixed(2)) : null,
    profit_factor: explicit.length && grossLossAbs > 0 ? Number((grossProfit / grossLossAbs).toFixed(4)) : null,
    max_drawdown: heartbeat ? n(heartbeat["drawdown"]) : null,
    first_trade_at: recent.length ? iso(recent[recent.length - 1]?.["ts"]) : null,
    last_trade_at: recent.length ? iso(recent[0]?.["ts"]) : null,
    mt5_connected: heartbeat ? Boolean(heartbeat["mt5_connected"] ?? heartbeat["account_connected"]) : false,
    data_source: heartbeat ? "cloud_bot_heartbeats+cloud_bot_activity" : recent.length ? "cloud_bot_activity" : null,
    last_updated_at: hbTs ?? (recent.length ? iso(recent[0]?.["ts"]) : null),
    stale,
  };
}

export async function getCustomerTradingHistory(input: CustomerTradingLookup): Promise<Row> {
  const db = getDb();
  const identity = await resolveIdentity(input);
  const scope = activityScope(identity.mt5Account, identity.licenseKey);
  if (!scope) return { available: false, events: [], unavailable_reason: "No MT5 account or linked license is available." };

  const filter: Row = { ...scope, event_category: { $in: ["entries", "exits"] } };
  if (input.from || input.to) {
    filter["ts"] = {
      ...(input.from ? { $gte: input.from } : {}),
      ...(input.to ? { $lte: input.to } : {}),
    };
  }
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);
  const rows = await db.collection("cloud_bot_activity")
    .find(filter, { projection: { _id: 0 } })
    .sort({ ts: -1 }).skip(offset).limit(limit).toArray() as Row[];
  return {
    available: rows.length > 0,
    mt5_account: identity.mt5Account || null,
    events: rows.map(sanitizeActivity),
    data_source: "cloud_bot_activity",
  };
}

export async function getCustomerOpenPositions(input: CustomerTradingLookup): Promise<Row> {
  const summary = await getCustomerTradingSummary(input);
  return {
    available: Boolean(summary["available"]),
    mt5_account: summary["mt5_account"] ?? null,
    open_positions_count: summary["open_positions_count"] ?? null,
    positions: [],
    position_detail_available: false,
    note: "The current persisted heartbeat exposes an open-position count, not a canonical per-position snapshot. No position rows are fabricated.",
    last_updated_at: summary["last_updated_at"] ?? null,
  };
}

export async function getCustomerClosedTrades(input: CustomerTradingLookup): Promise<Row> {
  const db = getDb();
  const identity = await resolveIdentity(input);
  const scope = activityScope(identity.mt5Account, identity.licenseKey);
  if (!scope) return { available: false, trades: [], unavailable_reason: "No MT5 account or linked license is available." };
  const filter: Row = {
    ...scope,
    $or: [{ event_category: "exits" }, { severity: "EXIT" }, { event_type: { $regex: "EXIT|CLOSE|CLOSED" } }],
  };
  if (input.from || input.to) {
    filter["ts"] = {
      ...(input.from ? { $gte: input.from } : {}),
      ...(input.to ? { $lte: input.to } : {}),
    };
  }
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);
  const rows = await db.collection("cloud_bot_activity")
    .find(filter, { projection: { _id: 0 } })
    .sort({ ts: -1 }).skip(offset).limit(limit).toArray() as Row[];
  return {
    available: rows.length > 0,
    mt5_account: identity.mt5Account || null,
    trades: rows.map(sanitizeActivity),
    data_source: "cloud_bot_activity",
  };
}

export async function getCustomerPerformanceRange(input: CustomerTradingLookup): Promise<Row> {
  const closed = await getCustomerClosedTrades({ ...input, limit: Math.min(200, input.limit ?? 200), offset: 0 });
  const trades = (closed["trades"] as Row[] | undefined) ?? [];
  const profits = trades.map((t) => n(t["profit"])).filter((x): x is number => x !== null);
  const wins = profits.filter((x) => x > 0).length;
  const losses = profits.filter((x) => x < 0).length;
  const grossProfit = profits.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(profits.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  return {
    available: Boolean(closed["available"]),
    mt5_account: closed["mt5_account"] ?? null,
    from: input.from ?? null,
    to: input.to ?? null,
    explicit_profit_trade_count: profits.length,
    realized_profit: profits.length ? Number(profits.reduce((a, b) => a + b, 0).toFixed(2)) : null,
    winning_trades: profits.length ? wins : null,
    losing_trades: profits.length ? losses : null,
    win_rate: profits.length ? Number(((wins / profits.length) * 100).toFixed(2)) : null,
    gross_profit: profits.length ? Number(grossProfit.toFixed(2)) : null,
    gross_loss: profits.length ? Number(grossLoss.toFixed(2)) : null,
    profit_factor: profits.length && grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(4)) : null,
    data_source: "cloud_bot_activity",
    note: "Range metrics use only retained exit rows that carry an explicit profit value.",
  };
}

export async function resolveSupportLinks(input: { user_id?: string; email?: string }): Promise<Row> {
  const db = getDb();
  const identity = await resolveIdentity(input);
  const license = identity.license;
  const licenseId = s(license?.["id"]);
  const relatedLicenseIds = licenseId ? [licenseId] : [];

  const orderIds: string[] = [];
  if (license) {
    const paymentRef = s(license["payment_ref"] ?? license["payment_reference"]);
    if (paymentRef) {
      const order = await db.collection("payment_transactions").findOne({ reference: paymentRef }, { projection: { _id: 0, reference: 1 } });
      if (order?.["reference"]) orderIds.push(s(order["reference"]));
    } else if (s(license["pin"])) {
      const order = await db.collection("payment_transactions").findOne(
        { pin_generated: s(license["pin"]) },
        { projection: { _id: 0, reference: 1 } },
      );
      if (order?.["reference"]) orderIds.push(s(order["reference"]));
    }
  }

  const deliveryIds: string[] = [];
  if (identity.email) {
    const rows = await db.collection("admin_email_log")
      .find(
        { $or: [{ to: identity.email }, { recipient: identity.email }, { canonical_recipient: identity.email }, { email: identity.email }] },
        { projection: { _id: 0, id: 1, delivery_id: 1, campaign_id: 1 } },
      )
      .sort({ at: -1, created_at: -1 }).limit(20).toArray();
    for (const row of rows) {
      const id = s(row["id"] ?? row["delivery_id"] ?? row["campaign_id"]);
      if (id && !deliveryIds.includes(id)) deliveryIds.push(id);
    }
  }

  return {
    user_id: s(identity.user?.["id"]) || input.user_id || null,
    email: identity.email || null,
    mt5_account: identity.mt5Account || null,
    related_license_ids: relatedLicenseIds,
    related_order_ids: orderIds,
    related_email_delivery_ids: deliveryIds,
    license_source_type: licenseSourceType(license),
  };
}

export async function buildSupportCaseContext(ticketId: string): Promise<Row> {
  const db = getDb();
  const ticket = await db.collection("support_tickets").findOne(
    { id: ticketId },
    { projection: { _id: 0, customer_private_notes: 0, internal_notes: 0 } },
  ) as Row | null;
  if (!ticket) throw Object.assign(new Error("Support ticket not found."), { statusCode: 404 });

  const links = await resolveSupportLinks({
    user_id: s(ticket["customer_user_id"]) || undefined,
    email: s(ticket["customer_email"]) || undefined,
  });

  const trading = await getCustomerTradingSummary({
    user_id: s(ticket["customer_user_id"]) || undefined,
    email: s(ticket["customer_email"]) || undefined,
    mt5_account: s(links["mt5_account"]) || undefined,
  });

  const user = links["user_id"]
    ? await db.collection("cloud_users").findOne(
        { id: links["user_id"] },
        { projection: { _id: 0, password_hash: 0, reset_token: 0, session_token: 0 } },
      ) as Row | null
    : null;

  const licenseId = ((links["related_license_ids"] as string[] | undefined) ?? [])[0];
  let license: Row | null = null;
  if (licenseId) {
    license = await db.collection("pin_licenses").findOne({ id: licenseId }, { projection: { _id: 0, pin: 0 } }) as Row | null;
  } else if (links["email"]) {
    license = await db.collection("pin_licenses").findOne(
      { buyer_email: links["email"] },
      { projection: { _id: 0, pin: 0 }, sort: { created_at: -1 } },
    ) as Row | null;
  }

  const orderId = ((links["related_order_ids"] as string[] | undefined) ?? [])[0];
  const order = orderId
    ? await db.collection("payment_transactions").findOne({ reference: orderId }, { projection: { _id: 0 } }) as Row | null
    : null;

  let likelyIssue = "NO_CLEAR_FAILURE";
  let confidence = 0.35;
  const evidence: string[] = [];
  const missingData: string[] = [];
  let recommended = "none";

  if (user?.["disabled_at"]) {
    likelyIssue = "ACCOUNT_DISABLED"; confidence = 0.98; evidence.push("customer account is disabled"); recommended = "review_account_status";
  } else if (user && !Boolean(user["email_verified"] ?? user["verified"])) {
    likelyIssue = "EMAIL_UNVERIFIED"; confidence = 0.9; evidence.push("customer email is not verified"); recommended = "prepare_resend_verification";
  } else if (license && !Boolean(license["is_active"] ?? license["active"])) {
    likelyIssue = "LICENSE_INACTIVE"; confidence = 0.95; evidence.push("linked license is inactive"); recommended = "review_license";
  } else if (!links["mt5_account"]) {
    likelyIssue = "MT5_NOT_CONNECTED"; confidence = 0.85; evidence.push("no MT5 account is bound to the linked license"); recommended = "guide_mt5_connection";
  } else if (!trading["available"]) {
    likelyIssue = "TRADING_TELEMETRY_UNAVAILABLE"; confidence = 0.85; evidence.push("no persisted heartbeat/trading telemetry was found"); recommended = "check_ea_heartbeat";
  } else if (license && !order && ["legacy_migration", "manual_admin", "unknown_legacy"].includes(s(links["license_source_type"]))) {
    likelyIssue = "NO_ORDER_LEGACY_LICENSE"; confidence = 0.8; evidence.push(`license source is ${s(links["license_source_type"])}`); recommended = "none";
  }

  if (!user) missingData.push("user");
  if (!license) missingData.push("license");
  if (!order) missingData.push("deterministically_linked_order");
  if (!trading["available"]) missingData.push("trading_telemetry");

  let suggested = "We reviewed your XauCloud account and support case. ";
  if (trading["available"]) {
    const account = trading["account_total"] as Row;
    suggested += `The latest XauCloud EA heartbeat for MT5 account ${s(trading["mt5_account"]) || "your linked account"} reports `;
    suggested += `balance ${account["balance"] ?? "unavailable"} and equity ${account["equity"] ?? "unavailable"}. `;
    suggested += "Lifetime realized profit is only stated when XauCloud has explicit persisted closed-trade profit data.";
  } else {
    suggested += "We cannot safely state your personal trading profit because current XauCloud telemetry is unavailable for this account.";
  }

  return {
    ticket: {
      ...ticket,
      related_license_ids: links["related_license_ids"],
      related_order_ids: links["related_order_ids"],
      related_email_delivery_ids: links["related_email_delivery_ids"],
    },
    customer: {
      user_id: links["user_id"],
      email: links["email"],
      mt5_account: links["mt5_account"],
    },
    user_status: user ? (user["disabled_at"] ? "DISABLED" : "ACTIVE") : null,
    license_status: license ? (license["is_active"] ? "ACTIVE" : "INACTIVE") : null,
    license_source_type: links["license_source_type"],
    order_payment_status: order ? s(order["payment_status"]) : null,
    trading_summary: trading,
    likely_issue: likelyIssue,
    confidence,
    evidence,
    missing_data: missingData,
    suggested_response_draft: suggested,
    recommended_safe_action: recommended,
    warnings: ["No remediation was performed.", "Public replay/backtest results are never used as the customer's personal P&L."],
  };
}
