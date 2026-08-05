import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import type { ApiErrorBody, HealthResponse } from "../shared/api.js";
import type { SqliteDatabase } from "./auth/sqlite-store.js";
import { activitiesRouter } from "./activities.js";
import { authErrorHandler, authRouter } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
import { SqliteAuthStore } from "./auth/sqlite-store.js";
import { contactsRouter } from "./contacts/routes.js";
import { importsRouter } from "./imports.js";
import {
  CompanyService,
  companyErrorHandler,
  companyRouter,
} from "./companies.js";
import { tasksRouter } from "./tasks.js";
import { dealsRouter } from "./deals.js";
import { discoveryRouter } from "./discovery.js";

export function createApp(database: SqliteDatabase) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  const auth = new AuthService(new SqliteAuthStore(database));
  app.use("/api/auth", authRouter(auth));
  app.use("/api/contacts", contactsRouter(database, auth));
  app.use("/api/companies", companyRouter(new CompanyService(database), auth));
  app.use("/api/tasks", tasksRouter(database, auth));
  app.use("/api/activities", activitiesRouter(database, auth));
  app.use("/api/imports", importsRouter(database, auth));
  app.use("/api/deals", dealsRouter(database, auth));
  app.use("/api", discoveryRouter(database, auth));

  app.get("/api/health", (_request, response) => {
    const body: HealthResponse = {
      status: "ok",
      service: "northstar-crm",
      timestamp: new Date().toISOString(),
    };
    response.json(body);
  });

  const notFound: RequestHandler = (request, response, next) => {
    if (!request.path.startsWith("/api/")) return next();
    const body: ApiErrorBody = {
      error: {
        code: "not_found",
        message: "The requested resource was not found.",
        requestId: randomUUID(),
      },
    };
    response.status(404).json(body);
  };
  app.use(notFound);
  app.use(authErrorHandler);
  app.use(companyErrorHandler);

  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    const requestId = randomUUID();
    console.error("Unexpected request failure", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    const body: ApiErrorBody = {
      error: {
        code: "unexpected_error",
        message: "Northstar could not complete that request. Please try again.",
        requestId,
      },
    };
    response.status(500).json(body);
  };
  app.use(errors);
  return app;
}
