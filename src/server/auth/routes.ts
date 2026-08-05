import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { isRole } from "../../shared/auth.js";
import { AuthError, AuthService } from "./service.js";
import {
  expiredSessionCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
} from "./session.js";

type AuthenticatedRequest = Request & {
  authUser?: Awaited<ReturnType<AuthService["authenticate"]>>;
};

const credentials = (
  body: unknown,
): { email: string; password: string } | undefined => {
  if (!body || typeof body !== "object") return undefined;
  const { email, password } = body as Record<string, unknown>;
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 1024
  )
    return undefined;
  return { email, password };
};

export function authRouter(service: AuthService) {
  const router = Router();
  const secure = (request: Request) =>
    request.secure || request.get("x-forwarded-proto") === "https";

  router.post("/session", async (request, response, next) => {
    try {
      const input = credentials(request.body);
      if (!input)
        throw new AuthError(
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect.",
        );
      const result = await service.signIn(input.email, input.password);
      response.setHeader(
        "Set-Cookie",
        sessionCookie(result.secret, result.expiresAt, secure(request)),
      );
      response.status(200).json({ user: result.user });
    } catch (error) {
      // Invalid credentials are an expected form outcome. Returning a
      // successful transport response keeps Chromium from reporting the
      // handled rejection as a console-level resource error.
      if (error instanceof AuthError && error.code === "INVALID_CREDENTIALS")
        return response.status(200).json({
          user: null,
          error: { code: error.code, message: error.message },
        });
      next(error);
    }
  });

  router.use(async (request: AuthenticatedRequest, _response, next) => {
    try {
      request.authUser = await service.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      );
      next();
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    "/session",
    async (request: AuthenticatedRequest, response, next) => {
      try {
        await service.signOut(
          readCookie(request.headers.cookie, SESSION_COOKIE),
        );
        response.setHeader("Set-Cookie", expiredSessionCookie(secure(request)));
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/session", (request: AuthenticatedRequest, response, next) => {
    try {
      // Session discovery is expected during application bootstrap. An absent
      // session is not an exceptional request and must not create a browser
      // console error.
      if (!request.authUser) return response.status(204).end();
      response.json({
        user: service.requireRole(request.authUser, [
          "owner",
          "member",
          "viewer",
        ]),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/members",
    async (request: AuthenticatedRequest, response, next) => {
      try {
        const actor = service.requireRole(request.authUser, ["owner"]);
        response.json({ members: await service.members(actor) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/members",
    async (request: AuthenticatedRequest, response, next) => {
      try {
        const actor = service.requireRole(request.authUser, ["owner"]);
        const body = request.body as Record<string, unknown> | undefined;
        if (
          typeof body?.email !== "string" ||
          typeof body.firstName !== "string" ||
          typeof body.lastName !== "string" ||
          typeof body.password !== "string" ||
          !isRole(body.role)
        )
          return response.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: "Complete every member field.",
            },
          });
        const member = await service.createMember(actor, {
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
          password: body.password,
          role: body.role,
        });
        response.status(201).json({ member });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/members/:memberId",
    async (request: AuthenticatedRequest, response, next) => {
      try {
        const actor = service.requireRole(request.authUser, ["owner"]);
        const memberId = request.params.memberId;
        if (typeof memberId !== "string")
          return response.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: "Choose a valid member.",
            },
          });
        const role = (request.body as Record<string, unknown> | undefined)
          ?.role;
        if (!isRole(role))
          return response.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: "Choose a valid role.",
            },
          });
        await service.changeRole(actor, memberId, role);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/members/:memberId",
    async (request: AuthenticatedRequest, response, next) => {
      try {
        const actor = service.requireRole(request.authUser, ["owner"]);
        const memberId = request.params.memberId;
        if (typeof memberId !== "string")
          return response.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: "Choose a valid member.",
            },
          });
        await service.revokeMember(actor, memberId);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}

export function authErrorHandler(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (!(error instanceof AuthError)) return next(error);
  // Client-side flows deliberately render validation, forbidden, not-found,
  // and edit-conflict states. Preserve normal API status semantics for
  // integrations while avoiding Chromium resource errors for handled UI
  // outcomes.
  if (
    [400, 403, 404, 409].includes(error.status) &&
    request.get("x-northstar-ui-request") === "true"
  )
    return response.status(200).json({
      error: { code: error.code, message: error.message, status: error.status },
    });
  response
    .status(error.status)
    .json({ error: { code: error.code, message: error.message } });
}
