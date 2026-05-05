import React from "react";

/**
 * XauAi Cloud minimal logo — fintech style.
 * - Gold cloud outline with subtle inner gradient
 * - Upward arrow inside (signals "trades up", "rising")
 * - Designed to read at 16px favicon → 1024px app-icon
 *
 * Props:
 *   size  → pixel size (default 32)
 *   solid → set true to render filled cloud (good for app icons on dark BG)
 *   className
 */
export default function XauAiLogo({ size = 32, solid = false, className = "" }) {
  const id = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="XauAi Cloud"
    >
      <defs>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#F5D061" />
          <stop offset="55%"  stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#9C7A1F" />
        </linearGradient>
        <linearGradient id={`${id}-arrow`} x1="32" y1="14" x2="32" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#FFEAA0" />
          <stop offset="100%" stopColor="#D4AF37" />
        </linearGradient>
      </defs>

      {/* Cloud silhouette — single closed path, left-rounded, peaks on right */}
      <path
        d="M20 46
           C12 46 6 40 6 33
           C6 27 10 22 16 21
           C18 14 25 9 33 9
           C42 9 49 15 50 24
           C56 24 60 28 60 33
           C60 40 54 46 47 46
           Z"
        fill={solid ? `url(#${id}-grad)` : "transparent"}
        stroke={`url(#${id}-grad)`}
        strokeWidth={solid ? 0 : 3}
        strokeLinejoin="round"
      />

      {/* Up arrow — bold, centered, gold gradient stem + chevron head */}
      <path
        d="M32 44 L32 22 M32 22 L24 30 M32 22 L40 30"
        stroke={solid ? "#0A0A0A" : `url(#${id}-arrow)`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
