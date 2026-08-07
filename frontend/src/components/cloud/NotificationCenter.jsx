import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Bell, X, Check, CheckCheck, Loader2 } from "lucide-react";
import { API } from "@/lib/api";

const centerAxios = axios.create({ baseURL: API, withCredentials: true });

const CATEGORY_LABELS = {
  ALL: "All",
  TRADES: "Trades",
  MARKET_OUTLOOK: "Market Outlook",
  SIGNALS: "Signals",
  LICENSE: "License",
  BOT_UPDATES: "Bot Updates",
  PAYMENTS: "Payments",
  SYSTEM: "System",
  SUPPORT: "Support",
};
const CATEGORY_ORDER = ["ALL", "TRADES", "MARKET_OUTLOOK", "SIGNALS", "LICENSE", "BOT_UPDATES", "PAYMENTS", "SYSTEM", "SUPPORT"];

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Small bell icon with a live unread badge -- polls the same feed endpoint
// the full panel uses, so the count is always backend-authoritative (never
// a client-side guess based on which notifications this tab has seen).
export function NotificationBell({ onClick }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data } = await centerAxios.get("/notifications/center", { params: { limit: 1 } });
      setUnread(data?.unread_total || 0);
    } catch (_) { /* advisory only */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <button onClick={onClick} className="relative rounded-full border border-white/[0.07] bg-white/[0.03] p-2 text-white/45 hover:text-white transition" data-testid="notification-bell">
      <Bell className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold-300 px-1 font-mono text-[9px] font-bold text-black">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

function NotificationRow({ item, onMarkRead }) {
  const unread = !item.read_at;
  return (
    <div
      className={`rounded-xl border px-4 py-3 transition ${unread ? "border-gold-300/20 bg-gold-300/[0.04]" : "border-white/[0.06] bg-white/[0.015]"}`}
      onClick={() => unread && onMarkRead(item.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {unread && <span className="h-1.5 w-1.5 flex-none rounded-full bg-gold-300" />}
            <span className={`truncate text-[13px] font-semibold ${unread ? "text-white" : "text-white/70"}`}>{item.title || "Notification"}</span>
          </div>
          <p className="mt-1 text-[12px] leading-4 text-white/50">{item.body}</p>
        </div>
        <span className="flex-none font-mono text-[9px] text-white/30">{timeAgo(item.sent_time || item.scheduled_time)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded-full border border-white/[0.06] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/35">
          {CATEGORY_LABELS[item.category] || item.category}
        </span>
        {item.delivery_status === "FAILED" && (
          <span className="font-mono text-[9px] text-rose-300/70">Delivery failed — retrying</span>
        )}
      </div>
    </div>
  );
}

// Full-screen slide-over feed: category tabs (with per-category unread
// counts), pagination, mark-one/mark-all read -- all backed by
// GET/POST /notifications/center|read|read-all, never client-local state.
export default function NotificationCenterPanel({ open, onClose }) {
  const [category, setCategory] = useState("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (targetPage, append) => {
    setLoading(true);
    try {
      const { data } = await centerAxios.get("/notifications/center", {
        params: { category: category === "ALL" ? undefined : category, unread_only: unreadOnly || undefined, page: targetPage, limit: 20 },
      });
      setItems((prev) => (append ? [...prev, ...(data?.items || [])] : data?.items || []));
      setCounts(data?.category_counts || {});
      setHasMore(Boolean(data?.has_more));
      setPage(targetPage);
    } catch (_) { /* advisory only */ } finally {
      setLoading(false);
    }
  }, [category, unreadOnly]);

  useEffect(() => {
    if (!open) return;
    load(1, false);
  }, [open, load]);

  const markRead = useCallback(async (id) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, read_at: new Date().toISOString() } : it)));
    try { await centerAxios.post(`/notifications/${id}/read`); } catch (_) { /* best-effort */ }
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((it) => ({ ...it, read_at: it.read_at || new Date().toISOString() })));
    try {
      await centerAxios.post("/notifications/read-all", null, { params: { category: category === "ALL" ? undefined : category } });
      load(1, false);
    } catch (_) { /* best-effort */ }
  }, [category, load]);

  if (!open) return null;

  const totalUnread = Object.values(counts).reduce((sum, c) => sum + (c?.unread || 0), 0);

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-white/[0.08] bg-[#07080b]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 pb-3 pt-safe-top">
          <div>
            <div className="text-[15px] font-bold">Notifications</div>
            <div className="mt-0.5 font-mono text-[10px] text-white/35">{totalUnread > 0 ? `${totalUnread} unread` : "You're all caught up"}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={markAllRead} className="flex min-h-[40px] items-center gap-1 rounded-full border border-white/[0.07] px-3 text-[11px] text-white/50 hover:text-white">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
            <button onClick={onClose} aria-label="Close" className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/[0.07] text-white/45 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="native-scroll flex gap-1.5 overflow-x-auto border-b border-white/[0.06] px-4 py-2.5">
          {CATEGORY_ORDER.map((cat) => {
            const count = cat === "ALL"
              ? Object.values(counts).reduce((s, c) => s + (c?.unread || 0), 0)
              : counts[cat]?.unread || 0;
            return (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`flex-none rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${category === cat ? "border-gold-300/40 bg-gold-300/[0.08] text-gold-100" : "border-white/[0.06] text-white/45 hover:border-white/15"}`}>
                {CATEGORY_LABELS[cat]}{count > 0 ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-[11px] text-white/45">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="accent-gold-300" />
          Unread only
        </label>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {items.map((item) => <NotificationRow key={item.id} item={item} onMarkRead={markRead} />)}
          {items.length === 0 && !loading && (
            <p className="py-10 text-center text-[12px] text-white/35">No notifications here yet.</p>
          )}
          {loading && items.length === 0 && (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
          )}
          {hasMore && (
            <button onClick={() => load(page + 1, true)} disabled={loading}
                    className="w-full rounded-xl border border-white/[0.07] py-2.5 text-[11px] text-white/50 hover:text-white disabled:opacity-50">
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
