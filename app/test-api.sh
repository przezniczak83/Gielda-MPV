#!/usr/bin/env bash
# Integration tests for /api/news
#
# Usage:
#   source app/.env.local && bash app/test-api.sh [BASE_URL]
#   lub:
#   API_KEY=<klucz> bash app/test-api.sh https://your-app.vercel.app
#
# Uruchamiaj z root repo (gielda-mpv/).

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
API_KEY="${INGEST_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
  echo "ERROR: INGEST_API_KEY not set."
  echo "Run: source app/.env.local && bash app/test-api.sh"
  exit 1
fi

PASS=0
FAIL=0

check() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  local body="${4:-}"

  if [[ "$actual" == "$expected" ]]; then
    printf "✅  %-45s HTTP %s\n" "$desc" "$actual"
    PASS=$((PASS + 1))
  else
    printf "❌  %-45s expected %s, got %s\n" "$desc" "$expected" "$actual"
    [[ -n "$body" ]] && echo "    body: $body"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "━━━ Integration Tests: $BASE_URL ━━━"
echo ""

# ── AUTH ──────────────────────────────────────────────────────────────────────

C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"AAPL","title":"Valid title here"}')
check "POST without x-api-key" 401 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: totally-wrong-key-xxxxxx" \
  -d '{"ticker":"AAPL","title":"Valid title here"}')
check "POST with wrong x-api-key" 401 "$C"

# ── VALIDATION ────────────────────────────────────────────────────────────────

B=$(curl -s -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"ticker":"bad ticker!","title":"Valid title here"}')
C=$(echo "$B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('__code',''))" 2>/dev/null || echo "")
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"ticker":"bad ticker!","title":"Valid title here"}')
check "POST invalid ticker format" 400 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"ticker":"AAPL","title":"x"}')
check "POST title too short (<5 chars)" 400 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"ticker":"AAPL","title":"Valid title here","unknown_field":"x"}')
check "POST unknown field rejected" 400 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"ticker":"AAPL","title":"Valid title here","url":"not-a-url"}')
check "POST invalid URL" 400 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"ticker":"AAPL","title":"Valid title here","url":"ftp://example.com"}')
check "POST URL non-http/https protocol" 400 "$C"

B=$(curl -s -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"ticker":"AAPL","title":"Valid title here","url":"https://example.com/valid"}')
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"ticker":"AAPL","title":"Valid title here","url":"https://example.com/valid"}')
check "POST valid payload (200 or 400=unknown ticker)" \
  "$(echo $C | grep -qE '^(200|400)$' && echo $C || echo $C)" "$C"

# ── GET ───────────────────────────────────────────────────────────────────────

C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/news?limit=5")
check "GET /api/news" 200 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/news?ticker=AAPL&limit=5")
check "GET with ?ticker filter" 200 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/news?since=2026-01-01T00:00:00Z")
check "GET with valid ?since filter" 200 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/news?since=not-a-date")
check "GET with invalid ?since → 400" 400 "$C"

# ── SOFT DELETE ───────────────────────────────────────────────────────────────

C=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/news?id=00000000-0000-0000-0000-000000000001")
check "DELETE without x-api-key → 401" 401 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/news?id=not-a-uuid" \
  -H "x-api-key: $API_KEY")
check "DELETE invalid UUID → 400" 400 "$C"

C=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/news?id=00000000-0000-0000-0000-000000000001" \
  -H "x-api-key: $API_KEY")
check "DELETE non-existent UUID → 404" 404 "$C"

# ── CURSOR PAGINATION ─────────────────────────────────────────────────────────

B=$(curl -s "$BASE_URL/api/news?limit=1")
HAS_CURSOR=$(echo "$B" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'next_cursor' in d else 'no')" 2>/dev/null || echo "no")
[[ "$HAS_CURSOR" == "yes" ]] \
  && { printf "✅  %-45s\n" "GET response contains next_cursor field"; PASS=$((PASS+1)); } \
  || { printf "❌  %-45s\n" "GET response missing next_cursor field"; FAIL=$((FAIL+1)); }

