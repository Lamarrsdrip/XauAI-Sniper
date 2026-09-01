import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";

const http = axios.create({ withCredentials: true });
const BOX = "rounded-2xl border border-white/[0.08] bg-[#0c0d11]";

function Pill({ children, tone = "neutral" }) {
  const colors =
    tone === "good" ? "bg-emerald-400/10 text-emerald-300" :
    tone === "bad" ? "bg-red-500/10 text-red-300" :
    tone === "warn" ? "bg-gold-300/10 text-gold-200" :
    "bg-white/[0.06] text-white/45";
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${colors}`}>{children}</span>;
}

function Metric({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="font-mono text-[9px] uppercase tracking-[.16em] text-white/30">{label}</div>
      <div className="mt-1 text-[15px] font-black text-white/85">{value}</div>
      {sub && <div className="mt-0.5 text-[9px] text-white/30">{sub}</div>}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled, description }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-white/75">{label}</div>
        {description && <div className="mt-0.5 text-[9px] text-white/35">{description}</div>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-30 ${checked ? "bg-emerald-400/70" : "bg-white/15"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? "left-4" : "left-0.5"}`} />
      </button>
    </label>
  );
}

function QuestionCard({ question, model, onRollback, busy }) {
  const hasChampion = model.champion_version !== null && model.champion_version !== undefined;
  return (
    <div className={`${BOX} p-4`} data-testid={`global-brain-question-${question}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-bold text-white/80">{question.replace(/_/g, " ")}</div>
          <div className="mt-1 text-[9px] text-white/30">
            {hasChampion ? `champion v${model.champion_version} · promoted ${model.promoted_at ? new Date(model.promoted_at).toLocaleString() : "unknown"}` : "no champion promoted yet"}
          </div>
        </div>
        <Pill tone={hasChampion ? "good" : "neutral"}>{hasChampion ? "CHAMPION LIVE (SHADOW)" : "INSUFFICIENT_EVIDENCE"}</Pill>
      </div>
      {hasChampion && model.holdout_metrics && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Holdout n" value={model.holdout_metrics.holdout_n} />
          <Metric label="Brier score" value={model.holdout_metrics.brier_score?.toFixed?.(3) ?? model.holdout_metrics.brier_score} sub="lower = better calibrated" />
          <Metric label="Avg R captured" value={model.holdout_metrics.avg_r_captured} sub="favored buckets only" />
          <Metric label="Max drawdown" value={`${model.holdout_metrics.max_drawdown_r}R`} />
        </div>
      )}
      {model.promotion_reason && <p className="mt-3 text-[10px] leading-4 text-white/40">{model.promotion_reason}</p>}
      {model.drift_alert && (
        <div className="mt-2 rounded-lg bg-gold-300/10 px-2.5 py-1.5 text-[9px] text-gold-200">
          <span className="font-bold">DRIFT DETECTED</span> · {model.drift_alert.reason}
        </div>
      )}
      {hasChampion && (
        <button
          disabled={busy}
          onClick={() => onRollback(question)}
          className="mt-3 rounded-lg border border-white/10 px-2.5 py-1.5 text-[9px] font-bold text-white/55 hover:text-white disabled:opacity-30"
        >
          ROLL BACK TO PREVIOUS CHAMPION
        </button>
      )}
    </div>
  );
}

export default function GlobalBrain({ api }) {
  const [status, setStatus] = useState(null);
  const [promotions, setPromotions] = useState([]);
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [st, pr, se] = await Promise.all([
      http.get(`${api}/admin/global-brain/status`),
      http.get(`${api}/admin/global-brain/promotions`),
      http.get(`${api}/admin/global-brain/settings`),
    ]);
    setStatus(st.data);
    setPromotions(pr.data.promotions || []);
    setSettings(se.data);
  }, [api]);

  useEffect(() => { load().catch(() => setError("Could not load Global Brain status.")); }, [load]);

  const runCycle = async (dryRun) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await http.post(`${api}/admin/global-brain/run-cycle`, { dry_run: dryRun });
      const promotedCount = Object.values(res.data.questions || {}).filter((q) => q?.promoted).length;
      setMessage(
        dryRun
          ? `Dry run complete: ${res.data.observations_eligible} eligible observations, ${promotedCount} question(s) would promote.`
          : `Cycle complete: ${res.data.observations_eligible} eligible observations, ${promotedCount} question(s) promoted.`,
      );
      await load();
    } catch (e) {
      setError(e.response?.data?.detail || "Daily cycle run failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleSetting = async (key, value) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await http.patch(`${api}/admin/global-brain/settings`, { [key]: value });
      setSettings(res.data);
      setMessage(`${key} set to ${value}.`);
    } catch (e) {
      setError(e.response?.data?.detail || "Settings update failed.");
    } finally {
      setBusy(false);
    }
  };

  const emergencyDisable = async () => {
    if (!window.confirm("Emergency-disable the ENTIRE Global Brain? This turns off learning, training, promotion, shadow serving, and advisory reads all at once. Existing Champions are kept but become unreachable until you re-enable each flag.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await http.post(`${api}/admin/global-brain/emergency-disable`);
      setSettings(res.data.settings);
      setMessage("Global Brain emergency-disabled -- platform is back to pre-Global-Brain baseline behavior.");
    } catch (e) {
      setError(e.response?.data?.detail || "Emergency disable failed.");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (question) => {
    if (!window.confirm(`Roll back "${question}" to its previous champion? This affects the shadow/advisory model only -- no live trade is influenced.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await http.post(`${api}/admin/global-brain/rollback`, { question });
      setMessage(`${question} rolled back to version ${res.data.restored_version}.`);
      await load();
    } catch (e) {
      setError(e.response?.data?.detail || "Rollback failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <div className={`${BOX} flex min-h-64 items-center justify-center p-8 text-center text-[11px] text-white/30`}>{error || "Loading Global Brain status..."}</div>;
  }

  const lastCycle = status.last_cycle;

  return (
    <div className="space-y-4" data-testid="admin-global-brain-tab">
      <div className={`${BOX} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[.2em] text-gold-300/70">XauCloud Global Learning Brain</div>
            <h2 className="mt-1 text-xl font-extrabold text-white">Shared learning memory across every bot, Outlook, and account</h2>
            <p className="mt-1 max-w-2xl text-[11px] text-white/35">
              {status.note || "SHADOW/ADVISORY ONLY -- no model here has authority over live trades."}
            </p>
          </div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => runCycle(true)} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold text-white/55 disabled:opacity-30">DRY-RUN CYCLE</button>
            <button disabled={busy} onClick={() => runCycle(false)} className="rounded-lg bg-gold-300 px-3 py-2 text-[10px] font-black text-black disabled:opacity-40">RUN CYCLE NOW</button>
            <button disabled={busy} onClick={() => load()} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold text-white/55">REFRESH</button>
          </div>
        </div>
        {(message || error) && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-[10px] ${error ? "bg-red-500/10 text-red-300" : "bg-emerald-400/10 text-emerald-300"}`}>{error || message}</div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Total observations" value={status.total_observations} />
          <Metric label="Resolved" value={status.resolved_observations} />
          <Metric label="Pending" value={status.pending_observations} />
          <Metric label="By source" value={Object.entries(status.observations_by_source || {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"} />
        </div>
      </div>

      {settings && (
        <section className={`${BOX} p-4`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-white/45">Master switches / kill switches</h3>
            <button disabled={busy} onClick={emergencyDisable} className="rounded-lg bg-red-500/15 px-3 py-1.5 text-[9px] font-black text-red-300 disabled:opacity-30">EMERGENCY DISABLE ALL</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="Global learning" description="Master: gates ALL observation collection" checked={settings.global_learning_enabled} disabled={busy} onChange={(v) => toggleSetting("global_learning_enabled", v)} />
            <Toggle label="Scheduled 24h cycle" description="Automatic cron; manual run-cycle unaffected" checked={settings.scheduled_cycle_enabled} disabled={busy} onChange={(v) => toggleSetting("scheduled_cycle_enabled", v)} />
            <Toggle label="Auto training" description="Whether a fired cycle trains challengers" checked={settings.auto_training_enabled} disabled={busy} onChange={(v) => toggleSetting("auto_training_enabled", v)} />
            <Toggle label="Auto promotion" description="Challenger still trained/reported either way" checked={settings.auto_promotion_enabled} disabled={busy} onChange={(v) => toggleSetting("auto_promotion_enabled", v)} />
            <Toggle label="Shadow serving" description="Real-time rule-vs-brain comparison logs" checked={settings.shadow_serving_enabled} disabled={busy} onChange={(v) => toggleSetting("shadow_serving_enabled", v)} />
            <Toggle label="Advisory integration" description="GET /ml/brain/suggestion returns real data" checked={settings.advisory_integration_enabled} disabled={busy} onChange={(v) => toggleSetting("advisory_integration_enabled", v)} />
          </div>
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <div className="mb-2 text-[9px] uppercase tracking-wider text-white/30">Live-trade authority -- REJECT-only, never invents a trade or touches SL/TP/lot (default OFF; owner has not approved production traffic yet)</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Toggle label="Bot influence" checked={settings.bot_learned_influence_enabled} disabled={busy} onChange={(v) => toggleSetting("bot_learned_influence_enabled", v)} />
              <Toggle label="M10 influence" checked={settings.m10_learned_influence_enabled} disabled={busy} onChange={(v) => toggleSetting("m10_learned_influence_enabled", v)} />
              <Toggle label="Outlook influence" checked={settings.outlook_learned_influence_enabled} disabled={busy} onChange={(v) => toggleSetting("outlook_learned_influence_enabled", v)} />
            </div>
          </div>
          {settings.updated_at && <div className="mt-3 text-[9px] text-white/25">Last changed {new Date(settings.updated_at).toLocaleString()} by {settings.updated_by || "unknown"}</div>}
        </section>
      )}

      <section className={`${BOX} p-4`}>
        <h3 className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[.16em] text-white/45">Champion / challenger models</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(status.models || {}).map(([question, model]) => (
            <QuestionCard key={question} question={question} model={model} onRollback={rollback} busy={busy} />
          ))}
        </div>
      </section>

      {lastCycle && (
        <section className={`${BOX} p-4`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-white/45">Last daily cycle</h3>
            <Pill tone={lastCycle.cycle_already_running ? "warn" : lastCycle.success ? "good" : "bad"}>
              {lastCycle.cycle_already_running ? "SKIPPED (ALREADY RUNNING)" : lastCycle.success ? "SUCCESS" : "FAILED"}
            </Pill>
          </div>
          <div className="text-[10px] text-white/40">Ran at {new Date(lastCycle.ran_at).toLocaleString()}</div>
          {lastCycle.error && <div className="mt-2 rounded-lg bg-red-500/10 p-2 text-[10px] text-red-300">{lastCycle.error}</div>}
          {!!lastCycle.mistakes_by_category && (
            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {Object.entries(lastCycle.mistakes_by_category).filter(([, n]) => n > 0).map(([cat, n]) => (
                <div key={cat} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[9px] text-white/45">
                  {cat.replace(/_/g, " ")}: <span className="font-bold text-white/70">{n}</span>
                </div>
              ))}
            </div>
          )}
          {!!lastCycle.opportunity_capture && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Opportunity capture" value={lastCycle.opportunity_capture.opportunity_capture_rate !== null ? `${(lastCycle.opportunity_capture.opportunity_capture_rate * 100).toFixed(1)}%` : "N/A"} sub="executed / (executed+skipped+expired)" />
              <Metric label="False rejection rate" value={lastCycle.opportunity_capture.false_rejection_rate !== null ? `${(lastCycle.opportunity_capture.false_rejection_rate * 100).toFixed(1)}%` : "N/A"} sub={`${lastCycle.opportunity_capture.missed_winner_count} missed winners / ${lastCycle.opportunity_capture.non_executed_with_resolvable_outcome} resolvable rejections`} />
              <Metric label="Wait improved / hurt" value={`${lastCycle.opportunity_capture.wait_improved_entry_count} / ${lastCycle.opportunity_capture.wait_hurt_entry_count}`} />
              <Metric label="Entry too late / early" value={`${lastCycle.opportunity_capture.entry_too_late_count} / ${lastCycle.opportunity_capture.entry_too_early_count}`} />
            </div>
          )}
          {!!lastCycle.entry_quality_by_source && Object.keys(lastCycle.entry_quality_by_source).length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(lastCycle.entry_quality_by_source).map(([source, q]) => (
                <Metric key={source} label={`${source} entry quality`} value={`MAE ${q.avg_mae_r ?? "—"}R / MFE ${q.avg_mfe_r ?? "—"}R`} sub={`n=${q.n} resolved`} />
              ))}
            </div>
          )}
          {!!lastCycle.questions && Object.entries(lastCycle.questions).some(([, q]) => q?.overfiltering) && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[9px] uppercase tracking-wider text-white/30">Trade-frequency / overfiltering check (per Challenger)</div>
              {Object.entries(lastCycle.questions).filter(([, q]) => q?.overfiltering).map(([question, q]) => (
                <div key={question} className={`rounded-lg border px-3 py-2 text-[9px] ${q.overfiltering.overfiltering_risk ? "border-red-400/20 bg-red-500/10 text-red-300" : "border-white/[0.06] bg-white/[0.02] text-white/45"}`}>
                  <span className="font-bold">{question}</span>
                  {q.overfiltering.overfiltering_risk && <span className="ml-2 font-black uppercase">OVERFILTERING_RISK</span>}
                  <div className="mt-0.5 text-white/50">
                    participation: challenger {(q.overfiltering.challenger_participation_rate * 100).toFixed(1)}% vs comparison {(q.overfiltering.comparison_participation_rate * 100).toFixed(1)}%
                    {q.overfiltering.excluded_opportunities_n > 0 && ` · ${q.overfiltering.excluded_opportunities_n} excluded opportunities, avg R ${q.overfiltering.excluded_opportunities_avg_r ?? "N/A"}`}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!!lastCycle.questions && Object.entries(lastCycle.questions).some(([, q]) => q?.account_diversity) && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[9px] uppercase tracking-wider text-white/30">Cross-account evidence mix (informational — not a market-learning veto)</div>
              {Object.entries(lastCycle.questions).filter(([, q]) => q?.account_diversity).map(([question, q]) => (
                <div key={question} className={`rounded-lg border px-3 py-2 text-[9px] ${q.account_diversity.account_concentration_risk ? "border-amber-400/20 bg-amber-500/10 text-amber-200" : "border-white/[0.06] bg-white/[0.02] text-white/45"}`}>
                  <span className="font-bold">{question}</span>
                  {q.account_diversity.account_concentration_risk && <span className="ml-2 font-black uppercase">ACCOUNT_CONCENTRATION_INFO</span>}
                  <div className="mt-0.5 text-white/50">
                    training: {q.account_diversity.training_accounts} accounts, largest {q.account_diversity.training_largest_account_share !== null ? `${(q.account_diversity.training_largest_account_share * 100).toFixed(1)}%` : "N/A"}
                    {' · '}holdout: {q.account_diversity.holdout_accounts} accounts, largest {q.account_diversity.holdout_largest_account_share !== null ? `${(q.account_diversity.holdout_largest_account_share * 100).toFixed(1)}%` : "N/A"}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!!(lastCycle.known_gaps || []).length && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[9px] text-white/30">Known gaps in this cycle's evidence</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[9px] leading-4 text-white/35">
                {lastCycle.known_gaps.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </details>
          )}
        </section>
      )}

      <section className={`${BOX} p-4`}>
        <h3 className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[.16em] text-white/45">Promotion / rollback history</h3>
        <div className="space-y-1.5">
          {promotions.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-white/70">{p.question}</span>
                <span className="ml-2 text-[9px] text-white/30">{new Date(p.at).toLocaleString()}</span>
                <div className="mt-0.5 truncate text-[9px] text-white/35">{p.reason}</div>
              </div>
              <Pill tone={p.action === "PROMOTE" ? "good" : p.action === "ROLLBACK" ? "warn" : "neutral"}>{p.action}</Pill>
            </div>
          ))}
          {!promotions.length && <div className="py-6 text-center text-[10px] text-white/25">No promotion history yet.</div>}
        </div>
      </section>
    </div>
  );
}
