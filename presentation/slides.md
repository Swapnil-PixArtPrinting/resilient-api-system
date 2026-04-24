---
marp: true
theme: default
paginate: true
size: 16:9
style: |
  :root {
    --color-bg: #ffffff;
    --color-surface: #f1f5f9;
    --color-primary: #1e40af;
    --color-accent: #7c3aed;
    --color-success: #16a34a;
    --color-warn: #b45309;
    --color-danger: #dc2626;
    --color-text: #1e293b;
    --color-muted: #64748b;
  }

  section {
    background: var(--color-bg);
    color: var(--color-text);
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-size: 1.05rem;
    padding: 48px 64px;
  }

  h1 { color: var(--color-primary); font-size: 2.6rem; font-weight: 800; letter-spacing: -1px; }
  h2 { color: var(--color-primary); font-size: 1.9rem; font-weight: 700; border-bottom: 3px solid #dbeafe; padding-bottom: 8px; margin-bottom: 16px; }
  h3 { color: var(--color-accent); font-size: 1.25rem; font-weight: 600; }

  strong { color: var(--color-warn); }
  em { color: var(--color-primary); font-style: normal; font-weight: 600; }

  code {
    background: #dbeafe;
    color: #1e3a8a;
    padding: 2px 7px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.88em;
    font-weight: 500;
  }

  blockquote {
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
    border-radius: 0 8px 8px 0;
    padding: 16px 20px;
    color: #1e293b;
    margin: 16px 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    table-layout: fixed;
    display: table;
  }

  th {
    background: #1e40af;
    color: #ffffff;
    padding: 10px 16px;
    text-align: left;
    font-weight: 600;
  }

  td {
    border-bottom: 1px solid #e2e8f0;
    padding: 9px 16px;
    color: #1e293b;
    vertical-align: top;
  }

  tr:nth-child(even) td { background: #f8fafc; }

  ul, ol { line-height: 1.9; }

  section.lead {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    background: linear-gradient(135deg, #eff6ff 0%, #f5f3ff 100%);
  }

  section.lead h1 { font-size: 3.2rem; color: #1e40af; }
  section.lead p  { font-size: 1.2rem; color: #475569; }

  footer {
    color: #94a3b8;
    font-size: 0.75rem;
  }
---

<!-- _class: lead -->
<!-- _paginate: false -->

# 6 Pillars of Production-Ready APIs

**Building APIs that work — at scale, under failure, forever**

## Presenter

**Swapnil Bhamat** · OCS Team

---

<!-- Suggested visual: animated hexagon with 6 labelled segments, one per pillar -->

## What We're Covering Today

> "Any engineer can build an API that works in a demo.
> Production-ready means it still works at 3am, under load, when everything else is broken."

**The 6 Pillars:**

| #   | Pillar                    | In one line                                |
| --- | ------------------------- | ------------------------------------------ |
| 1   | **Idempotency**           | Same request, same result — always         |
| 2   | **Rate Limiting**         | Shield your system from abuse and overload |
| 3   | **Retry Strategy**        | Fail gracefully, recover automatically     |
| 4   | **Error Standardization** | Every error speaks the same language       |
| 5   | **Observability**         | Know what's happening, even in the dark    |
| 6   | **Versioning**            | Evolve without breaking your clients       |

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Pillar 1

# Idempotency

---

## Idempotency — **WHY**

<!-- Suggested visual: split diagram showing "without idempotency" (2 orders created) vs "with idempotency" (1 order created) -->

### The Real-World Story 💸

> **Shopify, 2017:** A network blip during checkout caused the payment SDK to retry.
> The server had no idempotency — the customer was charged **twice**.
> The refund team processed **thousands of duplicates** before the bug was caught.

**This happens because:**

- Networks are unreliable — packets get lost
- Clients don't know if a request succeeded or timed out
- The safest thing a client can do is **retry** — but your server must be ready

**The rule:** If a client calls your `POST /order` twice with the same intent,
the result must be the same as if it was called once.

---

## Idempotency — **WHAT**

<!-- Suggested visual: HTTP methods table showing which are naturally idempotent -->

**Natural HTTP idempotency:**

| Method     | Idempotent by design? | Notes                                        |
| ---------- | --------------------- | -------------------------------------------- |
| `GET`      | ✅ Yes                | Read-only, always safe                       |
| `PUT`      | ✅ Yes                | "Set this resource to X"                     |
| `DELETE`   | ✅ Yes                | Deleting what's already gone is still OK     |
| **`POST`** | ❌ **No**             | Creates new things — needs explicit handling |

**The pattern:**

1. Client generates a **UUID** per unique business intent
2. Client sends it as `Idempotency-Key: <uuid>` header
3. Server checks **Redis** — if key exists, return cached response
4. If key is new, process normally, cache the result

> The key is tied to **intent**, not the request body. Same key = same outcome.

---

## Idempotency — **HOW**

<!-- Suggested visual: sequence diagram: Client → Server → Redis → Payment Gateway -->

```
Client                   Server                       Redis
  │                        │                             │
  ├──POST /order ──────────►│                             │
  │  Idempotency-Key: K1    ├──GET idempotency:K1 ───────►│
  │                         │◄── (nil) ──────────────────┤
  │                         ├── process order ──────────►│
  │                         │◄── order confirmed ────────┤
  │                         ├──SET idempotency:K1 ───────►│ (TTL 24h)
  │◄── 201 order created ───┤                             │
  │                         │                             │
  ├──POST /order ──────────►│  (network retry / user double-click)
  │  Idempotency-Key: K1    ├──GET idempotency:K1 ───────►│
  │                         │◄── {cached order} ─────────┤
  │◄── 200 X-Idempotent-Replayed: true ─────────────────┤
```

**Key implementation decisions:**

- TTL of 24h covers all realistic retry windows
- Return the **exact same response** (not just 200 OK)
- `X-Idempotent-Replayed: true` header signals to clients it was a replay

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Pillar 2

# Rate Limiting

---

## Rate Limiting — **WHY**

<!-- Suggested visual: graph showing API traffic — normal baseline vs sudden spike from one IP -->

### The Real-World Story ⚡

> **Twitter API, 2022:** After removing rate limits on certain endpoints during a platform transition,
> a single poorly-coded scraper bot made **5 million requests in 10 minutes**.
> It consumed enough CPU to cause latency spikes **for all paying customers**.

**Why systems get overwhelmed without rate limits:**

- A single misconfigured client can create an infinite retry loop
- Malicious actors run credential stuffing attacks (thousands of logins/sec)
- Viral traffic spikes ("hug of death") — your own users can break your service
- A slow upstream service causes clients to pile up retries

**Your API is a shared resource. Rate limiting is how you protect all users fairly.**

---

## Rate Limiting — **WHAT**

<!-- Suggested visual: three clocks showing different algorithm windows -->

**Three common algorithms:**

| Algorithm          | How it works                              | Best for                   |
| ------------------ | ----------------------------------------- | -------------------------- |
| **Fixed Window**   | Count resets every N seconds on the clock | Simple, predictable        |
| **Sliding Window** | Count tracks the rolling last N seconds   | Fairer, no boundary bursts |
| **Token Bucket**   | Tokens refill at a rate, burst up to max  | Allows short bursts        |

**Why Redis (not in-memory)?**

- In-memory counters don't work with multiple server instances
- Redis `INCR` + `EXPIRE` is **atomic** and works across your entire fleet
- Survives server restarts

**Key decisions:**

- Limit per **IP** for public APIs, per **API key** for authenticated APIs
- Return `HTTP 429` with a **`Retry-After`** header
- Log every rate limit hit — it's a signal of abuse or misconfigured clients

---

## Rate Limiting — **HOW**

<!-- Suggested visual: Redis key counter incrementing, TTL countdown -->

**Fixed-window implementation (Redis):**

```
Request arrives from IP: 192.168.1.1
  │
  ├── INCR rate_limit:192.168.1.1          → counter = 3
  │   (if counter == 1: EXPIRE key 60)     → set TTL on first hit
  │
  ├── counter (3) <= limit (5)?
  │     YES → allow request  ✅
  │     NO  → throw 429 ✗
  │
Redis key: rate_limit:192.168.1.1
  value: 3
  TTL:   42 seconds remaining
```

**Response headers for rate-limited requests:**

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
Retry-After: 42
```

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Pillar 3

# Retry Strategy

---

## Retry Strategy — **WHY**

<!-- Suggested visual: domino effect diagram — one failing service causing cascading failures -->

### The Real-World Story 🌊

> **AWS us-east-1, 2021:** A networking issue caused increased latency in one availability zone.
> Services that called the affected endpoints had **no retry logic** — they failed immediately.
> Services that had **naive retries** (no backoff) amplified the problem — they created a
> **thundering herd** that made the outage 10x worse.
> Services with **exponential backoff + jitter** gracefully rode out the storm.

**The fundamental truth:** Distributed systems fail. Networks drop packets. Services crash.
Your code **will** call a service that is momentarily unavailable. The question is:
_what does your code do next?_

**Two failure modes to avoid:**

1. **No retry** → a 50ms blip kills your success rate
2. **Naive retry** → all clients retry at the same time, creating a surge that destroys the struggling service

---

## Retry Strategy — **WHAT**

<!-- Suggested visual: graph showing 3 approaches: no retry (flat line at 50%), naive retry (spike), exponential backoff (smooth recovery) -->

**Exponential Backoff + Jitter** is the industry standard:

```
Attempt 1: immediate
Attempt 2: wait ~200ms  (100ms base × 2¹ + random jitter)
Attempt 3: wait ~500ms  (100ms base × 2² + random jitter)
Attempt 4: wait ~1200ms (100ms base × 2³ + random jitter)
```

**Jitter** = add randomness to the delay so all clients don't retry simultaneously.

**Circuit Breaker** — stop retrying when a service is clearly down:

```
CLOSED  ──(5 failures)──►  OPEN  ──(30s timeout)──►  HALF-OPEN
  ▲                           │                           │
  └───────(success)───────────┘◄──────(1 probe passes)────┘
```

- **CLOSED:** Normal operation, requests flow through
- **OPEN:** Fast-fail all requests — don't waste threads waiting for a dead service
- **HALF-OPEN:** Let one request through to test if the service has recovered

---

## Retry Strategy — **HOW**

<!-- Suggested visual: flowchart from attempt 1 → success/fail → backoff → attempt 2 ... → circuit opens -->

**When to retry vs. when NOT to:**

| Error                       | Retry?                     | Why                                         |
| --------------------------- | -------------------------- | ------------------------------------------- |
| `500 Internal Server Error` | ✅ Yes                     | Likely transient                            |
| `503 Service Unavailable`   | ✅ Yes                     | Overloaded, will recover                    |
| `429 Too Many Requests`     | ✅ Yes (after Retry-After) | Back off and try later                      |
| `400 Bad Request`           | ❌ No                      | Your request is wrong — retrying won't help |
| `401 Unauthorized`          | ❌ No                      | Fix your credentials first                  |
| `404 Not Found`             | ❌ No                      | The resource doesn't exist                  |

**What to always include in retry logic:**

- Maximum retry count (don't retry forever)
- Exponential backoff with jitter
- Circuit breaker to protect struggling dependencies
- Observability: log every retry attempt with `traceId`

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Pillar 4

# Error Standardization

---

## Error Standardization — **WHY**

<!-- Suggested visual: three different error response formats side by side (chaos), then one unified format (order) -->

### The Real-World Story 🔥

> A senior engineer at a large bank was debugging a P1 incident at 2am.
> The payment service returned `{ "err": "DB_CONN" }`.
> The auth service returned `{ "error": { "type": "unauthorized" } }`.
> The notification service returned `"Internal Server Error"` as plain text.
>
> It took **6 hours** to correlate logs and find the root cause.
> A standardized error format with a `traceId` would have cut that to **15 minutes**.

**The hidden cost of inconsistent errors:**

- Frontend developers write `if (err.message || err.error || err.err || ...)` — fragile
- Mobile apps can't parse errors reliably across services
- Support engineers can't search logs without a common identifier
- Incident response is slower — more time reading, less time fixing

---

## Error Standardization — **WHAT**

<!-- Suggested visual: annotated JSON showing each field and its purpose -->

**Every error response — regardless of source — shares this exact shape:**

| Field        | Example value                          | Purpose                                            |
| ------------ | -------------------------------------- | -------------------------------------------------- |
| `statusCode` | `429`                                  | HTTP status for gateways and load balancers        |
| `code`       | `RATE_LIMIT_EXCEEDED`                  | Machine-readable string — clients `switch` on this |
| `message`    | `Too many requests. Retry after 42s.`  | Human-readable — for developers and support        |
| `traceId`    | `f47ac10b-58cc-4372-a567-0e02b2c3d479` | Correlates this error with all server logs         |
| `timestamp`  | `2026-04-24T10:00:00.000Z`             | When it happened (timezone-safe ISO 8601)          |
| `path`       | `/v1/order`                            | Which endpoint — useful in multi-service logs      |

---

## Error Standardization — **HOW**

<!-- Suggested visual: funnel diagram — all error types funnel into the global exception filter -->

**One global filter catches everything:**

```
ValidationError   ──┐
RateLimitError    ──┤
DatabaseError     ──┼──► HttpExceptionFilter ──► Standard JSON error
UnhandledError    ──┤
BusinessRuleError ──┘
```

**Best practices:**

- Define a **code enum** — prevents typos, enables autocomplete
- Avoid leaking implementation details (`NullPointerException`, SQL queries)
- Log the **full** error internally (with stack trace) but return a clean message externally
- `traceId` must be set **before** the filter runs (TraceInterceptor sets it)
- Validation errors from `class-validator` must also go through the same filter

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Pillar 5

# Observability

---

## Observability — **WHY**

<!-- Suggested visual: Venn diagram of the 3 pillars of observability: Logs, Metrics, Traces -->

### The Real-World Story 🔍

> **Netflix, internal post-mortem:** During a streaming outage, engineers found that
> their microservices logged different formats. Some used plain text.
> Some used JSON but with inconsistent field names (`userId` vs `user_id` vs `uid`).
> They **couldn't query logs across services** to trace a single user's request.
>
> They invested in standardised structured logging + distributed tracing.
> Mean time to detect (MTTD) dropped from **47 minutes to 4 minutes**.

**"Works on my machine" is not a production strategy.**

You cannot SSH into a production pod during an incident.
Logs are your eyes. If they're unreadable, you're flying blind.

**The three pillars of observability:**

- **Logs** — what happened (structured JSON, searchable)
- **Metrics** — how much / how fast (Prometheus, CloudWatch)
- **Traces** — the journey of a single request across services

---

## Observability — **WHAT**

<!-- Suggested visual: sample log output with JSON fields highlighted and labelled -->

**Structured logging = logs as data, not prose**

|                        | Format                                                                                      | Queryable?                        |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| ❌ **Unstructured**    | `[2026-04-24 10:00:01] Order processing failed for customer abc123`                         | No — grep only                    |
| ✅ **Structured JSON** | `{ "traceId": "f47ac10b", "customerId": "cust-abc", "durationMs": 5043, "level": "error" }` | Yes — Datadog, Splunk, CloudWatch |

**With structured logs you can query:** `logs WHERE traceId = 'f47ac10b-...'`
and see **every log line** across **every service** for that single request.

---

## Observability — **HOW**

<!-- Suggested visual: request lifecycle diagram with traceId propagating through all layers -->

**The TraceId is the thread that connects everything:**

```
Client ──► API Gateway ──► Order Service ──► Payment Service ──► Database
             Add X-Trace-Id   Attach to req    Propagate header    Include in query

All logs from this single checkout flow share: traceId = "f47ac10b-..."
```

**In production:**

- Use **OpenTelemetry** for standardised trace propagation (W3C `traceparent` header)
- Ship logs to **Datadog / Splunk / CloudWatch Logs Insights**
- Set up dashboards for: p99 latency, error rate, retry rate, circuit breaker state
- Alert on: error rate > 1%, p99 latency > 500ms, circuit breaker OPEN

**In this demo (Winston):**

- Every log line is JSON with `traceId`, `context`, `method`, `url`, `durationMs`
- Client can supply `X-Trace-Id` to correlate their own logs with server logs

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Pillar 6

# Versioning

---

## Versioning — **WHY**

<!-- Suggested visual: branching timeline showing v1 clients still working while v2 is deployed -->

### The Real-World Story 📱

> **Stripe, forever:** Stripe has clients running v1 of their API from **2011** — still working today.
> Every new feature ships on a new version. Old versions never break.
> This is why developers trust Stripe so deeply. It's a **competitive advantage**.
>
> **Contrast:** A startup changed the shape of their `/user` response without versioning.
> Their iOS app — which the team didn't control (App Store review takes 5 days) —
> **broke for 200,000 users** the moment the deploy went out.

**The laws of distributed systems:**

1. You don't control when clients upgrade
2. Mobile apps, third-party integrators, and partners **cannot** be force-updated
3. A breaking change without versioning = a production incident

**Versioning is a promise to your clients: "I will not break you."**

---

## Versioning — **WHAT**

<!-- Suggested visual: four cards showing the four versioning strategies with pros/cons -->

**Four common strategies:**

| Strategy        | Example                               | Pros                                         | Cons                        |
| --------------- | ------------------------------------- | -------------------------------------------- | --------------------------- |
| **URI**         | `/v1/order`                           | Obvious, cacheable, easily tested in browser | Pollutes URL                |
| **Header**      | `API-Version: 1`                      | Clean URLs                                   | Harder to test, invisible   |
| **Query param** | `/order?v=1`                          | Easy to test                                 | Pollutes URLs, cache issues |
| **Media type**  | `Accept: application/vnd.api.v1+json` | REST purist                                  | Complex to implement        |

**NestJS supports all four** with `app.enableVersioning()`.

**When is something a "breaking change"?**

- Removing a field from a response ← breaking
- Renaming a field ← breaking
- Changing a field's type (string → number) ← breaking
- Adding a **required** request field ← breaking
- Adding an **optional** response field ← ✅ safe (non-breaking)
- Adding a new endpoint ← ✅ safe

---

## Versioning — **HOW**

<!-- Suggested visual: URL routing diagram showing /v1/order and /v2/order going to different handlers -->

**Migration strategy:**

```
Phase 1: Deploy v2 alongside v1 (both serve traffic)
Phase 2: Notify clients — give 6–12 months deprecation window
Phase 3: Log usage of v1 to track who hasn't migrated
Phase 4: Sunset v1 only when traffic drops to zero
```

**Deprecation signals:**

- `Deprecation: true` response header on v1 responses
- `Sunset: Sat, 01 Jan 2027 00:00:00 GMT` header (RFC 8594)
- Dashboard showing v1 vs v2 traffic split over time

**Team process:**

- Treat API contracts like database schemas — you can add, rarely rename, never delete without a version bump
- Document the **diff** between versions in your API changelog
- Semantic versioning for the overall API, date-based for specific resources

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Putting It All Together

---

## The Complete Request Journey

<!-- Suggested visual: vertical flowchart / swim lane diagram with all 6 pillars labelled -->

```
POST /v1/order
  │
  │  ① VERSIONING ─────────────────────────── /v1/ prefix routes to v1 controller
  │
  │  ② OBSERVABILITY ──────────────────────── TraceInterceptor assigns traceId
  │                                            attaches to request + response header
  │
  │  ③ RATE LIMITING ──────────────────────── RateLimitGuard: Redis INCR
  │                                            count > 5?  → 429 (standard error body)
  │
  │  ④ IDEMPOTENCY ─────────────────────────── IdempotencyInterceptor: Redis GET
  │                                            key exists? → 200 cached response
  │                                            key new?    → continue ↓
  │
  │  ⑤ VALIDATION ─────────────────────────── ValidationPipe checks DTO
  │                                            invalid?    → 400 (standard error body)
  │
  │  ⑥ RETRY STRATEGY ──────────────────────── OrderService calls payment gateway
  │                                            failure?    → exponential backoff
  │                                            3 failures? → circuit breaker OPENS
  │
  │  ④ IDEMPOTENCY ─────────────────────────── Cache the response in Redis (24h TTL)
  │
  └──► 201 { orderId, status, traceId, ... }
       ↑ ALL errors caught by HttpExceptionFilter → standard error shape
```

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Questions?

**Demo repo:** [resilient-api-system](https://github.com/Swapnil-PixArtPrinting/resilient-api-system)

_Every pillar shown has a direct file reference in the codebase._
_Start with the README → then trace a single request through the code._
