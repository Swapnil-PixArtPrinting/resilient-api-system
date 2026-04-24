import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { TraceInterceptor } from '../common/interceptors/trace.interceptor';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderService } from './order.service';

/**
 * Order Controller — wires all 6 pillars together on a single endpoint.
 *
 * Request lifecycle:
 *   TraceInterceptor    → assigns traceId (Observability)
 *   RateLimitGuard      → Redis counter check (Rate Limiting)
 *   IdempotencyInterceptor → Redis idempotency key check (Idempotency)
 *   ValidationPipe      → DTO validation (implicit, set in main.ts)
 *   createOrder()       → business logic with retry + circuit breaker (Retry Strategy)
 *   HttpExceptionFilter → standardises all error shapes (Error Standardization)
 */
@Controller({ path: 'order', version: '1' })
@UseInterceptors(TraceInterceptor)
@UseGuards(RateLimitGuard)
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(private readonly orderService: OrderService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  async createOrder(
    @Body() createOrderDto: CreateOrderDto,
    @Req() request: Request & { traceId: string },
  ) {
    const { traceId } = request;

    this.logger.log(`Create order request`, {
      traceId,
      customerId: createOrderDto.customerId,
      productId: createOrderDto.productId,
    });

    return this.orderService.createOrder(createOrderDto, traceId);
  }
}
