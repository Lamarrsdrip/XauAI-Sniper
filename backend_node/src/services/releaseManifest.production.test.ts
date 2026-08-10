import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { currentEaRelease, EA_RELEASES_DIR, verifyReleaseArtifact } from "./releaseManifest.js";

describe("authoritative XauCloud.io production release", () => {
  test("manifest, download filename and exact EX5 bytes agree", async () => {
    const release = await currentEaRelease();
    expect(release).not.toBeNull();
    const version = String(release?.version ?? "");
    const filename = String(release?.["ex5_filename"] ?? "");
    expect(version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(release?.["customer_filename"]).toBe(filename);
    expect(await verifyReleaseArtifact(version, release!)).toBeNull();

    const bytes = await readFile(path.join(EA_RELEASES_DIR, version, filename));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(release?.["ex5_sha256"]);
  });
});
