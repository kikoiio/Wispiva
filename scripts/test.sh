#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.tmp"
export TMPDIR="$ROOT/.tmp"
export PYTHONPATH="$ROOT"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
elif command -v python3.12 >/dev/null 2>&1; then
  PYTHON="$(command -v python3.12)"
elif command -v python >/dev/null 2>&1; then
  PYTHON="$(command -v python)"
else
  printf 'Python 3.12 is required. Run scripts/bootstrap.sh first.\n' >&2
  exit 1
fi

CONFIG_DIR="$(mktemp -d "$ROOT/.tmp/test-config.XXXXXX")"
cleanup() {
  local status=$?
  trap - EXIT
  rm -rf "$CONFIG_DIR"
  exit "$status"
}
trap cleanup EXIT
mkdir -p "$CONFIG_DIR/xdg"
: > "$CONFIG_DIR/empty.env"
export XDG_CONFIG_HOME="$CONFIG_DIR/xdg"
export WISPIVA_ENV_FILE="$CONFIG_DIR/empty.env"
unset WISPIVA_LLM_BASE_URL WISPIVA_LLM_MODEL WISPIVA_LLM_API_KEY || true

cd "$ROOT"
"$PYTHON" -m unittest discover -s tests -p 'test_*.py'
node --test
