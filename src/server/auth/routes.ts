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
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  if (!(error instanceof AuthError)) return next(error);
  response
    .status(error.status)
    .json({ error: { code: error.code, message: error.message } });
}
