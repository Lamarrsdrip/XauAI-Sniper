import { describe, expect, it } from "vitest";
import { cloudEncrypt } from "../cloudCrypto.js";
import { publicAgentFamilyConfig, resolveAgentFamilyConfig, createAgentFamilyClient } from "./config.js";

const emptyEnv = {
  XAUCLOUD_AGENT_FAMILY_ENABLED: "false",
  XAUCLOUD_AGENT_FAMILY_PUBLISH: "false",
  TERMIX_ACCESS_TOKEN: "",
  TERMIX_REFRESH_TOKEN: "",
  TERMIX_AGENT_ID: "",
  TERMIX_API_BASE: "https://platform-backend.prod.termix.live",
};

describe("Agent.family admin configuration", () => {
  it("defaults to disconnected without credentials or registration", () => {
    const config = resolveAgentFamilyConfig(null, emptyEnv);
    expect(config.enabled).toBe(false);
    expect(publicAgentFamilyConfig(config)).toMatchObject({
      accessTokenConfigured: false, connectionReady: false, safeToPublish: false,
    });
    expect(createAgentFamilyClient(config)).toBeNull();
  });

  it("overrides legacy env and masks encrypted credentials in every public response", () => {
    const encrypted = cloudEncrypt("test_access_token_that_must_never_leave_backend");
    const refresh = cloudEncrypt("secret_refresh_token_not_for_browser");
    const config = resolveAgentFamilyConfig({
      enabled: true, publishEnabled: true, agentId: "provider-123",
      coverUrl: "https://xaucloud.io/cover.png",
      accessTokenEncrypted: encrypted, refreshTokenEncrypted: refresh,
      updatedAt: "2026-11-04T15:00:00Z",
    }, {
      ...emptyEnv, TERMIX_ACCESS_TOKEN: "stale_environment_token",
      TERMIX_AGENT_ID: "wrong-env-id",
    });
    expect(config.agentId).toBe("provider-123");
    expect(config.accessToken).toContain("test_access_token");
    expect(createAgentFamilyClient(config)).not.toBeNull();
    const publicView = publicAgentFamilyConfig(config);
    expect(publicView.safeToPublish).toBe(true);
    expect(publicView.accessTokenConfigured).toBe(true);
    expect(publicView.refreshTokenConfigured).toBe(true);
    expect(JSON.stringify(publicView)).not.toContain("test_access_token");
    expect(JSON.stringify(publicView)).not.toContain("secret_refresh_token");
    expect(JSON.stringify(publicView)).not.toContain(encrypted);
    expect(JSON.stringify(publicView)).not.toContain(refresh);
  });

  it("fails closed if an encrypted credential was tampered with", () => {
    expect(() => resolveAgentFamilyConfig({
      accessTokenEncrypted: cloudEncrypt("valid_token_thirty_chars_more").slice(0, -3) + "xxx",
    }, emptyEnv)).toThrow();
  });

  it("never considers publishing ready without HTTPS cover", () => {
    const config = resolveAgentFamilyConfig({
      enabled: true, publishEnabled: true, agentId: "provider-123",
      accessTokenEncrypted: cloudEncrypt("real_token_twenty_chars_here"),
      coverUrl: "http://localhost/cover.png",
    }, emptyEnv);
    expect(publicAgentFamilyConfig(config).safeToPublish).toBe(false);
  });

  it("refuses to reconnect with explicitly revoked database credentials despite environment fallback", () => {
    const config = resolveAgentFamilyConfig({
      enabled: false, accessTokenEncrypted: "", refreshTokenEncrypted: "",
    }, { ...emptyEnv, TERMIX_ACCESS_TOKEN: "example_legacy_token" });
    expect(config.accessToken).toBe("");
    expect(publicAgentFamilyConfig(config).accessTokenConfigured).toBe(false);
  });
});
