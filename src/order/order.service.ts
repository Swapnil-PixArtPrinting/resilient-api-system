import { Injectable, Logger } from "@nestjs/common";
import { CircuitBreaker, retryWithBackoff } from "../common/utils/retry.util";
import { CreateOrderDto } from "./dto/create-order.dto";

export interface Order {
  orderId: string;
  status: "CONFIRMED" | "FAILED";
  productId: string;
  quantity: number;
  customerId: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  traceId: string;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  /**
   * Circuit breaker wraps the downstream payment service.
   * After 3 consecutive failures it opens the circuit for 15s,
   * fast-failing all requests instead of hammering a struggling service.
   */
  private readonly paymentCircuitBreaker = new CircuitBreaker(
    "PaymentService",
    3,
    15_000,
  );

  async createOrder(dto: CreateOrderDto, traceId: string): Promise<Order> {
    this.logger.log(`Processing order`, {
      traceId,
      customerId: dto.customerId,
      productId: dto.productId,
      amount: dto.totalAmount,
      currency: dto.currency ?? "USD",
    });

    /**
     * Retry Strategy: wrap the core logic in retryWithBackoff.
     * Transient failures (network blip, timeout) will be retried up to 3 times
     * using exponential backoff with jitter to avoid thundering-herd storms.
     */
    const order = await retryWithBackoff(
      () => this.processOrder(dto, traceId),
      {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 2000,
        onRetry: (attempt, error) => {
          this.logger.warn(`Retrying order (attempt ${attempt})`, {
            traceId,
            error: error.message,
          });
        },
      },
    );

    return order;
  }

  private async processOrder(
    dto: CreateOrderDto,
    traceId: string,
  ): Promise<Order> {
    // Call the (simulated) payment service through the circuit breaker
    await this.paymentCircuitBreaker.execute(() =>
      this.simulatePaymentService(dto.totalAmount, traceId),
    );

    const order: Order = {
      orderId: `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      status: "CONFIRMED",
      productId: dto.productId,
      quantity: dto.quantity,
      customerId: dto.customerId,
      totalAmount: dto.totalAmount,
      currency: dto.currency ?? "USD",
      createdAt: new Date().toISOString(),
      traceId,
    };

    this.logger.log(`Order confirmed`, {
      traceId,
      orderId: order.orderId,
      customerId: dto.customerId,
      amount: dto.totalAmount,
    });

    return order;
  }

  /**
   * Simulates a downstream payment provider.
   * Has a 10% chance of throwing a transient error — showing the retry logic in action.
   * Increase FAILURE_RATE to make retries more visible during a demo.
   */
  private async simulatePaymentService(
    amount: number,
    traceId: string,
  ): Promise<void> {
    const FAILURE_RATE = 0.1; // 10% transient failure rate

    if (Math.random() < FAILURE_RATE) {
      throw new Error(
        "Payment gateway timeout — transient failure (simulated)",
      );
    }

    // Simulate network latency
    await new Promise((resolve) =>
      setTimeout(resolve, 40 + Math.random() * 60),
    );

    this.logger.log(`Payment gateway accepted charge`, {
      traceId,
      amount,
    });
  }
}
