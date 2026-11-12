#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$ROOT/.venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  printf 'Run scripts/bootstrap.sh first.\n' >&2
  exit 1
fi

mkdir -p "$ROOT/.tmp" "$ROOT/.data/redis"
export TMPDIR="$ROOT/.tmp"
export PYTHONPATH="$ROOT"

EXPLICIT_REDIS_URL="${REDIS_URL:-}"
if [[ -n "$EXPLICIT_REDIS_URL" ]]; then
  export REDIS_URL="$EXPLICIT_REDIS_URL"
else
  REDIS_PORT="${REDIS_PORT:-6379}"
  export REDIS_URL="redis://127.0.0.1:$REDIS_PORT/0"
fi

redis_ping() {
  "$PYTHON" -c 'import os, redis; redis.Redis.from_url(os.environ["REDIS_URL"], socket_connect_timeout=0.5, socket_timeout=0.5).ping()' >/dev/null 2>&1
}

REDIS_PID=""
REDIS_STARTED=0
SERVER_PID=""
SERVER_SIGNAL=0

forward_signal() {
  local signal="$1"
  SERVER_SIGNAL=1
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -s "$signal" "$SERVER_PID" 2>/dev/null || true
  fi
}

wait_for_server() {
  local status
  while :; do
    set +e
    wait "$SERVER_PID"
    status=$?
    set -e
    if [[ "$SERVER_SIGNAL" == "1" ]] || kill -0 "$SERVER_PID" 2>/dev/null; then
      SERVER_SIGNAL=0
      continue
    fi
    SERVER_PID=""
    return "$status"
  done
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$SERVER_PID" ]]; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    set +e
    wait "$SERVER_PID"
    local server_status=$?
    set -e
    SERVER_PID=""
    if [[ "$status" == "0" ]]; then
      status="$server_status"
    fi
  fi
  if [[ -n "$REDIS_PID" ]] && kill -0 "$REDIS_PID" 2>/dev/null; then
    kill -TERM "$REDIS_PID" 2>/dev/null || true
    wait "$REDIS_PID" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM

if [[ -n "$EXPLICIT_REDIS_URL" ]]; then
  if ! redis_ping; then
    printf 'Redis at REDIS_URL is unavailable; run Redis or choose a reachable URL.\n' >&2
    exit 1
  fi
elif ! redis_ping; then
  if command -v redis-server >/dev/null 2>&1; then
    REDIS_SERVER="$(command -v redis-server)"
  elif [[ -x "$ROOT/.tools/redis/bin/redis-server" ]]; then
    REDIS_SERVER="$ROOT/.tools/redis/bin/redis-server"
  else
    printf 'No redis-server found. Install the system package or provide .tools/redis/bin/redis-server.\n' >&2
    exit 1
  fi

  REDIS_LOG="$ROOT/.data/redis/redis.log"
  "$REDIS_SERVER" \
    --bind 127.0.0.1 \
    --port "$REDIS_PORT" \
    --dir "$ROOT/.data/redis" \
    --dbfilename wispiva.rdb \
    --appendonly yes \
    --appendfsync everysec \
    --daemonize no >>"$REDIS_LOG" 2>&1 &
  REDIS_PID=$!
  REDIS_STARTED=1

  READY=0
  for _ in {1..100}; do
    if redis_ping; then
      READY=1
      break
    fi
    if ! kill -0 "$REDIS_PID" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  if [[ "$READY" != "1" ]]; then
    printf 'Redis did not become ready; see %s\n' "$REDIS_LOG" >&2
    exit 1
  fi
fi

PORT="${PORT:-4173}"
export PORT
if [[ "$REDIS_STARTED" == "1" ]]; then
  printf 'This script started Redis with AOF appendfsync=everysec; a Redis or host crash may lose about the last second of writes.\n'
else
  printf 'Using external Redis; its persistence settings are managed externally and are not guaranteed to use AOF appendfsync=everysec.\n'
fi
printf 'Starting Wispiva at http://127.0.0.1:%s/\n' "$PORT"
cd "$ROOT"
"$PYTHON" -m kernel.server &
SERVER_PID=$!
set +e
wait_for_server
SERVER_STATUS=$?
set -e
exit "$SERVER_STATUS"
