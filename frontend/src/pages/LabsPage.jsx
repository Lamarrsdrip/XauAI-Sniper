import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChartLineUp, CheckCircle } from "@phosphor-icons/react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import { API } from "@/lib/api";

// Relocated from the public homepage (2026-07-25 redesign) -- unreleased/
// experimental products no longer appear in the main marketing flow, where
// a visitor would scroll through a product they can't buy. Same backend
// contract as before (GET /download/xauindex/info), just its own page.
export default function LabsPage() {
  const [xiInfo, setXiInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/download/xauindex/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setXiInfo(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#060609] text-white">
      <Seo
        title="XauCloud Labs — Experimental Gold Trading Products"
        description="Products here are not yet approved for customer release. Nothing on this page is available to buy or download today."
        path="/labs"
      />
      <Header activeSection="" onNavigate={() => {}} goldPrice={null} />
      <div className="mx-auto max-w-3xl px-4 py-11 md:px-8 md:py-16">
        <Link to="/" className="inline-flex items-center gap-2 text-[13px] text-white/45 hover:text-white transition">
          <ArrowLeft size={14} weight="bold" /> Back to XauCloud
        </Link>

        <span className="mt-8 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-200">
          Labs
        </span>
        <h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          Experimental products in development.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/55">
          Products here are not yet approved for customer release. Nothing on this page is available to buy or download today.
        </p>

        <div className="mt-10 rounded-[28px] border border-emerald-300/15 bg-emerald-300/[0.03] p-6 md:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-4">
              <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10">
                <ChartLineUp size={25} weight="duotone" className="text-emerald-200" />
              </div>
              <div>
                <h2 className="font-heading text-xl font-semibold">XauIndex — Gold + Index, one EA</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
                  A separate, experimental codebase — not the audited Gold-only XauCloud release. Index Mode is
                  detection and diagnostics only in this build; it never places an index trade. No compiled
                  release has completed audit or been approved for customer download.
                </p>
              </div>
            </div>
            <span className="inline-flex w-fit flex-none items-center gap-1 rounded-full bg-gold-300/80 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#1a1400]">
              <CheckCircle size={10} weight="fill" /> Not yet available
            </span>
          </div>
          <div className="mt-6 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-[12px] leading-5 text-white/45">
            {loading ? "Checking release status…" : (xiInfo?.message || "No compiled release has been published for this product yet.")}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
