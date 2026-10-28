import {
  Catch,
  Optional,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Logger } from "nestjs-pino";
import type { ApiErrorBody, ErrorCode } from "@leadforge/contracts";
import { AppError, retryAfterDetails } from "./app.error.js";
import { ThrottledException } from "../throttling/tracked-throttler.guard.js";
import { getRequestId } from "../request/request-context.js";
import { redactUrl } from "../security/http-security.js";
import { MetricsService } from "../../metrics/metrics.service.js";

/**
 * Maps every thrown error to the API error envelope. Internal errors never leak
 * their message; clients receive INTERNAL_ERROR with the request ID for support.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    @Optional() protected readonly metrics?: MetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = getRequestId(req);

    const { status, body } = this.translate(exception, requestId);
    this.metrics?.countError(body.error.code, status);

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: redactUrl(req.originalUrl), method: req.method },
        "Unhandled error",
      );
    } else if (status === 429) {
      // The real wait when it is known (the per-account sign-in lock, a route limit's block),
      // otherwise a nominal minute.
      res.setHeader("Retry-After", String(retryAfterOf(exception) ?? DEFAULT_RETRY_AFTER_SECONDS));
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
      const limited = envelope(
        429,
        "RATE_LIMITED",
        "Too many requests. Try again shortly",
        requestId,
      );
      const seconds = retryAfterOf(exception);
      return seconds === undefined
        ? limited
        : {
            status: 429,
            body: { error: { ...limited.body.error, details: retryAfterDetails(seconds) } },
          };
    }

    if (exception instanceof HttpException) {
      // Only the framework throws these (application code throws AppError): unknown routes,
      // body-parser and URI errors Nest re-wraps, multer limits. Their messages can echo the
      // request (the path, a fragment of the body), so a fixed message per status is returned.
      const status = exception.getStatus();
      return envelope(
        status,
        codeForStatus(status),
        frameworkMessage(status, exception.message),
        requestId,
      );
    }

    // Client errors raised before routing by the body parsers (http-errors: `expose` and a 4xx
    // `status`): malformed JSON, a body over the size limit, an unsupported charset. Their
    // messages can quote the body, so a fixed message per status is returned instead.
    const clientError = exception as { expose?: unknown; status?: unknown; type?: unknown } | null;
    if (
      clientError &&
      clientError.expose === true &&
      typeof clientError.status === "number" &&
      clientError.status >= 400 &&
      clientError.status < 500
    ) {
      const status = clientError.status;
      const message =
        status === 413
          ? "The request body is too large"
          : status === 415
            ? "Unsupported request encoding or charset"
            : clientError.type === "entity.parse.failed"
              ? "The request body is not valid JSON"
              : "The request could not be read";
      return envelope(status, codeForStatus(status), message, requestId);
    }

    return envelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "INTERNAL_ERROR",
      "Something went wrong on our side",
      requestId,
    );
  }
}

const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** Seconds until a 429 can be retried, when the error knows it. */
function retryAfterOf(exception: unknown): number | undefined {
  if (exception instanceof AppError || exception instanceof ThrottledException)
    return exception.retryAfterSeconds;
  return undefined;
}

function envelope(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
): { status: number; body: ApiErrorBody } {
  return { status, body: { error: { code, message, requestId } } };
}

function frameworkMessage(status: number, original: string): string {
  if (status >= 500) return "Something went wrong on our side";
  switch (status) {
    case 400:
      return /JSON/i.test(original)
        ? "The request body is not valid JSON"
        : "The request could not be read";
    case 401:
      return "Sign in to continue";
    case 403:
      return "You do not have access to this resource";
    case 404:
      return "No such endpoint";
    case 405:
      return "Method not allowed";
    case 413:
      return "The request body is too large";
    case 415:
      return "Unsupported media type";
    default:
      return "The request was refused";
  }
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
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 415:
      return "UNSUPPORTED_MEDIA_TYPE";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED";
  }
}
