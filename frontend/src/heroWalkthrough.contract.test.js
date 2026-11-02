const fs = require("fs");
const path = require("path");
describe("XauCloud real walkthrough embedded directly on the public homepage", () => {
  const src = fs.readFileSync(path.join(__dirname, "components", "HeroSection.jsx"), "utf8");
  test("homepage embeds the exact owner-supplied YouTube Short for inline playback", () => {
    expect(src).toContain("https://www.youtube-nocookie.com/embed/guOB0N2y-N0");
    expect(src).toContain("allowFullScreen");
    expect(src).toContain('loading="lazy"');
    expect(src).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(src).toContain('data-testid="hero-video-card"');
  });
  test("removes the redundant Command Center hero card while retaining product CTAs", () => {
    expect(src).not.toContain('aria-label="Command Center feature overview"');
    expect(src).not.toContain("Live bot visibility");
    expect(src).not.toContain("Risk-aware controls");
    expect(src).toContain("Buy XauCloud");
    expect(src).toContain("Start 3-Day Trial");
  });
  test("uses a responsive vertical Shorts player with a playback fallback", () => {
    expect(src).toContain("aspect-[9/16]");
    expect(src).toContain("max-w-[255px]");
    expect(src).toContain("https://youtube.com/shorts/guOB0N2y-N0");
    expect(src).toContain("Tap play");
  });
});
