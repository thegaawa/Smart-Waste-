import { ApiErrorCode, type ApiErrorBody } from "@smart-waste/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";

import { ApiError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

/** 404 for unknown routes, in the same JSON shape as every other error. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: { code: ApiErrorCode.NOT_FOUND, message: `No route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

interface BodyParserError {
  type?: string;
  status?: number;
}

interface PrismaKnownError {
  code?: string;
  meta?: { target?: unknown };
}

/**
 * Converts anything thrown in a handler into a consistent JSON error.
 * Internal errors are logged in full but never leaked to clients.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies error middleware by its arity, so `next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req, res, _next) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(err.toBody());
      return;
    }

    const parserError = err as BodyParserError;
    if (parserError?.type === "entity.parse.failed") {
      res.status(400).json(ApiError.validation([{ field: "body", message: "The request body is not valid JSON" }]).toBody());
      return;
    }
    if (parserError?.type === "entity.too.large") {
      res.status(413).json({
        error: { code: ApiErrorCode.VALIDATION_ERROR, message: "The request body is too large" },
      } satisfies ApiErrorBody);
      return;
    }

    // Unique-constraint violation that slipped past an explicit check.
    const prismaError = err as PrismaKnownError;
    if (prismaError?.code === "P2002") {
      res.status(409).json(ApiError.conflict("A record with the same unique value already exists").toBody());
      return;
    }
    if (prismaError?.code === "P2025") {
      res.status(404).json(ApiError.notFound().toBody());
      return;
    }

    logger.error({ err, method: req.method, url: req.originalUrl }, "Unhandled error");
    res.status(500).json(ApiError.internal().toBody());
  };
}
