import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { API } from "@/lib/api";

// Product decision (2026-08-25): XauCloud has exactly ONE homepage. This
// used to render its own separate marketing page for the authenticated
// product (pricing/features copy distinct from the real public homepage at
// "/") -- a visitor bounced between two different "welcome to XauCloud"
// pages depending on which URL they landed on. "/command" is now a pure
// routing gate that never renders content of its own: authenticated ->
// straight into the dashboard; unauthenticated -> straight to the login
// form. The real homepage at "/" is the only page that introduces XauCloud.
export default function CloudLanding() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    axios.get(`${API}/cloud/auth/me`, { withCredentials: true, timeout: 5000 })
      .then(() => { if (!cancelled) navigate("/command/dashboard", { replace: true }); })
      .catch(() => { if (!cancelled) navigate("/command/login", { replace: true }); });
    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060609] text-white">
      <Loader2 className="h-6 w-6 animate-spin text-gold-300" />
    </div>
  );
}
