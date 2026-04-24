# Resilient API System — Order Service

A **production-ready NestJS demo** showcasing the **6 pillars of resilient API design** on a single `POST /v1/order` endpoint.

```
POST /v1/order
  │
  ├── TraceInterceptor      → assigns traceId              [Observability]
  ├── RateLimitGuard        → Redis counter (5 req/60s)    [Rate Limiting]
  ├── IdempotencyInterceptor→ Redis key dedup              [Idempotency]
  ├── ValidationPipe        → DTO validation
  ├── OrderService          → retry + circuit breaker      [Retry Strategy]
  └── HttpExceptionFilter   → standard error shape         [Error Standardization]
       @Version('1') → /v1/order                          [Versioning]
```

---

## Quick Start

### Option A — Docker Compose (recommended)

```bash
docker compose up --build
```

API will be available at `http://localhost:3000`.

### Option B — Local (requires a running Redis)

```bash
# 1. Install dependencies
npm install

# 2. Start Redis (if not running)
docker run -d -p 6379:6379 redis:7-alpine

# 3. Start the API in watch mode
npm run start:dev
```

---

## API Reference

### `POST /v1/order`

**Required header:** `Idempotency-Key: <uuid>`

**Request body:**

```json
{
  "productId": "SHOE-42",
  "quantity": 2,
  "customerId": "cust-abc",
  "totalAmount": 199.99,
  "currency": "USD"
}
```

**Success response (201):**

```json
{
  "orderId": "ORD-1714000000000-A3F9B",
  "status": "CONFIRMED",
  "productId": "SHOE-42",
  "quantity": 2,
  "customerId": "cust-abc",
  "totalAmount": 199.99,
  "currency": "USD",
  "createdAt": "2026-04-24T10:00:00.000Z",
  "traceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**Error response (any error):**

```json
{
  "statusCode": 429,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Limit: 5 requests per 60s. Retry after 42s.",
  "traceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "timestamp": "2026-04-24T10:00:00.000Z",
  "path": "/v1/order"
}
```

---

## Live Demo Script

```bash
chmod +x demo.sh
./demo.sh
```

The script walks through all 6 pillars in sequence with annotated curl commands.

---

## The 6 Pillars — Implementation Map

| Pillar                    | Where in code                          | Key file                            |
| ------------------------- | -------------------------------------- | ----------------------------------- |
| **Versioning**            | `@Version('1')` + `VersioningType.URI` | `order.controller.ts`, `main.ts`    |
| **Idempotency**           | Redis key check before handler runs    | `idempotency.interceptor.ts`        |
| **Rate Limiting**         | Redis counter per IP, 5 req/60s        | `rate-limit.guard.ts`               |
| **Retry Strategy**        | Exponential backoff + circuit breaker  | `retry.util.ts`, `order.service.ts` |
| **Error Standardization** | Global `@Catch()` filter               | `http-exception.filter.ts`          |
| **Observability**         | Winston structured JSON + traceId      | `trace.interceptor.ts`, `main.ts`   |

---

## Project Structure

```
src/
├── main.ts                              # Bootstrap: logger, versioning, pipes, filter
├── app.module.ts
├── redis/
│   ├── redis.module.ts                  # @Global() — available everywhere
│   └── redis.service.ts                 # Thin wrapper around ioredis
├── common/
│   ├── filters/
│   │   └── http-exception.filter.ts     # Error Standardization
│   ├── guards/
│   │   └── rate-limit.guard.ts          # Rate Limiting
│   ├── interceptors/
│   │   ├── trace.interceptor.ts         # Observability (traceId)
│   │   └── idempotency.interceptor.ts   # Idempotency
│   └── utils/
│       ├── trace.util.ts                # generateTraceId()
│       └── retry.util.ts                # retryWithBackoff() + CircuitBreaker
└── order/
    ├── order.module.ts
    ├── order.controller.ts              # Versioning (@Version('1'))
    ├── order.service.ts                 # Business logic + retry
    └── dto/
        └── create-order.dto.ts
```

---

## Environment Variables

| Variable     | Default     | Description    |
| ------------ | ----------- | -------------- |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379`      | Redis port     |
| `PORT`       | `3000`      | HTTP port      |

Copy `.env.example` → `.env` for local development.

---

## Demo Scenarios

### Pillar 1 — Idempotency

```bash
# First call — creates the order
curl -X POST http://localhost:3000/v1/order \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-unique-key-001" \
  -d '{"productId":"SHOE-42","quantity":1,"customerId":"cust-1","totalAmount":99}'

# Same key again — returns SAME response, no duplicate order
curl -X POST http://localhost:3000/v1/order \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-unique-key-001" \
  -d '{"productId":"SHOE-42","quantity":1,"customerId":"cust-1","totalAmount":99}'
# → HTTP 200  X-Idempotent-Replayed: true
```

### Pillar 2 — Rate Limiting

```bash
# Run 6 times quickly — 6th request returns 429
for i in {1..6}; do
  curl -s -o /dev/null -w "Request $i: HTTP %{http_code}\n" \
    -X POST http://localhost:3000/v1/order \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: rl-test-$i" \
    -d '{"productId":"X","quantity":1,"customerId":"c","totalAmount":10}'
done
```

### Pillar 3 — Retry Strategy

Watch the server logs while sending requests. The payment service has a 10% failure rate. You'll see `[WARN] Retrying order (attempt N)` lines, and the request will ultimately succeed.

### Pillar 4 — Error Standardization

```bash
# Missing required fields → structured 400
curl -X POST http://localhost:3000/v1/order \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: err-test" \
  -d '{"productId":""}'
```

### Pillar 5 — Observability

Supply your own trace ID and grep the server logs:

```bash
curl -X POST http://localhost:3000/v1/order \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: obs-test" \
  -H "X-Trace-Id: my-custom-trace-id" \
  -d '{"productId":"SHOE-42","quantity":1,"customerId":"cust-1","totalAmount":99}'
# Search server logs for: my-custom-trace-id
```

### Pillar 6 — Versioning

```bash
# v1 works
curl -X POST http://localhost:3000/v1/order ...

# v2 doesn't exist yet → 404
curl -X POST http://localhost:3000/v2/order ...
```
