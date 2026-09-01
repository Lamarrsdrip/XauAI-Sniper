// Customer-facing broker identity only. Raw broker_server telemetry remains
// unchanged and is still sent/stored by the EA and backend.
export function brokerBrand(server = "") {
  const raw = String(server || "").trim();
  if (!raw) return "";

  const withoutEnvironment = raw.replace(
    /[\s._-]+(?:MT[45][\s._-]*)?(?:DEMO|TRIAL|LIVE|REAL|PRACTICE)(?:[\s._-]*\d+)?(?:[\s._-].*)?$/i,
    "",
  );
  const withoutPlatform = withoutEnvironment.replace(/[\s._-]+MT[45](?:[\s._-]*\d+)?$/i, "");
  const brand = withoutPlatform.replace(/[\s._-]+$/g, "").trim();
  return brand || raw;
}
