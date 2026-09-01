import React, { useEffect, useState } from "react";
import { CloudArrowUp } from "@phosphor-icons/react";

// Replaces the old public DownloadSection. That section's SHA-256/checksum
// grid, verbose release-pipeline copy, and the actual "Licensed download"
// button (which always 401'd for an anonymous visitor anyway -- the real
// download flow now lives in Command Center, see EaDownloadCard in
// CloudDashboard.jsx) were technical noise on a marketing page. This keeps
// only what a visitor actually needs: which build is current, and where to
// get it once they're a customer. Same GET /download/info source, no
// fabricated data.
export default function ReleaseStrip({ api }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    fetch(`${api}/download/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => {});
  }, [api]);

  const version = info?.version || "current release";
  const updated = info?.build_timestamp
    ? new Date(info.build_timestamp).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="bg-[#07090d] border-t border-white/[0.06] text-white" data-testid="release-strip">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-center sm:flex-row sm:text-left md:px-8">
        <div className="font-mono text-[11px] text-white/40">
          Current release: <span className="text-white/70">{version}</span>
          <span className="mx-2 text-white/15">·</span>
          Gold-only production build
          {updated && <><span className="mx-2 text-white/15">·</span>Last updated: {updated}</>}
        </div>
        <a href="/command" className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-4 py-2 text-[12px] font-semibold text-white/75 transition hover:bg-white/[0.09]">
          <CloudArrowUp size={14} weight="bold" /> Open Command Center
        </a>
      </div>
    </div>
  );
}
