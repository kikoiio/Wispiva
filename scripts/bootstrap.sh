#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.tmp" "$ROOT/.data/pip-cache"
export TMPDIR="$ROOT/.tmp"
export PIP_CACHE_DIR="$ROOT/.data/pip-cache"

if ! command -v python3.12 >/dev/null 2>&1; then
  printf 'Python 3.12 is required. Install it, then run scripts/bootstrap.sh again.\n' >&2
  exit 1
fi

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON_MINOR="$("$ROOT/.venv/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [[ "$PYTHON_MINOR" != "3.12" ]]; then
    printf '.venv uses Python %s; remove or rename it before bootstrapping Python 3.12.\n' "$PYTHON_MINOR" >&2
    exit 1
  fi
else
  python3.12 -m venv "$ROOT/.venv"
fi

cd "$ROOT"
"$ROOT/.venv/bin/python" -m pip install --disable-pip-version-check -r "$ROOT/requirements.txt"
printf 'Environment ready: %s/.venv\n' "$ROOT"
