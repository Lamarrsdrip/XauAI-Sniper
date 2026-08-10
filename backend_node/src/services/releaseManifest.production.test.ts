import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { currentEaRelease, EA_RELEASES_DIR, verifyReleaseArtifact } from "./releaseManifest.js";

describe("authoritative XauCloud.io production release", () => {
  test("manifest, download filename and exact EX5 bytes agree", async () => {
    const release = await currentEaRelease();
    expect(release).not.toBeNull();
    expect(release?.version).toBe("v6.26.3");
    expect(release?.["customer_filename"]).toBe("XauCloud.io.ex5");
    expect(release?.["ex5_filename"]).toBe("XauCloud.io.ex5");
    expect(await verifyReleaseArtifact("v6.26.3", release!)).toBeNull();

    const bytes = await readFile(path.join(EA_RELEASES_DIR, "v6.26.3", "XauCloud.io.ex5"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("a20078555496a3006d836cae39df794f66f30f4956af9ce08d2903b6ee392fd8");
  });
});
