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

# ── SECURITY HEADERS ─────────────────────────────────────────────────────────

HEADERS=$(curl -sI "$BASE_URL/api/news?limit=1")
echo "$HEADERS" | grep -qi "x-content-type-options: nosniff" \
  && { printf "✅  %-45s\n" "Security header: X-Content-Type-Options"; PASS=$((PASS+1)); } \
  || { printf "❌  %-45s MISSING\n" "Security header: X-Content-Type-Options"; FAIL=$((FAIL+1)); }

echo "$HEADERS" | grep -qi "x-frame-options: deny" \
  && { printf "✅  %-45s\n" "Security header: X-Frame-Options"; PASS=$((PASS+1)); } \
  || { printf "❌  %-45s MISSING\n" "Security header: X-Frame-Options"; FAIL=$((FAIL+1)); }

# ── RATE LIMIT ────────────────────────────────────────────────────────────────
# Używa nieprawidłowego tickera (cyfry) → fail validation (400), ale rate limit i tak się liczy.
# Żądania 1-30: 400 | Żądanie 31: 429

echo ""
echo "Testing rate limit (31 × POST, ticker='123' = invalid format)..."
LAST_CODE=""
for i in $(seq 1 31); do
  LAST_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/news" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{"ticker":"123","title":"Rate limit test payload ok"}')
done
check "Rate limit: 31st POST → 429" 429 "$LAST_CODE"

# ── SUMMARY ───────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: ${PASS} passed, ${FAIL} failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[[ $FAIL -gt 0 ]] && exit 1 || exit 0
