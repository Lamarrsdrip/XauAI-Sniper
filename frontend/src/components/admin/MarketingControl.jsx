import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";

const http = axios.create({ withCredentials: true });
const BOX = "rounded-2xl border border-white/[0.08] bg-[#0c0d11]";
const INPUT = "w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-[12px] text-white outline-none focus:border-gold-300/40";

function Pill({ children, tone = "neutral" }) {
  const colors = tone === "live" ? "bg-emerald-400/10 text-emerald-300" : tone === "gpt" ? "bg-sky-400/10 text-sky-300" : "bg-white/[0.06] text-white/45";
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${colors}`}>{children}</span>;
}

function AssetCard({ kind, asset, onAction, onEdit }) {
  const [editing, setEditing] = useState(false);
  const editable = Object.fromEntries(Object.entries(asset).filter(([key]) => !["id", "campaign_id", "source", "created_at", "updated_at", "published_at", "status", "previous_asset_id"].includes(key)));
  const [json, setJson] = useState(JSON.stringify(editable, null, 2));
  const live = ["published", "sent"].includes(asset.status);
  const title = asset.headline || asset.title || asset.name || asset.subject || asset.slug || asset.id;
  const summary = asset.body || asset.short_message || asset.preview_text || (typeof asset.content === "string" ? asset.content : "");
  const primaryAction = kind === "push" ? "send" : kind === "social" ? "publish" : "publish";
  return <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-[12px] font-bold text-white/75">{title}</div><div className="mt-1 text-[9px] text-white/30">{kind} · {asset.audience || asset.slot || asset.kind || "asset"}</div></div><div className="flex gap-1"><Pill tone={live ? "live" : "neutral"}>{asset.status || "draft"}</Pill>{asset.source === "chatgpt_action" && <Pill tone="gpt">ChatGPT</Pill>}</div></div>
    {summary && <p className="mt-2 line-clamp-3 text-[10px] leading-4 text-white/38">{summary}</p>}
    <details className="mt-2"><summary className="cursor-pointer text-[9px] text-white/30">Structured preview</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-[9px] text-white/40">{JSON.stringify(asset, null, 2)}</pre></details>
    {editing && <div className="mt-2"><textarea value={json} onChange={(e) => setJson(e.target.value)} className="h-48 w-full rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[9px] text-white/50 outline-none" /><button onClick={() => { try { onEdit(kind, asset, JSON.parse(json)); setEditing(false); } catch { window.alert("Enter valid JSON."); } }} className="mt-1 rounded-lg bg-emerald-400/15 px-2.5 py-1.5 text-[9px] font-bold text-emerald-300">SAVE STRUCTURED CONTENT</button></div>}
    <div className="mt-3 flex flex-wrap gap-1.5">{kind !== "email" && <button onClick={() => setEditing((v) => !v)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[9px] font-bold text-white/55">EDIT</button>}{!live && kind !== "email" && <button onClick={() => onAction(kind, asset, primaryAction)} className="rounded-lg bg-gold-300 px-2.5 py-1.5 text-[9px] font-black text-black">{primaryAction.toUpperCase()}</button>}{live && kind !== "push" && kind !== "email" && <button onClick={() => onAction(kind, asset, "unpublish")} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[9px] font-bold text-white/55">UNPUBLISH</button>}{asset.previous_asset_id && <button onClick={() => onAction(kind, asset, "rollback")} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[9px] font-bold text-white/55">ROLL BACK</button>}{kind === "email" && <span className="text-[9px] text-white/25">Edit and send from Admin → Email</span>}</div>
  </div>;
}

export default function MarketingControl({ api }) {
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [facts, setFacts] = useState({ features: [], performance: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ objective: "", core_message: "" });
  const [creating, setCreating] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: "", objective: "", core_message: "", target_audiences: ["prospects"], approved_fact_ids: [] });

  const load = useCallback(async () => {
    const [campaignData, factData] = await Promise.all([http.get(`${api}/admin/marketing/campaigns`), http.get(`${api}/admin/marketing/facts`)]);
    setCampaigns(campaignData.data.campaigns || []); setFacts(factData.data);
  }, [api]);
  const open = useCallback(async (id) => { const response = await http.get(`${api}/admin/marketing/campaigns/${id}`); setSelected(response.data); setDraft({ objective: response.data.objective || "", core_message: response.data.core_message || "" }); }, [api]);
  useEffect(() => { load().catch(() => setError("Could not load Marketing Control.")); }, [load]);

  const save = async () => { if (!selected) return; setBusy(true); setError(""); try { const response = await http.patch(`${api}/admin/marketing/campaigns/${selected.id}`, draft); setSelected(response.data); setMessage("Campaign updated"); await load(); } catch (e) { setError(e.response?.data?.detail || "Campaign update failed."); } finally { setBusy(false); } };
  const act = async (kind, asset, action) => { if (!window.confirm(`${action.toUpperCase()} this ${kind} asset? This changes a live marketing surface or sends a notification.`)) return; setBusy(true); setError(""); try { await http.post(`${api}/admin/marketing/assets/${kind}/${asset.id}/action`, { action, confirm: true, idempotency_key: `admin-${action}-${asset.id}-${Date.now()}` }); await open(selected.id); await load(); setMessage(`${kind} ${action} accepted`); } catch (e) { setError(e.response?.data?.detail || `${kind} action failed.`); } finally { setBusy(false); } };
  const editAsset = async (kind, asset, patch) => { setBusy(true); setError(""); try { await http.patch(`${api}/admin/marketing/assets/${kind}/${asset.id}`, patch); await open(selected.id); setMessage(`${kind} draft updated; any prior approval is invalidated`); } catch (e) { setError(e.response?.data?.detail || `${kind} update failed.`); } finally { setBusy(false); } };
  const toggleFact = async (fact) => { setBusy(true); try { await http.put(`${api}/admin/marketing/facts/${fact.id}/approval`, { approved_for_marketing: !fact.approved_for_marketing }); await load(); setMessage(`Marketing approval ${fact.approved_for_marketing ? "removed" : "granted"}`); } catch (e) { setError(e.response?.data?.detail || "Fact approval failed."); } finally { setBusy(false); } };
  const createCampaign = async () => { setBusy(true); setError(""); try { const response = await http.post(`${api}/admin/marketing/campaigns`, newCampaign); setCreating(false); setNewCampaign({ name: "", objective: "", core_message: "", target_audiences: ["prospects"], approved_fact_ids: [] }); await load(); await open(response.data.id); setMessage("Campaign created"); } catch (e) { setError(e.response?.data?.detail || "Campaign creation failed."); } finally { setBusy(false); } };

  const channelGroups = selected?.channels ? [
    ["email", "email", selected.channels.email || []], ["website", "website", selected.channels.website || []], ["announcement", "announcement", selected.channels.command_center || []], ["push", "push", selected.channels.push || []], ["landing", "landing", selected.channels.landing_page || []], ["social", "social", selected.channels.social || []], ["video", "social", selected.channels.video || []], ["graphics", "social", selected.channels.graphics || []], ["faq", "social", selected.channels.faq || []],
  ] : [];

  return <div className="space-y-4" data-testid="admin-marketing-tab">
    <div className={`${BOX} p-5`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[9px] uppercase tracking-[.2em] text-gold-300/70">XauCloud Marketing Control</div><h2 className="mt-1 text-xl font-extrabold text-white">Campaigns across every controlled channel</h2><p className="mt-1 text-[11px] text-white/35">ChatGPT and the normal Admin share the same campaign records, approvals, previews, and publication state.</p></div><div className="flex gap-2"><button onClick={() => setCreating((v) => !v)} className="rounded-lg bg-gold-300 px-3 py-2 text-[10px] font-black text-black">NEW CAMPAIGN</button><button onClick={() => load()} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold text-white/55">REFRESH</button></div></div>{creating && <div className="mt-4 grid gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 sm:grid-cols-3"><input className={INPUT} placeholder="Campaign name" value={newCampaign.name} onChange={(e) => setNewCampaign((v) => ({ ...v, name: e.target.value }))} /><input className={INPUT} placeholder="Objective" value={newCampaign.objective} onChange={(e) => setNewCampaign((v) => ({ ...v, objective: e.target.value }))} /><input className={INPUT} placeholder="Core message" value={newCampaign.core_message} onChange={(e) => setNewCampaign((v) => ({ ...v, core_message: e.target.value }))} /><button disabled={busy || !newCampaign.name || !newCampaign.objective || !newCampaign.core_message} onClick={createCampaign} className="rounded-lg bg-emerald-400/15 px-3 py-2 text-[10px] font-bold text-emerald-300 disabled:opacity-30">CREATE DRAFT</button></div>}{(message || error) && <div className={`mt-3 rounded-lg px-3 py-2 text-[10px] ${error ? "bg-red-500/10 text-red-300" : "bg-emerald-400/10 text-emerald-300"}`}>{error || message}</div>}</div>

    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className={`${BOX} p-3`}><div className="mb-2 px-1 font-mono text-[9px] uppercase tracking-wider text-white/30">Campaign library</div><div className="space-y-2">{campaigns.map((campaign) => <button key={campaign.id} onClick={() => open(campaign.id)} className={`w-full rounded-xl border p-3 text-left ${selected?.id === campaign.id ? "border-gold-300/40 bg-gold-300/[0.06]" : "border-white/[0.07] bg-white/[0.025]"}`}><div className="text-[11px] font-bold text-white/75">{campaign.name}</div><div className="mt-1 flex items-center justify-between"><span className="text-[9px] text-white/30">{new Date(campaign.updated_at).toLocaleString()}</span><Pill tone={["PUBLISHED", "PARTIALLY_PUBLISHED"].includes(campaign.status) ? "live" : "neutral"}>{campaign.status}</Pill></div></button>)}{!campaigns.length && <div className="py-8 text-center text-[11px] text-white/30">No marketing campaigns yet.</div>}</div></aside>
      <main className="space-y-4">{selected ? <>
        <section className={`${BOX} p-5`}><div className="flex items-center justify-between gap-2"><div><h3 className="text-lg font-bold text-white">{selected.name}</h3><div className="mt-1 flex gap-1"><Pill>{selected.status}</Pill>{selected.source === "chatgpt_action" && <Pill tone="gpt">ChatGPT</Pill>}</div></div><button disabled={busy} onClick={save} className="rounded-lg bg-gold-300 px-3 py-2 text-[10px] font-black text-black disabled:opacity-40">SAVE CHANGES</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[10px] text-white/35">Objective<textarea className={`${INPUT} mt-1 min-h-24`} value={draft.objective} onChange={(e) => setDraft((v) => ({ ...v, objective: e.target.value }))} /></label><label className="text-[10px] text-white/35">Core message<textarea className={`${INPUT} mt-1 min-h-24`} value={draft.core_message} onChange={(e) => setDraft((v) => ({ ...v, core_message: e.target.value }))} /></label></div><div className="mt-3 text-[10px] text-white/35">Audiences: {(selected.target_audiences || []).join(", ")} · Approved facts: {(selected.approved_fact_ids || []).join(", ") || "None"}</div></section>
        {channelGroups.map(([label, kind, assets]) => <section key={label} className={`${BOX} p-4`}><div className="mb-3 flex items-center justify-between"><h3 className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-white/45">{label.replace("_", " ")}</h3><span className="text-[9px] text-white/25">{assets.length} asset{assets.length === 1 ? "" : "s"}</span></div><div className="grid gap-2 md:grid-cols-2">{assets.map((asset) => <AssetCard key={asset.id} kind={kind} asset={asset} onAction={act} onEdit={editAsset} />)}{!assets.length && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-[10px] text-white/25">No {label} asset prepared.</div>}</div></section>)}
      </> : <div className={`${BOX} flex min-h-64 items-center justify-center p-8 text-center text-[11px] text-white/30`}>Select a campaign to open its global preview and channel controls.</div>}</main>
    </div>

    <section className={`${BOX} p-4`}><div className="mb-3"><h3 className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-white/45">Approved marketing facts</h3><p className="mt-1 text-[9px] text-white/25">The GPT can read only facts currently marked approved.</p></div><div className="grid gap-2 md:grid-cols-2">{[...(facts.features || []), ...(facts.performance || [])].map((fact) => <div key={fact.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-[11px] font-bold text-white/70">{fact.name || fact.title || fact.id}</div><div className="mt-1 text-[9px] text-white/30">{fact.source || fact.source_report_identifier || "XauCloud source"}</div></div><button disabled={busy} onClick={() => toggleFact(fact)} className={`rounded-full px-2 py-1 text-[8px] font-bold ${fact.approved_for_marketing ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[0.06] text-white/35"}`}>{fact.approved_for_marketing ? "APPROVED" : "UNAPPROVED"}</button></div></div>)}</div></section>
  </div>;
}
