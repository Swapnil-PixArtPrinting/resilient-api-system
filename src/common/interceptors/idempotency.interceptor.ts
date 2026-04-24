import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Request, Response } from "express";
import { Observable, from, of } from "rxjs";
import { switchMap } from "rxjs/operators";
import { RedisService } from "../../redis/redis.service";

const IDEMPOTENCY_TTL_SECONDS = 86_400; // Cache responses for 24 hours

/**
 * Idempotency Interceptor
 *
 * Requires every POST /order request to include an `Idempotency-Key` header.
 *
 * Flow:
 *  1. Client sends POST with `Idempotency-Key: <uuid>`
 *  2. Interceptor checks Redis: key `idempotency:<uuid>`
 *  3a. Cache HIT  → return stored response immediately (no duplicate order created)
 *  3b. Cache MISS → let the handler run, then store the response in Redis
 *
 * This guarantees: even if the network drops and the client retries,
 * the order is only created ONCE.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly redisService: RedisService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { traceId?: string }>();
    const response = context.switchToHttp().getResponse<Response>();
    const idempotencyKey = request.headers["idempotency-key"] as
      | string
      | undefined;

    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "MISSING_IDEMPOTENCY_KEY",
        message:
          "The Idempotency-Key header is required. Generate a UUID per unique request.",
      });
    }

    const redisKey = `idempotency:${idempotencyKey}`;

    return from(this.redisService.get(redisKey)).pipe(
      switchMap((cached) => {
        if (cached) {
          this.logger.log(
            `[IDEMPOTENCY] Cache HIT — returning stored response`,
            {
              idempotencyKey,
              traceId: request.traceId,
            },
          );
          // Signal to the client that this is a replayed response
          response.setHeader("X-Idempotent-Replayed", "true");
          response.status(200);
          return of(JSON.parse(cached));
        }

        this.logger.log(`[IDEMPOTENCY] Cache MISS — processing new request`, {
          idempotencyKey,
          traceId: request.traceId,
        });

        // Let the handler execute, then cache the result
        return next.handle().pipe(
          switchMap((responseBody) =>
            from(
              this.redisService
                .set(
                  redisKey,
                  JSON.stringify(responseBody),
                  IDEMPOTENCY_TTL_SECONDS,
                )
                .then(() => {
                  this.logger.log(`[IDEMPOTENCY] Response cached`, {
                    idempotencyKey,
                    traceId: request.traceId,
                    ttl: IDEMPOTENCY_TTL_SECONDS,
                  });
                  return responseBody;
                })
                .catch((err) => {
                  // Caching failure is non-fatal — log and return the response anyway
                  this.logger.error(`[IDEMPOTENCY] Failed to cache response`, {
                    idempotencyKey,
                    error: err.message,
                  });
                  return responseBody;
                }),
            ),
          ),
        );
      }),
    );
  }
}
