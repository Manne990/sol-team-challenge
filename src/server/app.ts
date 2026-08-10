import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import type { ApiError, HealthResponse } from "../shared/api.js";

export function createApp() {
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
