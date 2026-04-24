import { Logger } from "@nestjs/common";

const logger = new Logger("RetryUtil");

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Retries an async operation with exponential backoff + jitter.
 *
 * Strategy:
 *   delay = min(baseDelay * 2^attempt + random_jitter, maxDelay)
 *
 * This prevents the "thundering herd" problem where all retrying clients
 * hit the server at the same time after a failure.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 100,
    maxDelayMs = 5000,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        logger.error(`All ${maxRetries + 1} attempts exhausted`, {
          error: lastError.message,
        });
        throw lastError;
      }

      // Exponential backoff with full jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      logger.warn(
        `Attempt ${attempt + 1}/${maxRetries + 1} failed — retrying in ${Math.round(delay)}ms`,
        {
          error: lastError.message,
          nextAttempt: attempt + 2,
        },
      );

      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      await sleep(delay);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export enum CircuitState {
  CLOSED = "CLOSED", // Normal operation — requests flow through
  OPEN = "OPEN", // Failure threshold exceeded — fast-fail all requests
  HALF_OPEN = "HALF_OPEN", // Recovery probe — let one request through to test
}

/**
 * A simple in-memory circuit breaker.
 *
 * CLOSED → (failures >= threshold) → OPEN → (recovery timeout elapsed) → HALF_OPEN
 *   HALF_OPEN + success → CLOSED
 *   HALF_OPEN + failure → OPEN
 */
export class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly cbLogger = new Logger(`CircuitBreaker:${this.name}`);

  constructor(
    private readonly name: string,
    private readonly failureThreshold = 5,
    private readonly recoveryTimeMs = 30_000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed > this.recoveryTimeMs) {
        this.cbLogger.log(
          `State → HALF_OPEN (probing recovery after ${elapsed}ms)`,
        );
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new Error(
          `Circuit [${this.name}] is OPEN. Fast-failing. Retry in ${Math.ceil((this.recoveryTimeMs - elapsed) / 1000)}s.`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.cbLogger.log(`State → CLOSED (service recovered)`);
    }
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.failureCount >= this.failureThreshold ||
      this.state === CircuitState.HALF_OPEN
    ) {
      this.state = CircuitState.OPEN;
      this.cbLogger.warn(
        `State → OPEN after ${this.failureCount} failure(s). Blocking traffic for ${this.recoveryTimeMs / 1000}s.`,
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
    };
  }
}
