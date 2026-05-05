import React from "react";

/**
 * XauAi Cloud — XAU Cloud branded logo.
 * Gold cloud silhouette with a stylized "X" inside; one arm of the X extends
 * upward and to the right as an arrow that pierces through the top-right of
 * the cloud — signaling "trades go up, executed in the cloud".
 *
 * Designed to read at every size: 16px favicon → 1024px app-icon.
 *
 * Props:
 *   size  → pixel size (default 32)
 *   solid → true for filled app-icon style (dark rounded-square + filled glyphs)
 *           false for outlined nav/inline use (transparent, gold strokes only)
 *   className
 */
export default function XauAiLogo({ size = 32, solid = false, className = "" }) {
  const id = React.useId();
  const stroke = `url(#${id}-grad)`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="XauAi Cloud"
    >
      <defs>
        {/* Gold gradient — matches the brand: warm highlight → core gold → deep antique */}
        <linearGradient id={`${id}-grad`} x1="20" y1="20" x2="180" y2="190" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#FBE08A" />
          <stop offset="35%"  stopColor="#E5C158" />
          <stop offset="65%"  stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#8C6A1A" />
        </linearGradient>
        {/* Subtle inner highlight on solid X for premium metallic feel */}
        <linearGradient id={`${id}-x`} x1="50" y1="50" x2="160" y2="160" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#FFE8A0" />
          <stop offset="55%"  stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#A0791F" />
        </linearGradient>
      </defs>

      {/* App-icon background */}
      {solid && <rect x="0" y="0" width="200" height="200" rx="44" fill="#0A0A0A" />}

      {/* Cloud — two-lobed silhouette, generous proportions */}
      <path
        d="
          M 58 148
          C 36 148, 20 132, 22 110
          C 24 92, 38 80, 56 80
          C 60 58, 82 46, 104 50
          C 122 36, 152 44, 160 70
          C 182 72, 196 92, 188 112
          C 196 132, 178 150, 156 146
          C 140 154, 76 154, 58 148
          Z
        "
        fill={solid ? "transparent" : "transparent"}
        stroke={stroke}
        strokeWidth={solid ? 9 : 10}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* X — left arm (back-slash). Tapered ends for a sharper, premium feel. */}
      <path
        d="M 78 70 L 132 138"
        stroke={solid ? `url(#${id}-x)` : stroke}
        strokeWidth="13"
        strokeLinecap="round"
      />

      {/* X — right arm + arrow shaft. Starts at lower-left of the X, pierces
          through the cloud's top-right and exits as an arrow. */}
      <path
        d="M 70 138 L 162 54"
        stroke={solid ? `url(#${id}-x)` : stroke}
        strokeWidth="13"
        strokeLinecap="round"
      />

      {/* Arrowhead — clean V-chevron at the arrow tip */}
      <path
        d="M 142 50 L 162 54 L 158 74"
        stroke={solid ? `url(#${id}-x)` : stroke}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