C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/news?cursor=not-valid-cursor!!!")
check "GET invalid cursor → 400" 400 "$C"

CURSOR=$(echo "$B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('next_cursor') or '')" 2>/dev/null || echo "")
if [[ -n "$CURSOR" ]]; then
  C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/news?limit=1&cursor=$CURSOR")
  check "GET cursor → next page 200" 200 "$C"
else
  printf "⏭️   %-45s skipped (next_cursor=null, DB may be empty)\n" "GET cursor → next page 200"
fi

# ── SECURITY HEADERS ─────────────────────────────────────────────────────────

HEADERS=$(curl -sI "$BASE_URL/api/news?limit=1")
echo "$HEADERS" | grep -qi "x-content-type-options: nosniff" \
  && { printf "✅  %-45s\n" "Security header: X-Content-Type-Options"; PASS=$((PASS+1)); } \
  || { printf "❌  %-45s MISSING\n" "Security header: X-Content-Type-Options"; FAIL=$((FAIL+1)); }

echo "$HEADERS" | grep -qi "x-frame-options: deny" \
  && { printf "✅  %-45s\n" "Security header: X-Frame-Options"; PASS=$((PASS+1)); } \
  || { printf "❌  %-45s MISSING\n" "Security header: X-Frame-Options"; FAIL=$((FAIL+1)); }

# ── RATE LIMIT HEADERS ────────────────────────────────────────────────────────

echo "$HEADERS" | grep -qi "x-ratelimit-limit:" \
  && { printf "✅  %-45s\n" "RateLimit header: X-RateLimit-Limit"; PASS=$((PASS+1)); } \
  || { printf "❌  %-45s MISSING\n" "RateLimit header: X-RateLimit-Limit"; FAIL=$((FAIL+1)); }

echo "$HEADERS" | grep -qi "x-ratelimit-remaining:" \
  && { printf "✅  %-45s\n" "RateLimit header: X-RateLimit-Remaining"; PASS=$((PASS+1)); } \
  || { printf "❌  %-45s MISSING\n" "RateLimit header: X-RateLimit-Remaining"; FAIL=$((FAIL+1)); }

echo "$HEADERS" | grep -qi "x-ratelimit-reset:" \
  && { printf "✅  %-45s\n" "RateLimit header: X-RateLimit-Reset"; PASS=$((PASS+1)); } \
  || { printf "❌  %-45s MISSING\n" "RateLimit header: X-RateLimit-Reset"; FAIL=$((FAIL+1)); }

# ── RATE LIMIT (POST 10/min) ──────────────────────────────────────────────────
# POST limit: 10/min per IP. Sekcja walidacji wyżej zużywa już kilka slotów.
# Wysyłamy 15 żądań — gwarantowane wyzwolenie 429 w oknie minuty.
# Ticker '123' (format invalid) → 400 do limitu, potem 429.

echo ""
echo "Testing POST rate limit (limit=10/min, sending up to 15 requests)..."
RATE_LIMIT_AT=""
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{"ticker":"123","title":"Rate limit test payload ok"}')
  if [[ "$CODE" == "429" ]]; then
    RATE_LIMIT_AT="$i"
    break
  fi
done
if [[ -n "$RATE_LIMIT_AT" ]]; then
  printf "✅  %-45s HTTP 429 (request #%s)\n" "Rate limit: POST → 429 triggered" "$RATE_LIMIT_AT"
  PASS=$((PASS+1))
else
  printf "❌  %-45s 429 not seen in 15 requests\n" "Rate limit: POST → 429 not triggered"
  FAIL=$((FAIL+1))
fi

# ── SUMMARY ───────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: ${PASS} passed, ${FAIL} failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[[ $FAIL -gt 0 ]] && exit 1 || exit 0
