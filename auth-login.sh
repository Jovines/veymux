#!/usr/bin/env bash

set -euo pipefail
umask 077

HOST="${VEYMUX_HOST:-localhost}"
PORT="${VEYMUX_PORT:-9834}"
BASE_URL="${VEYMUX_URL:-http://${HOST}:${PORT}}"
COOKIE_JAR="${VEYMUX_COOKIE_JAR:-$HOME/.veymux/automation.cookies}"
CACERT="${VEYMUX_CACERT:-}"

usage() {
  cat <<'EOF'
Usage: auth-login.sh [--url <base-url>] [--host <host>] [--port <port>] [--cacert <path>] [--cookie-jar <path>]

Login to Veymux using existing password and persist session cookie for automation.

Env:
  VEYMUX_PASSWORD   Required when auth is enabled.
  VEYMUX_URL        Full base URL (e.g. https://jovn.veymux.local:9834)
  VEYMUX_HOST       Default host when VEYMUX_URL is unset (default: localhost)
  VEYMUX_PORT       Default port when VEYMUX_URL is unset (default: 9834)
  VEYMUX_CACERT     CA certificate for HTTPS curl requests
  VEYMUX_COOKIE_JAR Cookie jar path (default: ~/.veymux/automation.cookies)
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --host)
      HOST="${2:-}"
      BASE_URL="http://${HOST}:${PORT}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      BASE_URL="http://${HOST}:${PORT}"
      shift 2
      ;;
    --cacert)
      CACERT="${2:-}"
      shift 2
      ;;
    --cookie-jar)
      COOKIE_JAR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown arg: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

BASE_URL="${BASE_URL%/}"
STATUS_URL="${BASE_URL}/api/auth/status"
LOGIN_URL="${BASE_URL}/api/auth/login"
CURL_OPTS=(-sS)
if [ -n "$CACERT" ]; then
  CURL_OPTS+=(--cacert "$CACERT")
fi

mkdir -p "$(dirname "$COOKIE_JAR")"

status_body="$(mktemp -t veymux-auth-status.XXXXXX)"
status_with_cookie_body="$(mktemp -t veymux-auth-status-cookie.XXXXXX)"
login_body="$(mktemp -t veymux-auth-login.XXXXXX)"
cleanup() {
  rm -f "$status_body" "$status_with_cookie_body" "$login_body"
}
trap cleanup EXIT

status_code="$(curl "${CURL_OPTS[@]}" -o "$status_body" -w '%{http_code}' "$STATUS_URL")"
if [ "$status_code" != "200" ]; then
  printf 'Failed to query auth status: HTTP %s (%s)\n' "$status_code" "$STATUS_URL" >&2
  exit 1
fi

if rg -q '"enabled"\s*:\s*false' "$status_body"; then
  printf 'Auth is disabled; no login needed.\n'
  exit 0
fi

if [ -s "$COOKIE_JAR" ]; then
  status_with_cookie_code="$(curl "${CURL_OPTS[@]}" -b "$COOKIE_JAR" -o "$status_with_cookie_body" -w '%{http_code}' "$STATUS_URL")"
  if [ "$status_with_cookie_code" = "200" ] && rg -q '"authenticated"\s*:\s*true' "$status_with_cookie_body"; then
    chmod 600 "$COOKIE_JAR" 2>/dev/null || true
    printf 'Existing automation cookie is still valid; skip login.\n'
    exit 0
  fi
fi

if [ -z "${VEYMUX_PASSWORD:-}" ]; then
  printf 'No valid automation cookie found, and VEYMUX_PASSWORD is empty.\n' >&2
  printf 'Set VEYMUX_PASSWORD to refresh login, e.g. export VEYMUX_PASSWORD="<your-existing-veymux-password>"\n' >&2
  exit 1
fi

payload="$(node -e 'console.log(JSON.stringify({ password: process.env.VEYMUX_PASSWORD || "" }))')"
login_code="$(curl "${CURL_OPTS[@]}" -o "$login_body" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -c "$COOKIE_JAR" \
  --data "$payload" \
  "$LOGIN_URL")"

if [ "$login_code" != "200" ]; then
  printf 'Login failed: HTTP %s\n' "$login_code" >&2
  cat "$login_body" >&2
  exit 1
fi

if ! rg -q '"ok"\s*:\s*true' "$login_body"; then
  printf 'Login response did not contain ok=true\n' >&2
  cat "$login_body" >&2
  exit 1
fi

chmod 600 "$COOKIE_JAR" 2>/dev/null || true
printf 'Login succeeded. Cookie jar saved to %s\n' "$COOKIE_JAR"
