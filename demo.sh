#!/usr/bin/env bash
# =============================================================================
# demo.sh — Live walkthrough of all 6 API resilience pillars
#
# Prerequisites:
#   • API running on http://localhost:3000  (npm run start:dev  OR  docker compose up)
#   • curl, jq installed
# =============================================================================

BASE_URL="http://localhost:3000/v1"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

sep() { echo -e "\n${CYAN}═══════════════════════════════════════════════════${RESET}"; }
header() { sep; echo -e "${BOLD}${YELLOW}  $1${RESET}"; sep; }
label() { echo -e "\n${GREEN}▶ $1${RESET}"; }

# ---------------------------------------------------------------------------
# PRE-DEMO: Flush entire Redis cache for a clean slate
# ---------------------------------------------------------------------------
echo -e "${CYAN}↺  Flushing Redis cache before demo...${RESET}"
docker exec order-service-redis redis-cli FLUSHALL > /dev/null 2>&1 || true
echo -e "${GREEN}✓  Redis flushed. Starting demo...${RESET}"

# ---------------------------------------------------------------------------
# 1. VERSIONING — endpoint lives at /v1/order
# ---------------------------------------------------------------------------
header "PILLAR 6 — VERSIONING   (GET wrong version)"
label "Hitting /v2/order (does not exist) → 404"
curl -s -o /dev/null -w "HTTP status: %{http_code}\n" \
  -X POST "$BASE_URL/../v2/order" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ver-test-$(date +%s)" \
  -d '{"productId":"SHOE-99","quantity":1,"customerId":"cust-1","totalAmount":99.99}'

label "Hitting /v1/order (correct) → 201"

# ---------------------------------------------------------------------------
# 2. IDEMPOTENCY — missing key, then first call, then replay
# ---------------------------------------------------------------------------
header "PILLAR 1 — IDEMPOTENCY"

IDEM_KEY="idem-$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "demo-key-12345")"
PAYLOAD='{"productId":"SHOE-42","quantity":2,"customerId":"cust-abc","totalAmount":199.99,"currency":"USD"}'

label "Call WITHOUT Idempotency-Key header → 400 MISSING_IDEMPOTENCY_KEY"
curl -s "$BASE_URL/order" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq .

label "FIRST call with key $IDEM_KEY → 201 (order created)"
curl -s "$BASE_URL/order" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -D - \
  -d "$PAYLOAD" | head -30
echo ""

label "SECOND call with SAME key → 200 (replayed, no duplicate order)"
curl -s "$BASE_URL/order" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -D - \
  -d "$PAYLOAD" | head -30
echo ""
echo -e "${YELLOW}  ↑ Notice: X-Idempotent-Replayed: true header + same orderId!${RESET}"

# ---------------------------------------------------------------------------
# 3. ERROR STANDARDIZATION — validation error
# ---------------------------------------------------------------------------
header "PILLAR 4 — ERROR STANDARDIZATION"
label "Sending invalid body (missing required fields) → 400 VALIDATION_ERROR"
curl -s "$BASE_URL/order" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: err-$(date +%s)" \
  -d '{"productId":"","quantity":-1}' | jq .

echo -e "\n${YELLOW}  ↑ Every error has: statusCode, code, message, traceId, timestamp, path${RESET}"

# ---------------------------------------------------------------------------
# 4. RATE LIMITING — trigger the 5 req/min limit
# ---------------------------------------------------------------------------
header "PILLAR 2 — RATE LIMITING   (5 requests / 60s per IP)"

# Reset rate limit counter so this section always starts clean at 0.
# Previous demo sections (versioning, idempotency, error) already consumed
# requests from the same IP. Without this reset, the 429 would fire too early.
#
# Run this manually before the demo if needed:
#   docker exec order-service-redis redis-cli --scan --pattern "rate_limit:*" | xargs docker exec -i order-service-redis redis-cli DEL
echo -e "  ${CYAN}↺  Resetting rate-limit counter for a clean demo...${RESET}"
docker exec order-service-redis redis-cli --scan --pattern "rate_limit:*" | xargs -r docker exec -i order-service-redis redis-cli DEL > /dev/null 2>&1 || true

label "Firing 7 rapid requests — expect 429 after the 5th"

for i in {1..7}; do
  KEY="rate-test-$i-$(date +%s%N)"
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/order" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $KEY" \
    -d "$PAYLOAD")

  if [ "$STATUS" = "429" ]; then
    echo -e "  Request $i → ${RED}HTTP $STATUS — RATE_LIMIT_EXCEEDED ✗${RESET}"
    # Show the full error body on first 429
    if [ "$i" -le 6 ]; then
      curl -s "$BASE_URL/order" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Idempotency-Key: rate-body-$(date +%s%N)" \
        -d "$PAYLOAD" | jq .
    fi
  else
    echo -e "  Request $i → ${GREEN}HTTP $STATUS ✓${RESET}"
  fi
done

echo -e "${YELLOW}\n  ↑ Wait ~60s for the window to reset, or restart Redis to clear counters${RESET}"

# ---------------------------------------------------------------------------
# 5. OBSERVABILITY — show logs
# ---------------------------------------------------------------------------
header "PILLAR 5 — OBSERVABILITY"

# Rate limit window from previous section may still be active — reset it
docker exec order-service-redis redis-cli --scan --pattern "rate_limit:*" | xargs -r docker exec -i order-service-redis redis-cli DEL > /dev/null 2>&1 || true

echo -e "  ${CYAN}Watch the server terminal — each request line shows:${RESET}"
echo -e "  • Timestamp • Level • Context"
echo -e "  • traceId (same across all log lines for one request)"
echo -e "  • Structured JSON meta: method, url, statusCode, durationMs"
echo ""
# label "Making a traced request (traceId flows through all log lines for one request)"
# TRACE_ID="demo-trace-$(date +%s)"
# STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
#   -X POST "$BASE_URL/order" \
#   -H "Content-Type: application/json" \
#   -H "Idempotency-Key: obs-$(date +%s)" \
#   -H "X-Trace-Id: $TRACE_ID" \
#   -d "$PAYLOAD")
# echo -e "  HTTP $STATUS — traceId: ${BOLD}$TRACE_ID${RESET}"
# echo -e "  ${CYAN}↑ Search server logs for this traceId to see all correlated log lines${RESET}"

# ---------------------------------------------------------------------------
# 6. RETRY STRATEGY — hint
# ---------------------------------------------------------------------------
header "PILLAR 3 — RETRY STRATEGY   (10% simulated failure rate)"

# Reset rate limit so 10 retry requests all go through
docker exec order-service-redis redis-cli --scan --pattern "rate_limit:*" | xargs -r docker exec -i order-service-redis redis-cli DEL > /dev/null 2>&1 || true

label "Making 10 requests — some will trigger retry + exponential backoff internally"
echo -e "  ${CYAN}Watch the server logs for '[WARN] Retrying order' lines${RESET}\n"

for i in {1..10}; do
  KEY="retry-test-$i-$(date +%s%N)"
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/order" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $KEY" \
    -d "$PAYLOAD")
  echo -e "  Request $i → HTTP $STATUS"
done

sep
echo -e "\n${BOLD}${GREEN}  Demo complete!  All 6 pillars demonstrated.${RESET}\n"
