import { Module } from "@nestjs/common";
import { IdempotencyInterceptor } from "../common/interceptors/idempotency.interceptor";
import { TraceInterceptor } from "../common/interceptors/trace.interceptor";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { OrderController } from "./order.controller";
import { OrderService } from "./order.service";

@Module({
  controllers: [OrderController],
  providers: [
    OrderService,
    RateLimitGuard,
    IdempotencyInterceptor,
    TraceInterceptor,
  ],
})
export class OrderModule {}
