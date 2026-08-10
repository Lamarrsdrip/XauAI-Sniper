const VIEWPORT_GUARDS_KEY = "__XAU_VIEWPORT_GUARDS_WIRED__";

// Modern iOS Safari intentionally ignores viewport scale limits for pinch
// accessibility. These event guards are the narrow complement for the native
// app shell: no scale resets, and no interference with one-finger scrolling.
export function installViewportGuards() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window[VIEWPORT_GUARDS_KEY]) return;
  window[VIEWPORT_GUARDS_KEY] = true;

  const preventScale = (event) => event.preventDefault();
  document.addEventListener("gesturestart", preventScale, { passive: false });
  document.addEventListener("gesturechange", preventScale, { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
}
