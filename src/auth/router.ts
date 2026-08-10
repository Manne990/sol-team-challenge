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
      response
        .status(403)
        .json({
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
      response.setHeader(
        "set-cookie",
        sessionCookie(signedIn.token, EIGHT_HOURS_SECONDS, secureCookies),
      );
      response
        .status(201)
        .json({
          userId: signedIn.principal.userId,
          organizationId: signedIn.principal.organizationId,
          role: signedIn.principal.role,
          expiresAt: signedIn.principal.expiresAt,
        });
    } catch (error) {
      if (error instanceof AuthError) errorResponse(error, response);
      else throw error;
    }
  });

  router.get("/session", async (request, response) => {
    try {
      const principal = await service.authenticate(
        readSessionCookie(request.header("cookie")),
      );
      response.json({
        userId: principal.userId,
        organizationId: principal.organizationId,
        role: principal.role,
        expiresAt: principal.expiresAt,
      });
    } catch (error) {
      if (error instanceof AuthError) errorResponse(error, response);
      else throw error;
    }
  });

  router.delete("/session", sameOrigin, async (request, response) => {
    await service.logout(readSessionCookie(request.header("cookie")));
    response.setHeader("set-cookie", clearSessionCookie(secureCookies));
    response.status(204).end();
  });

  return router;
}
