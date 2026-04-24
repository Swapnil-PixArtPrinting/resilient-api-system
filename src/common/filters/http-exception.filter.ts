import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { generateTraceId } from "../utils/trace.util";

/**
 * Standardized error response shape.
 * Every error in this service — validation, rate limits, 500s — returns this format.
 * The traceId allows support engineers to grep logs and find the exact request.
 */
export interface StandardErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  traceId: string;
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { traceId?: string }>();

    // Prefer the traceId attached by TraceInterceptor; fall back to a new one
    const traceId = request.traceId ?? generateTraceId();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const { code, message } = this.extractCodeAndMessage(exception, status);

    const body: StandardErrorResponse = {
      statusCode: status,
      code,
      message,
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    this.logger.error(`[${traceId}] ${status} ${code} — ${message}`, {
      traceId,
      statusCode: status,
      path: request.url,
      method: request.method,
      exception:
        exception instanceof Error ? exception.stack : String(exception),
    });

    response.status(status).json(body);
  }

  private extractCodeAndMessage(
    exception: unknown,
    status: number,
  ): { code: string; message: string } {
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();

      if (typeof payload === "object" && payload !== null) {
        const p = payload as Record<string, any>;
        // Custom structured throw: new HttpException({ code, message }, status)
        if (p.code) {
          return {
            code: p.code,
            message: Array.isArray(p.message)
              ? p.message.join("; ")
              : String(p.message),
          };
        }
        // NestJS ValidationPipe errors
        if (Array.isArray(p.message)) {
          return { code: "VALIDATION_ERROR", message: p.message.join("; ") };
        }
        return {
          code: this.statusToCode(status),
          message: String(p.message ?? "Request failed"),
        };
      }

      return { code: this.statusToCode(status), message: String(payload) };
    }

    return {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    };
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      422: "UNPROCESSABLE_ENTITY",
      429: "RATE_LIMIT_EXCEEDED",
      500: "INTERNAL_SERVER_ERROR",
      503: "SERVICE_UNAVAILABLE",
    };
    return map[status] ?? "UNKNOWN_ERROR";
  }
}
