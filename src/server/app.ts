import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import express, { type ErrorRequestHandler } from "express";
import { createActivitiesRouter } from "../activities/router.js";
import { createAuthRouter } from "../auth/router.js";
import { AuthError } from "../auth/service.js";
import { createCompaniesRouter } from "../companies/router.js";
import { createDealsRouter } from "../deals/router.js";
import { createImportsRouter } from "../imports/router.js";
import type { ApiError, HealthResponse } from "../shared/api.js";
import { contactsRouter } from "./contacts/routes.js";
import { createTasksRouter } from "../tasks/router.js";

export function createApp(database?: DatabaseSync, secureCookies?: boolean) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((request, response, next) => {
    response.locals.requestId = request.header("x-request-id") ?? randomUUID();
    response.setHeader("x-request-id", response.locals.requestId);
    next();
  });
  app.get("/api/health", (_request, response) => {
    const body: HealthResponse = {
      status: "ok",
      service: "northstar-crm",
      timestamp: new Date().toISOString(),
    };
    response.json(body);
  });
  if (database) {
    app.use("/api/auth", createAuthRouter(database, secureCookies));
    app.use("/api/companies", createCompaniesRouter(database, secureCookies));
    app.use("/api/contacts", contactsRouter(database));
    app.use("/api/tasks", createTasksRouter(database, secureCookies));
    app.use("/api/deals", createDealsRouter(database, secureCookies));
    app.use("/api/imports", createImportsRouter(database, secureCookies));
    app.use("/api/activities", createActivitiesRouter(database, secureCookies));
  }
  app.use("/api", (_request, response) => {
    const body: ApiError = {
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
        requestId: response.locals.requestId,
      },
    };
    response.status(404).json(body);
  });
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    void _next;
    if (error instanceof AuthError) {
      const status =
        error.code === "unauthenticated" || error.code === "invalid_credentials"
          ? 401
          : error.code === "forbidden"
            ? 403
            : error.code === "conflict"
              ? 409
              : 400;
      response.status(status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    console.error("Unexpected request failure", {
      requestId: response.locals.requestId,
      error,
    });
    const body: ApiError = {
      error: {
        code: "UNEXPECTED_ERROR",
        message: "Something went wrong. Please try again.",
        requestId: response.locals.requestId,
      },
    };
    response.status(500).json(body);
  };
  app.use(errors);
  return app;
}
