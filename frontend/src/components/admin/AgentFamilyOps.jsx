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
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(null);
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [busy, setBusy] = useState("");
  const [connection, setConnection] = useState(null);
  const load = useCallback(async () => {
    try {
      const [overview, list, settings] = await Promise.all([
        apiClient.get(`${api}/admin/agent-family/overview`),
        apiClient.get(`${api}/admin/agent-family/orders`),
        apiClient.get(`${api}/admin/agent-family/config`),
      ]);
      setData(overview.data);
      setOrders(list.data.orders || []);
      setConfig(settings.data);
      setForm((old) => old ?? { enabled: settings.data.enabled, publishEnabled: settings.data.publishEnabled, agentId: settings.data.agentId || "", coverUrl: settings.data.coverUrl || "" });
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

  async function saveConfiguration(event) {
    event.preventDefault(); setError(""); setNotice(""); setBusy("save");
    try {
      const payload = { ...form };
      if (accessToken.trim()) payload.accessToken = accessToken.trim();
      if (refreshToken.trim()) payload.refreshToken = refreshToken.trim();
      const response = await apiClient.put(`${api}/admin/agent-family/config`, payload);
      setConfig(response.data.config);
      setForm({ enabled: response.data.config.enabled, publishEnabled: response.data.config.publishEnabled, agentId: response.data.config.agentId, coverUrl: response.data.config.coverUrl });
      setAccessToken(""); setRefreshToken("");
      setNotice("Agent.family settings saved securely. Marketplace actions follow the switches you selected.");
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save Agent.family configuration.");
    } finally { setBusy(""); }
  }

  async function testConnection() {
    setBusy("test"); setError(""); setNotice("");
    try {
      const response = await apiClient.post(`${api}/admin/agent-family/config/test`);
      setConnection(response.data);
      setNotice(response.data.detail || "Connection checked.");
    } catch (err) {
      setConnection({ connected: false });
      setError(err.response?.data?.detail || "Agent.family connection test failed.");
    } finally { setBusy(""); }
  }

  async function revokeCredentials() {
    if (!window.confirm("Disconnect Agent.family, disable publishing and clear the stored connection credentials?")) return;
    setBusy("revoke"); setError(""); setNotice("");
    try {
      const response = await apiClient.put(`${api}/admin/agent-family/config`, {
        enabled: false, publishEnabled: false, clearAccessToken: true, clearRefreshToken: true,
      });
      setConfig(response.data.config);
      setForm({ enabled: false, publishEnabled: false, agentId: response.data.config.agentId, coverUrl: response.data.config.coverUrl });
      setAccessToken(""); setRefreshToken(""); setConnection(null);
      setNotice("Admin-managed credentials cleared and Agent.family processing disabled. Revoke old sessions in Agent.family as well.");
      await load();
    } catch (err) { setError(err.response?.data?.detail || "Could not disconnect."); }
    finally { setBusy(""); }
  }

  if (!data) return <div className="text-sm text-white/50">{error || "Loading Agent.family operations…"}</div>;
  const revenue = data.revenue || {};
  return (
    <div className="space-y-5" data-testid="admin-agent-family">
      <div>
        <h2 className="font-heading text-2xl font-semibold text-white">Agent.family</h2>
        <p className="mt-1 max-w-3xl text-sm text-white/45">Paid research orders use owner-approved MT5 sources already connected to XauCloud. Live trading stays off. Revenue counts only after marketplace settlement, and sandbox rows are excluded.</p>
      </div>
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-6" aria-label="Agent.family configuration">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Connect Agent.family</h3>
            <p className="mt-1 text-xs text-white/50">Register and authorize your wallet on Agent.family, then enter your provider details here. Never paste a wallet seed phrase or private key.</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${config?.connectionReady ? "border-emerald-500/40 text-emerald-300" : "border-amber-400/30 text-amber-200"}`}>
            {config?.connectionReady ? "Credentials saved" : "Not connected"}
          </span>
        </div>
        <form className="mt-5 space-y-4" onSubmit={saveConfiguration}>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block space-y-1 text-xs text-white/70">
              <span>Agent.family Agent ID</span>
              <input value={form?.agentId || ""} onChange={(e) => setForm((v) => ({ ...v, agentId: e.target.value }))} maxLength={128}
                autoComplete="off" placeholder="Provider agent ID" className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25" />
            </label>
            <label className="block space-y-1 text-xs text-white/70">
              <span>Listing cover image (HTTPS)</span>
              <input type="url" value={form?.coverUrl || ""} onChange={(e) => setForm((v) => ({ ...v, coverUrl: e.target.value }))}
                placeholder="https://xaucloud.io/.../cover.png" className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25" />
            </label>
            <label className="block space-y-1 text-xs text-white/70">
              <span>TermiX access token {config?.accessTokenConfigured ? "· already stored" : "· required"}</span>
              <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} autoComplete="new-password"
                placeholder={config?.accessTokenConfigured ? "Leave blank to keep existing token" : "Paste access token"} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25" />
            </label>
            <label className="block space-y-1 text-xs text-white/70">
              <span>Refresh token {config?.refreshTokenConfigured ? "· already stored" : "· optional"}</span>
              <input type="password" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} autoComplete="new-password"
                placeholder="Leave blank to keep existing token" className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25" />
            </label>
          </div>
          <div className="flex flex-wrap gap-5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
              <input type="checkbox" checked={!!form?.enabled} onChange={(e) => setForm((v) => ({ ...v, enabled: e.target.checked, publishEnabled: e.target.checked ? v.publishEnabled : false }))} />
              Enable paid-order processing
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
              <input type="checkbox" checked={!!form?.publishEnabled} disabled={!form?.enabled} onChange={(e) => setForm((v) => ({ ...v, publishEnabled: e.target.checked }))} />
              Allow publishing service listings
            </label>
          </div>
          <p className="text-xs text-white/40">Publishing is a separate opt-in. Disabled services remain unpublished. Wallet signatures are still completed using your connected Agent.family wallet—not by this server. Approved MT5 sources are configured in XauCloud's existing signal-source settings.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={!!busy || !form} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black disabled:opacity-50">
              {busy === "save" ? "Saving…" : "Save configuration"}
            </button>
            <button type="button" disabled={!!busy} onClick={testConnection} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy === "test" ? "Checking…" : "Test connection"}
            </button>
            <button type="button" disabled={!!busy} onClick={revokeCredentials} className="rounded-xl border border-rose-400/30 px-4 py-2 text-sm text-rose-200 disabled:opacity-50">
              Disconnect
            </button>
          </div>
          {connection?.connected && <p className="text-xs text-emerald-300">TermiX authenticated API reachable. Registration ownership, funded orders, and settlement are not verified by this test.</p>}
          {config?.updatedAt && <p className="text-[11px] text-white/35">Settings last updated: {new Date(config.updatedAt).toLocaleString()}</p>}
        </form>
      </section>
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
