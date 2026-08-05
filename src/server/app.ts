import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import type { ApiErrorBody, HealthResponse } from "../shared/api.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

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
