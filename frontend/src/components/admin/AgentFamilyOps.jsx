import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";

const apiClient = axios.create({ withCredentials: true });

function money(value) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AgentFamilyOps({ api }) {
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tx, setTx] = useState({});
  const load = useCallback(async () => {
    try {
      const [overview, list] = await Promise.all([
        apiClient.get(`${api}/admin/agent-family/overview`),
        apiClient.get(`${api}/admin/agent-family/orders`),
      ]);
      setData(overview.data);
      setOrders(list.data.orders || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.detail || "Agent.family operations could not be loaded.");
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  async function report(actionId) {
    setNotice(""); setError("");
    try {
      const response = await apiClient.post(`${api}/admin/agent-family/wallet-actions/${actionId}/report-tx`, { txHash: (tx[actionId] || "").trim() });
      setNotice(response.data.note || "Transaction hash recorded.");
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "The transaction hash was not accepted.");
    }
  }

  if (!data) return <div className="text-sm text-white/50">{error || "Loading Agent.family operations…"}</div>;
  const revenue = data.revenue || {};
  return (
    <div className="space-y-5" data-testid="admin-agent-family">
      <div>
        <h2 className="font-heading text-2xl font-semibold text-white">Agent.family</h2>
        <p className="mt-1 max-w-3xl text-sm text-white/45">Paid research orders use owner-approved MT5 sources already connected to XauCloud. Live trading stays off. Revenue counts only after marketplace settlement, and sandbox rows are excluded.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-xl border border-white/15 px-3 py-2 text-xs font-bold" onClick={async () => {
          setError(""); setNotice("");
          try {
            const response = await apiClient.post(`${api}/admin/agent-family/listings/sync`);
            setNotice(`Listing sync finished. Created ${response.data.created?.length || 0}, already present ${response.data.alreadyPresent?.length || 0}, blocked ${response.data.blocked?.length || 0}.`);
          } catch (err) {
            setError(err.response?.data?.detail || "Listing sync did not run.");
          }
        }}>Sync draft listings</button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-300">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 p-3 text-sm text-emerald-200">{notice}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Marketplace", data.marketplaceEnabled ? "Enabled" : "Disabled"],
          ["Publishing", data.publishEnabled ? "Enabled" : "Drafts only"],
          ["Net revenue", money(revenue.netRevenue)],
          ["Settled orders", String(revenue.settledOrders ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">{label}</div>
            <div className="mt-2 font-mono text-xl font-black text-white">{value}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-white/10 p-4 text-sm text-white/70">
        <div>Gross {money(revenue.grossSales)} · fees {money(revenue.marketplaceFees)} · refunds {money(revenue.refunds)} · estimated compute {money(revenue.estimatedComputationCost)}</div>
        <div className="mt-1 text-white/40">Success rate {data.successRate?.rate === null || data.successRate?.rate === undefined ? "—" : `${Math.round(data.successRate.rate * 1000) / 10}%`} · average fulfillment {data.averageFulfillmentMs === null ? "—" : `${data.averageFulfillmentMs} ms`}</div>
        <div className="mt-1 text-white/40">Approved sources {data.sources?.approved ?? 0} · fresh {data.sources?.fresh ? "yes" : "no"} · sample quotes {data.sources?.spreadSamples ?? 0} · account tail {data.sources?.accountTail || "—"}</div>
        <p className="mt-2 text-xs text-white/35">{revenue.definition}</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-[12.5px]">
          <thead className="text-white/40"><tr><th className="px-3 py-2">Service</th><th>Price</th><th>State</th><th>Why</th></tr></thead>
          <tbody>
            {data.services.map((service) => (
              <tr key={service.id} className="border-t border-white/10 text-white/80">
                <td className="px-3 py-2">{service.title}</td>
                <td>${service.priceUsd}</td>
                <td>{service.publishable ? "Fulfillment ready" : "Unpublished"}</td>
                <td className="pr-3 text-white/45">{service.disabledReason || "Working computation. Not listed until you publish."}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-[12.5px]">
          <thead className="text-white/40"><tr><th className="px-3 py-2">Order</th><th>Service</th><th>Status</th><th>Mode</th><th>Wallet</th></tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td className="px-3 py-3 text-white/40" colSpan={5}>No orders yet.</td></tr>}
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-white/10 align-top text-white/80">
                <td className="px-3 py-2 font-mono text-[11px]">{order.marketplaceOrderId}</td>
                <td>{order.serviceId || "—"}</td>
                <td>{order.status}{order.failureDetail ? <div className="text-white/40">{order.failureDetail}</div> : null}</td>
                <td>{order.mode}</td>
                <td className="space-y-2 pr-3">
                  {order.walletActions.filter((action) => action.status !== "CONFIRMED").map((action) => (
                    <div key={action.id} className="space-y-1">
                      <div className="text-white/50">{action.kind} · {action.status}</div>
                      <div className="flex gap-2">
                        <input aria-label={`Transaction hash for ${action.kind}`} value={tx[action.id] || ""} onChange={(event) => setTx({ ...tx, [action.id]: event.target.value })} className="w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 font-mono text-[11px]" placeholder="0x…" />
                        <button type="button" onClick={() => report(action.id)} className="rounded-lg border border-white/15 px-2 py-1.5 text-[11px] font-bold">Report</button>
                      </div>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
