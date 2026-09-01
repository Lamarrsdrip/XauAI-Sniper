import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { API } from "@/lib/api";

function track(campaignId, channel, event, assetId) {
  if (!campaignId) return;
  axios.post(`${API}/marketing/events`, { campaign_id: campaignId, channel, event, asset_id: assetId }).catch(() => {});
}

export function WebsiteCampaignSlots() {
  const [slots, setSlots] = useState([]);
  useEffect(() => { axios.get(`${API}/marketing/website`).then((r) => setSlots(r.data.slots || [])).catch(() => {}); }, []);
  if (!slots.length) return null;
  return <div className="border-b border-gold-300/15 bg-gradient-to-r from-[#0d0b06] via-[#151108] to-[#0d0b06] text-white" data-testid="website-marketing-slots"><div className="mx-auto max-w-6xl space-y-3 px-4 py-5 md:px-8">{slots.map((slot) => <div key={slot.id} className="flex flex-col justify-between gap-4 rounded-2xl border border-gold-300/15 bg-gold-300/[0.04] p-4 sm:flex-row sm:items-center"><div><div className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-gold-300/70">{slot.eyebrow || "XauCloud campaign"}</div><h2 className="mt-1 text-xl font-bold">{slot.headline}</h2><p className="mt-1 max-w-3xl text-[12px] leading-5 text-white/55">{slot.body}</p></div>{slot.cta_url && <a href={slot.cta_url} onClick={() => track(slot.campaign_id, "website", "cta_click", slot.id)} className="flex-none rounded-xl bg-gold-300 px-4 py-2.5 text-center text-[11px] font-black text-black">{slot.cta_label}</a>}</div>)}</div></div>;
}

export function CommandCenterAnnouncements() {
  const [rows, setRows] = useState([]);
  useEffect(() => { axios.get(`${API}/marketing/announcements/current`, { withCredentials: true }).then((r) => setRows((r.data.announcements || []).filter((row) => !window.localStorage.getItem(`xc-announcement-${row.id}`)))).catch(() => {}); }, []);
  if (!rows.length) return null;
  return <div className="fixed left-1/2 top-[70px] z-[70] w-[calc(100%-24px)] max-w-2xl -translate-x-1/2 space-y-2" data-testid="command-marketing-announcements">{rows.map((row) => <div key={row.id} className="rounded-2xl border border-gold-300/25 bg-[#111114]/95 p-4 text-white shadow-2xl backdrop-blur-xl"><div className="flex items-start justify-between gap-3"><div><div className="text-[13px] font-bold">{row.title}</div><p className="mt-1 text-[11px] leading-5 text-white/55">{row.short_message}</p>{row.long_message && <details className="mt-1"><summary className="cursor-pointer text-[10px] text-gold-200/65">More details</summary><p className="mt-1 text-[10px] leading-5 text-white/45">{row.long_message}</p></details>}</div>{row.dismissible && <button onClick={() => { window.localStorage.setItem(`xc-announcement-${row.id}`, "1"); setRows((items) => items.filter((item) => item.id !== row.id)); track(row.campaign_id, "command_center", "dismiss", row.id); }} className="text-[10px] text-white/35">DISMISS</button>}</div>{row.cta_url && row.cta_label && <a href={row.cta_url} onClick={() => track(row.campaign_id, "command_center", "cta_click", row.id)} className="mt-3 inline-flex rounded-lg bg-gold-300 px-3 py-2 text-[10px] font-black text-black">{row.cta_label}</a>}</div>)}</div>;
}

function LandingBlock({ block, page }) {
  if (block.type === "hero") return <section className="rounded-[28px] border border-gold-300/20 bg-gold-300/[0.05] p-7 sm:p-10"><h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">{block.headline}</h1><p className="mt-4 max-w-2xl text-[15px] leading-7 text-white/55">{block.body}</p>{block.cta_url && <a href={block.cta_url} onClick={() => track(page.campaign_id, "landing_page", "cta_click", page.id)} className="mt-6 inline-flex rounded-xl bg-gold-300 px-5 py-3 text-[12px] font-black text-black">{block.cta_label || "Learn more"}</a>}</section>;
  if (["features", "performance_metrics", "faq"].includes(block.type)) return <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6"><h2 className="text-2xl font-bold">{block.headline}</h2>{block.body && <p className="mt-2 text-[13px] leading-6 text-white/50">{block.body}</p>}<div className="mt-4 grid gap-2 sm:grid-cols-2">{(block.items || []).map((item, i) => <div key={i} className="rounded-xl bg-black/25 p-4"><div className="text-[12px] font-bold text-white/75">{item.label}</div><div className="mt-1 text-[11px] leading-5 text-white/45">{item.value}</div></div>)}</div></section>;
  if (block.type === "image") return block.image_url ? <img src={block.image_url} alt={block.headline || "XauCloud campaign"} className="w-full rounded-2xl border border-white/[0.08]" /> : null;
  if (block.type === "cta") return <section className="rounded-2xl bg-white p-7 text-center text-black"><h2 className="text-2xl font-bold">{block.headline}</h2><p className="mt-2 text-[13px] text-black/60">{block.body}</p>{block.cta_url && <a href={block.cta_url} onClick={() => track(page.campaign_id, "landing_page", "cta_click", page.id)} className="mt-5 inline-flex rounded-xl bg-black px-5 py-3 text-[11px] font-black text-white">{block.cta_label || "Continue"}</a>}</section>;
  return <section className={`rounded-2xl border p-5 ${block.type === "risk" ? "border-white/[0.06] bg-white/[0.02] text-[11px] text-white/35" : "border-white/[0.08] bg-white/[0.03]"}`}><h2 className="text-xl font-bold text-white">{block.headline}</h2><p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-white/50">{block.body}</p></section>;
}

export function CampaignLandingPage() {
  const { slug } = useParams(); const [page, setPage] = useState(null); const [missing, setMissing] = useState(false);
  useEffect(() => { axios.get(`${API}/marketing/campaign/${slug}`).then((r) => setPage(r.data)).catch(() => setMissing(true)); }, [slug]);
  if (missing) return <div className="flex min-h-screen items-center justify-center bg-[#060609] text-white"><div className="text-center"><h1 className="text-2xl font-bold">Campaign not found</h1><Link to="/" className="mt-4 inline-block text-gold-300">Return to XauCloud</Link></div></div>;
  if (!page) return <div className="min-h-screen bg-[#060609]" />;
  return <div className="min-h-screen bg-[#060609] text-white"><header className="border-b border-white/[0.07]"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5"><Link to="/" className="text-lg font-black">Xau<span className="text-gold-300">Cloud</span></Link><span className="font-mono text-[9px] uppercase tracking-wider text-white/30">Campaign</span></div></header><main className="mx-auto max-w-5xl space-y-4 px-4 py-10 sm:py-16">{(page.blocks || []).map((block) => <LandingBlock key={block.id} block={block} page={page} />)}</main></div>;
}
