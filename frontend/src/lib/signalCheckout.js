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
