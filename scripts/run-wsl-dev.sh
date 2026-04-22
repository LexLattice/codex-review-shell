#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "WSL GUI environment not detected. Launch from a WSLg session or set DISPLAY/WAYLAND_DISPLAY." >&2
  exit 1
fi

cd "$ROOT_DIR"
exec node ./scripts/run-electron.mjs .
