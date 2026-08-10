import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearSessionCookie,
  readSessionCookie,
  requestHasTrustedOrigin,
  sessionCookie,
} from "../src/auth/http.js";

test("session cookie is opaque, HTTP-only, same-site, scoped, and optionally secure", () => {
  const cookie = sessionCookie("secret/token", 120, true);
  assert.match(cookie, /^northstar_session=secret%2Ftoken;/);
  for (const directive of [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=120",
    "Secure",
  ])
    assert.match(cookie, new RegExp(directive));
  assert.equal(
    readSessionCookie("theme=dark; northstar_session=secret%2Ftoken"),
    "secret/token",
  );
  assert.match(clearSessionCookie(false), /Max-Age=0/);
});

test("state-changing requests require an exact same-origin host", () => {
  assert.equal(
    requestHasTrustedOrigin(
      "https://crm.example.test",
      "crm.example.test",
      true,
    ),
    true,
  );
  assert.equal(
    requestHasTrustedOrigin(
      "https://evil.example.test",
      "crm.example.test",
      true,
    ),
    false,
  );
  assert.equal(
    requestHasTrustedOrigin(undefined, "crm.example.test", true),
    false,
  );
  assert.equal(
    requestHasTrustedOrigin(
      "http://crm.example.test",
      "crm.example.test",
      true,
    ),
    false,
  );
});
