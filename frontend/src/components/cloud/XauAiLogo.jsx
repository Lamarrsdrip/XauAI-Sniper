import React from "react";

/**
 * Official XauAi Cloud logo asset.
 * Uses the brand PNG shipped at /xauai-logo.png so the rendered mark
 * always matches the design source — no SVG re-creation drift.
 *
 * Props:
 *   size       → pixel size (default 32)
 *   className  → extra classes
 *   rounded    → "full" | "lg" | "none"  (icon shape on light backgrounds)
 */
export default function XauAiLogo({ size = 32, className = "", rounded = "lg" }) {
  const radius = rounded === "full" ? "9999px" : rounded === "lg" ? "22%" : "0";
  return (
    <img
      src="/xauai-logo.png"
      alt="XauAi Cloud"
      width={size}
      height={size}
      loading="eager"
      decoding="async"
      style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", display: "block" }}
      className={className}
    />
  );
}
