const COOKIE_NAME = "northstar_session";

export function readSessionCookie(
  header: string | undefined,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function sessionCookie(
  token: string,
  ttlSeconds: number,
  secure: boolean,
): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(ttlSeconds))}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookie("", 0, secure);
}

export function requestHasTrustedOrigin(
  origin: string | undefined,
  host: string | undefined,
  secure: boolean,
): boolean {
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === (secure ? "https:" : "http:") && parsed.host === host
    );
  } catch {
    return false;
  }
}
