import { useCallback, useState } from "react";
import axios from "axios";

// Shared signal-subscription (Weekly/Monthly) checkout logic, used by both
// the public homepage PurchaseSection plan cards and the authenticated
// CloudSignalDashboard billing section -- one place that knows how to call
// POST /purchase/signals/{paystack,nomba}/initialize and how to hand off to
// <PaymentMethodModal>'s bank-transfer path, so the two call sites can't
// drift on request shape. Every /purchase/signals/* call requires the
// existing cloud auth cookie (withCredentials), never a bearer token.
export function useSignalCheckout(api) {
  const [planId, setPlanId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openPlan = useCallback((id) => {
    setError("");
    setPlanId(id);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setError("");
  }, []);

  const payViaProvider = useCallback(async (endpoint, currentPlanId) => {
    if (busy || !currentPlanId) return;
    setError("");
    setBusy(true);
    try {
      const res = await axios.post(
        `${api}${endpoint}`,
        { plan_id: currentPlanId, origin_url: window.location.origin },
        { withCredentials: true }
      );
      if (res.data.authorization_url) window.location.href = res.data.authorization_url;
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.message || "Payment failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [api, busy]);

  const payByPaystack = useCallback(() => payViaProvider("/purchase/signals/paystack/initialize", planId), [payViaProvider, planId]);
  const payByNomba = useCallback(() => payViaProvider("/purchase/signals/nomba/initialize", planId), [payViaProvider, planId]);

  const bankTransferProps = planId
    ? {
        initiateEndpoint: "/purchase/signals/bank-transfer/initiate",
        initiatePayload: { plan_id: planId, origin_url: window.location.origin },
        withCredentials: true,
      }
    : undefined;

  return { planId, showModal, busy, error, openPlan, closeModal, payByPaystack, payByNomba, bankTransferProps, setError };
}

// Shared lifetime-bot-license checkout logic. This is the SAME anonymous
// checkout PurchaseSection (the public homepage) has always used --
// /purchase/paystack/initialize, /purchase/initialize (Nomba), and
// PaymentMethodModal's default bank-transfer path all require no auth, so
// they work unchanged from an authenticated Command Center session too.
// The only difference here is buyer_name/buyer_email come from the already
// -known cloud user instead of a form, so a logged-in customer is never
// bounced to the public homepage to buy the bot (see CloudSignalDashboard).
export function useBotCheckout(api) {
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const open = useCallback(() => { setError(""); setShowModal(true); }, []);
  const closeModal = useCallback(() => { setShowModal(false); setError(""); }, []);

  const payViaProvider = useCallback(async (endpoint, buyerName, buyerEmail) => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await axios.post(
        `${api}${endpoint}`,
        { buyer_name: buyerName, buyer_email: buyerEmail, origin_url: window.location.origin },
      );
      if (res.data.authorization_url) window.location.href = res.data.authorization_url;
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.message || "Payment failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [api, busy]);

  const payByPaystack = useCallback((buyerName, buyerEmail) => payViaProvider("/purchase/paystack/initialize", buyerName, buyerEmail), [payViaProvider]);
  const payByNomba = useCallback((buyerName, buyerEmail) => payViaProvider("/purchase/initialize", buyerName, buyerEmail), [payViaProvider]);

  return { showModal, busy, error, open, closeModal, payByPaystack, payByNomba, setError };
}
