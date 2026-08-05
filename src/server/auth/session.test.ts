import { describe, expect, it } from "vitest";
import { createSessionSecret, expiredSessionCookie, hashSessionSecret, readCookie, sessionCookie } from "./session.js";

describe("session secrets", () => {
  it("creates opaque, non-repeating secrets and deterministic hashes", () => {
    const first = createSessionSecret();
    const second = createSessionSecret();
    expect(first).not.toBe(second);
    expect(first).toHaveLength(43);
    expect(hashSessionSecret(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionSecret(first)).toBe(hashSessionSecret(first));
  });

  it("round trips the secure cookie without exposing it to scripts", () => {
    const cookie = sessionCookie("secret value", new Date("2026-08-06T00:00:00Z"), true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(readCookie(cookie, "northstar_session")).toBe("secret value");
    expect(expiredSessionCookie(false)).toContain("Max-Age=0");
  });
});
