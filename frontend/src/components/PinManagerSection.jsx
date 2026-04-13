import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import {
  Key,
  Plus,
  Trash,
  Copy,
  Check,
  X,
  ShieldCheck,
  UserCircle,
} from "@phosphor-icons/react";

export default function PinManagerSection({ api }) {
  const [pins, setPins] = useState([]);
  const [stats, setStats] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genCount, setGenCount] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [copiedPin, setCopiedPin] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchPins = useCallback(async () => {
    try {
      const [pinsRes, statsRes] = await Promise.all([
        axios.get(`${api}/pins`),
        axios.get(`${api}/pins/stats`),
      ]);
      setPins(pinsRes.data.pins || []);
      setStats(statsRes.data);
    } catch (e) {
      console.error("Failed to fetch pins:", e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchPins();
  }, [fetchPins]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await axios.post(`${api}/pins/generate`, {
        count: genCount,
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        notes: notes,
      });
      setBuyerName("");
      setBuyerEmail("");
      setNotes("");
      await fetchPins();
    } catch (e) {
      console.error("Generate failed:", e);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (pin) => {
    try {
      await axios.put(`${api}/pins/${pin}/revoke`);
      await fetchPins();
    } catch (e) {
      console.error("Revoke failed:", e);
    }
  };

  const handleActivate = async (pin) => {
    try {
      await axios.put(`${api}/pins/${pin}/activate`);
      await fetchPins();
    } catch (e) {
      console.error("Activate failed:", e);
    }
  };

  const handleDelete = async (pin) => {
    try {
      await axios.delete(`${api}/pins/${pin}`);
      await fetchPins();
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const copyPin = (pin) => {
    navigator.clipboard.writeText(pin);
    setCopiedPin(pin);
    setTimeout(() => setCopiedPin(null), 2000);
  };

  return (
    <div className="bg-background border-t border-border" data-testid="pin-manager-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Section header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border mb-4">
            <Key size={12} weight="bold" />
            <span className="text-xs font-mono font-medium tracking-[0.15em] text-muted-foreground">
              LICENSE MANAGEMENT
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight" data-testid="pin-manager-title">
            PIN License System
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Generate unique license PINs for each buyer. Each PIN must be entered in the EA
            settings before it can trade. PINs are validated on EA startup.
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border border-border mb-8" data-testid="pin-stats">
            {[
              { label: "TOTAL", value: stats.total },
              { label: "ACTIVE", value: stats.active, color: "text-[hsl(142,71%,45%)]" },
              { label: "USED", value: stats.used, color: "text-primary" },
              { label: "UNUSED", value: stats.unused },
              { label: "REVOKED", value: stats.revoked, color: "text-[hsl(348,83%,47%)]" },
            ].map((s, i) => (
              <div key={s.label} className={`p-4 ${i < 4 ? "border-r border-border" : ""}`} data-testid={`pin-stat-${s.label.toLowerCase()}`}>
                <div className="text-[10px] font-bold tracking-[0.15em] text-muted-foreground mb-1">
                  {s.label}
                </div>
                <div className={`font-mono text-2xl font-bold ${s.color || "text-foreground"}`}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Generate Form */}
          <div className="border border-border bg-card" data-testid="pin-generate-form">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
                GENERATE NEW PINS
              </h4>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">
                  Buyer Name
                </label>
                <input
                  data-testid="pin-buyer-name"
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 border border-border bg-background font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">
                  Buyer Email
                </label>
                <input
                  data-testid="pin-buyer-email"
                  type="email"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="w-full px-3 py-2 border border-border bg-background font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">
                  Notes
                </label>
                <input
                  data-testid="pin-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Purchase order, plan, etc."
                  className="w-full px-3 py-2 border border-border bg-background font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">
                  How many PINs?
                </label>
                <input
                  data-testid="pin-count"
                  type="number"
                  min={1}
                  max={50}
                  value={genCount}
                  onChange={(e) => setGenCount(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-border bg-background font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                data-testid="generate-pins-btn"
                onClick={handleGenerate}
                disabled={generating}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold text-sm tracking-wide hover:-translate-y-[1px] transition-transform duration-150 shadow-[2px_2px_0px_hsl(0,0%,4%)] disabled:opacity-50"
              >
                <Plus size={16} weight="bold" />
                {generating ? "GENERATING..." : `GENERATE ${genCount} PIN${genCount > 1 ? "S" : ""}`}
              </button>
            </div>
          </div>

          {/* PIN List */}
          <div className="lg:col-span-2 border border-border bg-card" data-testid="pin-list">
            <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
              <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
                ALL LICENSE PINS
              </h4>
              <span className="text-xs font-mono text-muted-foreground">
                {pins.length} total
              </span>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
              ) : pins.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground" data-testid="no-pins-message">
                  No PINs generated yet. Use the form to create your first license PIN.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {pins.map((p) => (
                    <div key={p.pin} className="px-5 py-3 flex items-center gap-4" data-testid={`pin-row-${p.pin}`}>
                      {/* PIN value */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-sm font-bold text-foreground">
                            {p.pin}
                          </span>
                          <button
                            onClick={() => copyPin(p.pin)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            data-testid={`copy-pin-${p.pin}`}
                          >
                            {copiedPin === p.pin ? (
                              <Check size={14} className="text-[hsl(142,71%,45%)]" />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {p.buyer_name && (
                            <span className="flex items-center gap-1">
                              <UserCircle size={12} /> {p.buyer_name}
                            </span>
                          )}
                          {p.buyer_email && <span>{p.buyer_email}</span>}
                        </div>
                      </div>

                      {/* Status */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {p.is_used && (
                          <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold tracking-wide">
                            ACTIVATED
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                            p.is_active
                              ? "bg-[hsl(142,71%,45%)]/10 text-[hsl(142,71%,45%)]"
                              : "bg-[hsl(348,83%,47%)]/10 text-[hsl(348,83%,47%)]"
                          }`}
                        >
                          {p.is_active ? "ACTIVE" : "REVOKED"}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {p.is_active ? (
                          <button
                            onClick={() => handleRevoke(p.pin)}
                            className="p-1.5 text-muted-foreground hover:text-[hsl(348,83%,47%)] transition-colors"
                            title="Revoke"
                            data-testid={`revoke-pin-${p.pin}`}
                          >
                            <ShieldCheck size={16} />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleActivate(p.pin)}
                            className="p-1.5 text-muted-foreground hover:text-[hsl(142,71%,45%)] transition-colors"
                            title="Reactivate"
                            data-testid={`activate-pin-${p.pin}`}
                          >
                            <ShieldCheck size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(p.pin)}
                          className="p-1.5 text-muted-foreground hover:text-[hsl(348,83%,47%)] transition-colors"
                          title="Delete"
                          data-testid={`delete-pin-${p.pin}`}
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
