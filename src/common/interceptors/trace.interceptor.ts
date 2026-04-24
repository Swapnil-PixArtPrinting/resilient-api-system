import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Request, Response } from "express";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { generateTraceId } from "../utils/trace.util";

/**
 * Trace Interceptor — Observability Pillar
 *
 * Attaches a traceId to every request so all log lines for that request
 * share the same identifier. In production you would propagate this via
 * OpenTelemetry or a distributed tracing system (Jaeger, Zipkin, Datadog).
 *
 * Clients can supply their own `X-Trace-Id` header to correlate across services.
 */
@Injectable()
export class TraceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TraceInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { traceId: string }>();
    const response = context.switchToHttp().getResponse<Response>();

    const traceId =
      (request.headers["x-trace-id"] as string) || generateTraceId();
    request.traceId = traceId;

    // Propagate traceId back to the client so they can reference it in support tickets
    response.setHeader("X-Trace-Id", traceId);

    const { method, url } = request;
    const startTime = Date.now();

    this.logger.log(`→ ${method} ${url}`, { traceId, method, url });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(
            `← ${method} ${url} ${response.statusCode} [${duration}ms]`,
            {
              traceId,
              method,
              url,
              statusCode: response.statusCode,
              durationMs: duration,
            },
          );
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          this.logger.error(`← ${method} ${url} ERROR [${duration}ms]`, {
            traceId,
            method,
            url,
            durationMs: duration,
            error: err.message,
          });
        },
      }),
    );
  }
}
