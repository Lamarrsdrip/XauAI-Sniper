import React, { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { Check, Copy, ArrowLeft, Warning } from "@phosphor-icons/react";
import { API } from "@/lib/api";

export default function PurchaseSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // "reference"/"trxref" were Paystack's callback params; Nomba appends
  // "orderReference" to the callbackUrl instead (see
  // audits/nomba_migration/02_nomba_api_reference.md) -- our own internal
  // reference string is identical either way (we generate it and pass it
  // to the provider as orderReference/reference respectively), so reading
  // whichever of the three is present resolves the same transaction.
  const reference = searchParams.get("reference") || searchParams.get("trxref") || searchParams.get("orderReference");

  const [status, setStatus] = useState("checking");
  const [pin, setPin] = useState(null);
  const [buyerName, setBuyerName] = useState("");
  const [copied, setCopied] = useState(false);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!reference) { setStatus("error"); return; }
    const verify = async () => {
      try {
        const res = await axios.get(`${API}/purchase/verify/${reference}`);
        if (res.data.payment_status === "success" && res.data.pin) {
          setStatus("success");
          setPin(res.data.pin);
          setBuyerName(res.data.buyer_name || "");
        } else if (res.data.payment_status === "failed" || res.data.status === "failed") {
          setStatus("error");
        } else {
          if (attempts < 12) setTimeout(() => setAttempts(a => a + 1), 2500);
          else setStatus("timeout");
        }
      } catch {
        if (attempts < 12) setTimeout(() => setAttempts(a => a + 1), 2500);
        else setStatus("error");
      }
    };
    verify();
  }, [reference, attempts]);

  const copyPin = () => {
    if (pin) { navigator.clipboard.writeText(pin); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6" data-testid="purchase-success-page">
      <div className="max-w-lg w-full">
        {status === "checking" && (
          <div className="border border-border bg-card p-8 text-center" data-testid="payment-checking">
            <div className="w-12 h-12 bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
            <h2 className="font-heading text-xl font-bold mb-2">Confirming Payment...</h2>
            <p className="text-sm text-muted-foreground">Verifying your payment. This may take a moment.</p>
            <div className="mt-4 h-1 bg-muted overflow-hidden"><div className="h-full bg-primary gold-shimmer w-full" /></div>
          </div>
        )}

        {status === "success" && pin && (
          <div className="border border-border bg-card p-8" data-testid="payment-success">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[hsl(142,71%,45%)]/10 flex items-center justify-center mx-auto mb-4">
                <Check size={32} weight="bold" className="text-[hsl(142,71%,45%)]" />
              </div>
              <h2 className="font-heading text-2xl font-bold mb-1">Payment Successful!</h2>
              <p className="text-sm text-muted-foreground">Welcome{buyerName ? `, ${buyerName}` : ""}! Your license PIN has been generated.</p>
            </div>
            <div className="bg-muted/50 border border-border p-6 text-center mb-6" data-testid="pin-display">
              <div className="text-xs font-bold tracking-[0.15em] text-muted-foreground mb-2">YOUR LICENSE PIN</div>
              <div className="font-mono text-3xl font-black text-foreground tracking-wider mb-3" data-testid="generated-pin">{pin}</div>
              <button onClick={copyPin} data-testid="copy-generated-pin"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold text-sm hover:-translate-y-[1px] transition-transform duration-150">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "COPIED!" : "COPY PIN"}
              </button>
            </div>
            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-bold">What to do next:</h3>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Save your PIN somewhere safe (screenshot it!)</li>
                <li>Sign in to Command Center and link this PIN</li>
                <li>Download the EA from Command Center and install it on MetaTrader 5</li>
                <li>Enter this PIN in the EA settings</li>
                <li>Enable Auto Trading and start making money!</li>
              </ol>
            </div>
            <div className="border-t border-border pt-4 flex items-center justify-between">
              <button onClick={() => navigate("/")} data-testid="back-to-home"
                className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft size={14} /> Back to Dashboard
              </button>
              <a href="/command"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold text-sm hover:-translate-y-[1px] transition-transform duration-150">
                OPEN COMMAND CENTER
              </a>
            </div>
          </div>
        )}

        {(status === "error" || status === "timeout") && (
          <div className="border border-border bg-card p-8 text-center" data-testid="payment-error">
            <div className="w-16 h-16 bg-[hsl(348,83%,47%)]/10 flex items-center justify-center mx-auto mb-4">
              <Warning size={32} weight="bold" className="text-[hsl(348,83%,47%)]" />
            </div>
            <h2 className="font-heading text-xl font-bold mb-2">{status === "timeout" ? "Verification Timed Out" : "Something Went Wrong"}</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {status === "timeout" ? "Couldn't verify your payment yet. If you completed payment, contact support with your reference." : "Issue processing payment. Please try again."}
            </p>
            <button onClick={() => navigate("/")} className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold text-sm">
              <ArrowLeft size={14} /> TRY AGAIN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
