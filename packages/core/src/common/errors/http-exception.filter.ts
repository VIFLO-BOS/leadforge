import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Logger } from "nestjs-pino";
import type { ApiErrorBody, ErrorCode } from "@leadforge/contracts";
import { AppError } from "./app.error.js";
import { getRequestId } from "../request/request-context.js";

/**
 * Maps every thrown error to the API error envelope. Internal errors never leak
 * their message; clients receive INTERNAL_ERROR with the request ID for support.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = getRequestId(req);

    const { status, body } = this.translate(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: req.originalUrl, method: req.method },
        "Unhandled error",
      );
    } else if (status === 429) {
      res.setHeader("Retry-After", "60");
    }

    res.status(status).json(body);
  }

  private translate(exception: unknown, requestId: string): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details ? { details: exception.details } : {}),
            requestId,
          },
        },
      };
    }

    if (exception instanceof ThrottlerException) {
      return envelope(429, "RATE_LIMITED", "Too many requests. Try again shortly", requestId);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = codeForStatus(status);
      const response = exception.getResponse();
      const message =
        status >= 500
          ? "Something went wrong on our side"
          : typeof response === "string"
            ? response
            : ((response as { message?: string | string[] }).message?.toString() ??
              exception.message);
      return envelope(status, code, message, requestId);
    }

    return envelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "INTERNAL_ERROR",
      "Something went wrong on our side",
      requestId,
    );
  }
}

function envelope(status: number, code: ErrorCode, message: string, requestId: string) {
  return { status, body: { error: { code, message, requestId } } };
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "VALIDATION_FAILED";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED";
  }
}
