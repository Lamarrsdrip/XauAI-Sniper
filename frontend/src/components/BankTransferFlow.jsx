import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { Bank, Clock, UploadSimple, CheckCircle, XCircle, Copy, ArrowLeft } from "@phosphor-icons/react";

function useCountdown(expiresAt) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return remaining;
}

function formatCountdown(seconds) {
  if (seconds == null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// "Pay by Card" / "Pay by Bank Transfer" — the payment-method selection
// step. Bank transfer is only offered when the backend's own eligibility
// check (Nigeria-detected + admin-enabled) says so; the backend
// independently re-validates this on every bank-transfer endpoint too, so
// hiding the button here is a UX nicety, not the actual access control.
export function PaymentMethodModal({ api, priceDisplay, buyerName, buyerEmail, onCard, onClose }) {
  const [eligible, setEligible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [showBankTransfer, setShowBankTransfer] = useState(false);

  useEffect(() => {
    axios.get(`${api}/purchase/bank-transfer/eligibility`)
      .then(r => setEligible(Boolean(r.data.eligible)))
      .catch(() => setEligible(false))
      .finally(() => setChecked(true));
  }, [api]);

  if (showBankTransfer) {
    return (
      <BankTransferPanel
        api={api}
        buyerName={buyerName}
        buyerEmail={buyerEmail}
        onBack={() => setShowBankTransfer(false)}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-testid="payment-method-modal">
      <div className="w-full max-w-sm rounded-[24px] border border-white/[0.1] bg-[#0a0a0e] p-6 shadow-2xl">
        <h3 className="font-heading text-xl font-bold text-white">How would you like to pay?</h3>
        <p className="mt-1 font-mono text-[12px] text-white/40">{priceDisplay} · {buyerEmail}</p>

        <div className="mt-5 space-y-3">
          <button
            data-testid="pay-by-card"
            onClick={onCard}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/[0.08] px-4 py-4 text-left transition hover:bg-amber-300/[0.14]"
          >
            <span>
              <span className="block font-bold text-white">Pay by Card</span>
              <span className="block text-[11px] text-white/40">Instant, secured by Nomba</span>
            </span>
          </button>

          {checked && eligible && (
            <button
              data-testid="pay-by-bank-transfer"
              onClick={() => setShowBankTransfer(true)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-4 text-left transition hover:bg-white/[0.08]"
            >
              <span>
                <span className="block font-bold text-white">Pay by Bank Transfer</span>
                <span className="block text-[11px] text-white/40">Nigeria only · manually reviewed</span>
              </span>
              <Bank size={20} className="flex-none text-white/40" />
            </button>
          )}
        </div>

        <button onClick={onClose} className="mt-5 w-full text-center font-mono text-[11px] text-white/30 hover:text-white/50">
          Cancel
        </button>
      </div>
    </div>
  );
}

function BankTransferPanel({ api, buyerName, buyerEmail, onBack, onClose }) {
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const pollRef = useRef(null);
  const remaining = useCountdown(order?.expires_at);

  useEffect(() => {
    axios.post(`${api}/purchase/bank-transfer/initiate`, { buyer_name: buyerName, buyer_email: buyerEmail })
      .then(r => { setOrder(r.data); setStatus("BANK_TRANSFER_PENDING"); })
      .catch(e => setError(e.response?.data?.detail || "Could not start bank transfer. Please try again."))
      .finally(() => setLoading(false));
  }, [api, buyerName, buyerEmail]);

  const poll = useCallback(async (reference) => {
    try {
      const { data } = await axios.get(`${api}/purchase/bank-transfer/${reference}/status`);
      setStatus(data.status);
      if (data.status === "FULFILLED") {
        clearInterval(pollRef.current);
      }
      return data;
    } catch { /* transient — next tick retries */ }
  }, [api]);

  useEffect(() => {
    if (!order?.reference) return;
    pollRef.current = setInterval(() => poll(order.reference), 6000);
    return () => clearInterval(pollRef.current);
  }, [order, poll]);

  const markSubmitted = async () => {
    if (submitting) return;
    setSubmitting(true); setError("");
    try {
      const { data } = await axios.post(`${api}/purchase/bank-transfer/${order.reference}/submitted`);
      setStatus(data.status);
    } catch (e) {
      setError(e.response?.data?.detail || "Could not record your submission. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const uploadProof = async (file) => {
    if (!file) return;
    setUploadingProof(true); setError("");
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await axios.post(`${api}/purchase/bank-transfer/${order.reference}/proof`, { proof_image: dataUrl });
    } catch (e) {
      setError(e.response?.data?.detail || "Could not upload proof. Please try again.");
    } finally {
      setUploadingProof(false);
    }
  };

  const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="rounded-2xl bg-[#0a0a0e] p-6 font-mono text-sm text-white/50">Preparing bank transfer…</div>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-sm rounded-[24px] border border-rose-400/20 bg-[#0a0a0e] p-6">
          <p className="text-sm text-rose-300">{error}</p>
          <button onClick={onClose} className="mt-4 w-full rounded-xl bg-white/[0.06] px-4 py-2.5 text-[13px] text-white/60">Close</button>
        </div>
      </div>
    );
  }

  if (status === "FULFILLED") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-testid="bank-transfer-fulfilled">
        <div className="w-full max-w-sm rounded-[24px] border border-emerald-400/20 bg-[#0a0a0e] p-6 text-center">
          <CheckCircle size={40} weight="fill" className="mx-auto text-emerald-400" />
          <h3 className="mt-3 font-heading text-lg font-bold text-white">Payment approved!</h3>
          <p className="mt-1 text-[13px] text-white/50">Check your email for your license PIN and download link.</p>
          <button onClick={onClose} className="mt-5 w-full rounded-xl bg-amber-300 px-4 py-3 text-[13px] font-bold text-black">Done</button>
        </div>
      </div>
    );
  }

  if (status === "BANK_TRANSFER_REJECTED" || status === "BANK_TRANSFER_EXPIRED") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-sm rounded-[24px] border border-rose-400/20 bg-[#0a0a0e] p-6 text-center">
          <XCircle size={40} weight="fill" className="mx-auto text-rose-400" />
          <h3 className="mt-3 font-heading text-lg font-bold text-white">
            {status === "BANK_TRANSFER_EXPIRED" ? "Order expired" : "Payment rejected"}
          </h3>
          <p className="mt-1 text-[13px] text-white/50">
            {status === "BANK_TRANSFER_EXPIRED"
              ? "This order's transfer window has passed. Please start a new purchase."
              : "Contact support if you believe this is a mistake."}
          </p>
          <button onClick={onClose} className="mt-5 w-full rounded-xl bg-white/[0.06] px-4 py-3 text-[13px] text-white/60">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto" data-testid="bank-transfer-panel">
      <div className="w-full max-w-sm rounded-[24px] border border-white/[0.1] bg-[#0a0a0e] p-6 my-8">
        <button onClick={onBack} className="mb-3 flex items-center gap-1 font-mono text-[11px] text-white/30 hover:text-white/50">
          <ArrowLeft size={12} /> Back
        </button>

        <div className="flex items-center justify-between">
          <h3 className="font-heading text-lg font-bold text-white">Bank Transfer</h3>
          <div className="flex items-center gap-1.5 rounded-full bg-amber-300/10 px-2.5 py-1 font-mono text-[11px] font-bold text-amber-300" data-testid="bank-transfer-countdown">
            <Clock size={12} /> {formatCountdown(remaining)}
          </div>
        </div>

        <p className="mt-2 text-[12px] leading-5 text-white/45">
          Transfer the exact amount below, then click "I have made the transfer." Your order is reviewed and approved manually — this can take a little while.
        </p>

        <div className="mt-4 space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          {[
            ["Amount", order.amount_formatted],
            ["Bank", order.bank_name],
            ["Account name", order.account_name],
            ["Account number", order.account_number],
            ["Reference", order.reference],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">{label}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[13px] font-bold text-white">{value}</span>
                <button onClick={() => copy(value)} aria-label={`Copy ${label}`} className="text-white/25 hover:text-white/60">
                  <Copy size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {order.instructions && (
          <p className="mt-3 text-[11px] leading-4 text-white/35">{order.instructions}</p>
        )}

        <div className="mt-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-[12px] text-white/40 hover:bg-white/[0.05]">
            <UploadSimple size={14} />
            {uploadingProof ? "Uploading…" : "Upload proof of payment (optional)"}
            <input type="file" accept="image/*" className="hidden" disabled={uploadingProof}
              onChange={(e) => uploadProof(e.target.files?.[0])} />
          </label>
        </div>

        {error && <div className="mt-3 text-[12px] text-rose-400" data-testid="bank-transfer-error">{error}</div>}

        <button
          data-testid="bank-transfer-submitted-btn"
          onClick={markSubmitted}
          disabled={submitting || status !== "BANK_TRANSFER_PENDING"}
          className="mt-4 w-full rounded-xl bg-amber-300 px-5 py-3.5 text-[13px] font-extrabold text-black transition hover:bg-amber-200 disabled:opacity-50"
        >
          {status === "BANK_TRANSFER_SUBMITTED"
            ? "Submitted — awaiting review"
            : submitting ? "Submitting…" : "I have made the transfer"}
        </button>

        {status === "BANK_TRANSFER_SUBMITTED" && (
          <p className="mt-2 text-center text-[11px] text-white/35" data-testid="bank-transfer-under-review">
            Your order is under admin review. We'll email your license PIN as soon as it's approved.
          </p>
        )}
      </div>
    </div>
  );
}
