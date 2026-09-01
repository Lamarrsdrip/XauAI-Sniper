import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ShieldCheck, XCircle } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import { API } from "@/lib/api";

const dateStr = (iso) => {
  if (!iso) return "--";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--" : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

export default function CertificateVerifyPage() {
  const { certificateId } = useParams();
  const [state, setState] = useState("loading"); // loading | found | not_found
  const [cert, setCert] = useState(null);

  useEffect(() => {
    setState("loading");
    fetch(`${API}/academy/verify/${encodeURIComponent(certificateId || "")}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (ok && body?.found) { setCert(body.certificate); setState("found"); }
        else setState("not_found");
      })
      .catch(() => setState("not_found"));
  }, [certificateId]);

  const revoked = cert?.status === "revoked";

  return (
    <div className="min-h-screen bg-[#060609] text-white">
      <Seo
        title="Certificate Verification — XauCloud Forex Academy"
        description="Verify the authenticity of a XauCloud Forex Academy Certificate of Completion."
        path={`/verify-certificate/${certificateId || ""}`}
      />
      <Header activeSection="" onNavigate={() => {}} goldPrice={null} />
      <div className="mx-auto max-w-lg px-4 py-11 md:px-8 md:py-16">
        <Link to="/" className="inline-flex items-center gap-2 text-[13px] text-white/45 hover:text-white transition">
          <ArrowLeft size={14} /> Back to XauCloud
        </Link>

        <span className="mt-8 inline-flex items-center gap-1.5 rounded-full border border-gold-300/20 bg-gold-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-gold-200">
          Certificate Verification
        </span>

        {state === "loading" && <p className="mt-6 text-sm text-white/40">Verifying…</p>}

        {state === "not_found" && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
            <XCircle className="mt-0.5 h-5 w-5 flex-none text-white/30" />
            <div>
              <div className="text-[14px] font-bold text-white/80">Certificate not found</div>
              <p className="mt-1 text-[12.5px] text-white/45">This certificate ID doesn't match any issued XauCloud Forex Academy certificate. Check the ID and try again.</p>
            </div>
          </div>
        )}

        {state === "found" && cert && (
          <div className="mt-6 rounded-[26px] border border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(243,201,105,0.10),transparent_42%),#0C0D12] p-6">
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold-300/70">XauCloud Forex Academy</div>
              <div className="mt-1.5 text-[18px] font-black tracking-tight">Certificate of Completion</div>
            </div>

            <div className="mt-5 space-y-3 rounded-2xl bg-white/[0.03] p-4">
              <div className="flex items-center justify-between text-[12.5px]"><span className="text-white/40">Name</span><span className="font-semibold text-white/90">{cert.recipient_name}</span></div>
              <div className="flex items-center justify-between text-[12.5px]"><span className="text-white/40">Completed</span><span className="font-semibold text-white/90">{dateStr(cert.completed_at)}</span></div>
              <div className="flex items-center justify-between text-[12.5px]"><span className="text-white/40">Certificate ID</span><span className="font-mono font-semibold text-white/90">{cert.certificate_id}</span></div>
            </div>

            <div className={`mt-4 flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12.5px] font-black ${revoked ? "bg-rose-500/10 text-rose-300" : "bg-emerald-400/10 text-emerald-300"}`}>
              {revoked ? <XCircle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              Status: {revoked ? "Revoked" : "Valid"}
            </div>

            <p className="mt-4 text-center text-[10.5px] leading-4 text-white/30">
              This certificate confirms completion of the XauCloud Forex Academy educational curriculum only. It is not a trading license or professional accreditation.
            </p>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
