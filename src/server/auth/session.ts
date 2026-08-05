import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "northstar_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export function createSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const key = segment.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(segment.slice(separator + 1).trim());
  }
  return undefined;
}

export function sessionCookie(secret: string, expiresAt: Date, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(secret)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
