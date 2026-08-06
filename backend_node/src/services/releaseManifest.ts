import { existsSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// Port of server.py:2162 `EA_RELEASES_DIR = ROOT_DIR / "ea_releases"` --
// same convention (directory lives next to the running backend process).
export const EA_RELEASES_DIR = path.join(process.cwd(), "ea_releases");
export const DOWNLOAD_TOKEN_TTL_SECONDS = 300;
export const PRODUCTION_TIMEFRAME = "M10";

export interface EaRelease {
  version: string;
  edition?: string;
  source_commit?: string;
  stable_status?: boolean;
  release_notes?: string;
  build_timestamp?: string;
  [key: string]: unknown;
}

export interface EaReleaseManifest {
  current_version?: string;
  releases?: Record<string, EaRelease>;
  [key: string]: unknown;
}

/** Port of server.py:2166 `_load_ea_release_manifest`. */
export async function loadEaReleaseManifest(): Promise<EaReleaseManifest> {
  const p = path.join(EA_RELEASES_DIR, "manifest.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(await readFile(p, "utf8")) as EaReleaseManifest;
  } catch {
    return {};
  }
}

/** Port of server.py:2177 `_current_ea_release` -- fails closed unless current_version points to a stable_status=true release. */
export async function currentEaRelease(): Promise<EaRelease | null> {
  const manifest = await loadEaReleaseManifest();
  const current = manifest.current_version;
  if (!current) return null;
  const release = manifest.releases?.[current];
  if (!release) return null;
  if (!release.stable_status) return null;
  return release;
}

/** Port of server.py:2214 `_normalize_release_version`. */
export function normalizeReleaseVersion(v: string): string {
  const raw = String(v || "").trim();
  const marker = raw.toLowerCase().lastIndexOf("_v");
  const afterMarker = marker >= 0 ? raw.slice(marker + 2) : raw;
  return afterMarker.replace(/^[vV]+/, "").split("_", 1)[0] ?? "";
}

/** Port of server.py:2225 `_known_release_versions`. */
export async function knownReleaseVersions(): Promise<Set<string>> {
  const manifest = await loadEaReleaseManifest();
  return new Set(Object.keys(manifest.releases ?? {}).map(normalizeReleaseVersion));
}

/** Port of server.py:2230 `build_public_release_display`. */
export async function buildPublicReleaseDisplay(eaVersion: string): Promise<Record<string, unknown>> {
  const release = await currentEaRelease();
  const publicVersion = normalizeReleaseVersion(release?.version ?? "");
  const reported = normalizeReleaseVersion(eaVersion);
  const known = await knownReleaseVersions();
  const recognized = Boolean(reported) && known.has(reported);
  const updateAvailable = Boolean(publicVersion) && Boolean(reported) && reported !== publicVersion;
  return {
    public_product_name: "XauCloud",
    public_version: publicVersion || null,
    public_display_name: publicVersion ? `XauCloud-${publicVersion}` : "XauCloud",
    reported_build_recognized: recognized,
    installed_version: reported || null,
    latest_version: publicVersion || null,
    update_available: updateAvailable,
    latest_release_notes: release?.release_notes ?? "",
    latest_build_timestamp: release?.build_timestamp ?? null,
  };
}

/** Port of server.py:2258 `_resolve_update_status`. */
export function resolveUpdateStatus(
  manifestHasCurrentPointer: boolean,
  currentReleaseServable: boolean,
  licenseActive: boolean,
  installedVersion: string | null,
  updateAvailable: boolean,
): string {
  if (!manifestHasCurrentPointer) return "download_unavailable";
  if (!currentReleaseServable) return "release_verification_failed";
  if (!licenseActive) return "license_inactive";
  if (!installedVersion) return "installed_version_unknown";
  if (updateAvailable) return "update_available";
  return "up_to_date";
}

/** Port of server.py:2423 `_write_manifest` -- atomic write (temp file + rename) so a reader never observes a half-written file. */
export async function writeManifest(manifest: EaReleaseManifest): Promise<void> {
  const p = path.join(EA_RELEASES_DIR, "manifest.json");
  const tmp = `${p}.tmp`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await rename(tmp, p);
}

/** Port of server.py:2429 `_verify_release_artifact` -- null if the release's EX5 exists on disk and its hash matches the manifest, else a human-readable reason. */
export async function verifyReleaseArtifact(version: string, release: EaRelease): Promise<string | null> {
  const filename = String(release["ex5_filename"] ?? "");
  if (!filename) return "Manifest entry has no ex5_filename.";
  const p = path.join(EA_RELEASES_DIR, version, filename);
  if (!existsSync(p)) return `EX5 artifact not found at ${p}.`;
  const actualHash = createHash("sha256").update(await readFile(p)).digest("hex");
  const expectedHash = String(release["ex5_sha256"] ?? "");
  if (actualHash !== expectedHash) return `SHA-256 mismatch: manifest says ${expectedHash}, artifact is ${actualHash}.`;
  return null;
}

/** Port of server.py:2280 `reconcile_production_timeframe`. */
export function reconcileProductionTimeframe(reportedTimeframe: string, buildRecognized: boolean): Record<string, unknown> {
  const reported = String(reportedTimeframe || "").trim().toUpperCase();
  const mismatch = Boolean(reported) && reported !== PRODUCTION_TIMEFRAME;
  const trustReported = buildRecognized && !mismatch;
  return {
    display_timeframe: trustReported ? reported : PRODUCTION_TIMEFRAME,
    reported_timeframe: reported || null,
    timeframe_mismatch: mismatch,
    build_recognized: buildRecognized,
  };
}
