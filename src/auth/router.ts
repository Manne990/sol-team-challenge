import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  clearSessionCookie,
  readSessionCookie,
  requestHasTrustedOrigin,
  sessionCookie,
} from "./http.js";
import { AuthError, AuthService } from "./service.js";
import { SqliteAuthRepository } from "./sqlite-repository.js";
import type { Principal } from "./types.js";

const EIGHT_HOURS_SECONDS = 8 * 60 * 60;

function errorResponse(error: AuthError, response: Response): void {
  const status =
    error.code === "invalid_credentials" || error.code === "unauthenticated"
      ? 401
      : error.code === "forbidden"
        ? 403
        : error.code === "conflict"
          ? 409
          : 400;
  response
    .status(status)
    .json({ error: { code: error.code, message: error.message } });
}

export function createAuthRouter(
  database: DatabaseSync,
  secureCookies = process.env.NODE_ENV === "production",
) {
  const router = Router();
  const service = new AuthService(new SqliteAuthRepository(database));
  const sessionBody = (principal: Principal) => {
    const context = database
      .prepare(
        "SELECT u.email,u.display_name,o.name organization_name FROM users u JOIN organizations o ON o.id=? WHERE u.id=?",
      )
      .get(principal.organizationId, principal.userId) as
      Record<string, unknown> | undefined;
    return {
      authenticated: true,
      userId: principal.userId,
      organizationId: principal.organizationId,
      organizationName: String(context?.organization_name ?? "Organization"),
      userName: String(context?.display_name ?? "User"),
      userEmail: String(context?.email ?? ""),
      role: principal.role,
      expiresAt: principal.expiresAt,
    };
  };
  const audit = (
    organizationId: string,
    actorId: string,
    action: string,
    requestId: string,
  ) =>
    database
      .prepare(
        "INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,correlation_id,summary_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        organizationId,
        actorId,
        action,
        "session",
        null,
        requestId,
        "{}",
        new Date().toISOString(),
      );

  const sameOrigin = (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    if (
      !requestHasTrustedOrigin(
        request.header("origin"),
        request.header("host"),
        secureCookies,
      )
    ) {
      response.status(403).json({
        error: {
          code: "forbidden",
          message: "The request origin is not allowed.",
        },
      });
      return;
    }
    next();
  };

  router.post("/session", sameOrigin, async (request, response) => {
    try {
      const { email, password, organizationId } = request.body as Record<
        string,
        unknown
      >;
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        (organizationId !== undefined && typeof organizationId !== "string")
      ) {
        throw new AuthError("validation", "Enter a valid email and password.");
      }
      const signedIn = await service.signIn(email, password, organizationId);
      audit(
        signedIn.principal.organizationId,
        signedIn.principal.userId,
        "session.signed_in",
        String(response.locals.requestId),
      );
      response.setHeader(
        "set-cookie",
        sessionCookie(signedIn.token, EIGHT_HOURS_SECONDS, secureCookies),
      );
      response.status(201).json(sessionBody(signedIn.principal));
    } catch (error) {
      if (error instanceof AuthError) errorResponse(error, response);
      else throw error;
    }
  });

  router.get("/session", async (request, response) => {
    try {
      const token = readSessionCookie(request.header("cookie"));
      if (!token) {
        response.json({ authenticated: false });
        return;
      }
      const principal = await service.authenticate(token);
      response.json(sessionBody(principal));
    } catch (error) {
      if (error instanceof AuthError) errorResponse(error, response);
      else throw error;
    }
  });

  router.delete("/session", sameOrigin, async (request, response) => {
    const token = readSessionCookie(request.header("cookie"));
    try {
      const signedIn = await service.authenticate(token);
      audit(
        signedIn.organizationId,
        signedIn.userId,
        "session.signed_out",
        String(response.locals.requestId),
      );
    } catch {
      /* logout stays idempotent */
    }
    await service.logout(token);
    response.setHeader("set-cookie", clearSessionCookie(secureCookies));
    response.status(204).end();
  });

  return router;
}
