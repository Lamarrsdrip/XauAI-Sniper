import { describe, expect, it } from "vitest";
import { buildXAuthorizationUrl, pkceChallenge } from "./xOAuth.js";

describe("X OAuth authorization", () => {
  it("requests only the publishing scopes with PKCE and the fixed production callback", () => {
    const url = new URL(buildXAuthorizationUrl({ clientId: "client-id", state: "state-value", codeChallenge: "challenge-value" }));
    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("https://xaucloud.io/api/admin/x-posting/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("tweet.read tweet.write users.read offline.access");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("uses the RFC 7636 base64url S256 challenge rather than a hexadecimal digest", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
