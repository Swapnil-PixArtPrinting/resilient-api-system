import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { RedisService } from "../../redis/redis.service";

/**
 * Redis-based fixed-window rate limiter.
 *
 * Why Redis (not in-memory)?
 *  - Works across multiple API server instances (horizontal scale)
 *  - Survives server restarts
 *
 * Limit is intentionally LOW (5 req/min) so it can be triggered during a demo.
 * In production you would set this per-route via a decorator + Reflector.
 */
const RATE_LIMIT_MAX = 5; // max requests
const RATE_LIMIT_WINDOW = 60; // per 60 seconds

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { traceId?: string }>();
    const ip = request.ip || request.socket?.remoteAddress || "unknown";

    /**
     * Idempotent replays must NOT count against the rate limit.
     *
     * Why: Guards run before Interceptors in NestJS. Without this check,
     * every retry with the same Idempotency-Key would increment the counter
     * and pollute rate-limit logs — even though no real work is being done.
     * A cached replay is free; only new requests should consume quota.
     */
    const idempotencyKey = request.headers["idempotency-key"] as
      | string
      | undefined;
    if (idempotencyKey) {
      const cached = await this.redisService.get(
        `idempotency:${idempotencyKey}`,
      );
      if (cached) {
        this.logger.log(`Rate limit skipped — idempotent replay`, {
          traceId: request.traceId,
          ip,
          idempotencyKey,
        });
        return true;
      }
    }

    const key = `rate_limit:${ip}`;

    const count = await this.redisService.incr(key);

    // Set TTL only on the first hit so the window resets naturally
    if (count === 1) {
      await this.redisService.expire(key, RATE_LIMIT_WINDOW);
    }

    const ttl = await this.redisService.ttl(key);

    this.logger.log(`Rate limit check`, {
      traceId: request.traceId,
      ip,
      count,
      limit: RATE_LIMIT_MAX,
      windowSeconds: RATE_LIMIT_WINDOW,
      ttlRemaining: ttl,
    });

    if (count > RATE_LIMIT_MAX) {
      this.logger.warn(`Rate limit exceeded`, {
        traceId: request.traceId,
        ip,
        count,
        ttlRemaining: ttl,
      });
      throw new HttpException(
        {
          code: "RATE_LIMIT_EXCEEDED",
          message: `Too many requests. Limit: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW}s. Retry after ${ttl}s.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
