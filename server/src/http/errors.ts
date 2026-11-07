import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import {
  ERROR_CODES,
  ERROR_STATUS_MAP,
  type ErrorCode,
} from "@leash/shared";

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    const status = ERROR_STATUS_MAP[err.code] || 500;
    res.status(status).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    const message = err.errors.map((e) => e.message).join("; ");
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message,
      },
    });
    return;
  }

  res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "An internal server error occurred",
    },
  });
}
