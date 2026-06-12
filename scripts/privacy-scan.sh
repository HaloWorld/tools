#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v rg >/dev/null 2>&1; then
  printf 'error: rg is required for privacy scan\n' >&2
  exit 1
fi

require_ignored() {
  local path="$1"
  if git -C "${ROOT_DIR}" check-ignore -q "${path}"; then
    return
  fi
  if git -C "${ROOT_DIR}" check-ignore -q "${path}/"; then
    return
  fi

  if [[ "${path}" == */* ]]; then
    local probe="${path}/.privacy-scan-probe"
    if git -C "${ROOT_DIR}" check-ignore -q "${probe}"; then
      return
    fi
  fi

  if [[ "${path}" != */* ]]; then
    local probe="${path}/.privacy-scan-probe"
    if git -C "${ROOT_DIR}" check-ignore -q "${probe}"; then
      return
    fi
  fi

  {
    printf 'error: %s must be ignored by git\n' "${path}" >&2
    exit 1
  }
}

reject_tracked_under() {
  local path="$1"
  local tracked
  tracked="$(git -C "${ROOT_DIR}" ls-files -- "${path}" | head -n 1)"
  if [[ -n "${tracked}" ]]; then
    printf 'error: local-only path is tracked by git: %s\n' "${tracked}" >&2
    exit 1
  fi
}

local_only_paths=(
  ".codex"
  ".agents"
  ".local"
  ".playwright-cli"
  ".playwright-mcp"
  "apps/desktop/dist"
  "apps/desktop/node_modules"
  "apps/desktop/src-tauri/gen"
  "outputs"
  "reports"
  "target"
  "tmp"
)

for path in "${local_only_paths[@]}"; do
  require_ignored "${path}"
  reject_tracked_under "${path}"
done

pattern='/Users/[^[:space:]"'\'']+|/private/|BEGIN [A-Z ]*KEY|sk-[A-Za-z0-9]|xox[baprs]-|gh[pousr]_[A-Za-z0-9]{20,}|api[_-]?key|access[_-]?token|refresh[_-]?token|password'

set +e
rg -n "${pattern}" \
  --glob '!target/**' \
  --glob '!apps/desktop/node_modules/**' \
  --glob '!apps/desktop/dist/**' \
  --glob '!apps/desktop/src-tauri/icons/*.png' \
  --glob '!apps/desktop/src-tauri/icons/*.ico' \
  --glob '!apps/desktop/src-tauri/icons/*.icns' \
  --glob '!scripts/privacy-scan.sh' \
  --glob '!.playwright-cli/**' \
  --glob '!.playwright-mcp/**' \
  "${ROOT_DIR}"
status=$?
set -e

case "${status}" in
  0)
    printf 'error: privacy scan found possible private data\n' >&2
    exit 1
    ;;
  1)
    printf 'ok: privacy scan found no obvious private data\n'
    ;;
  *)
    printf 'error: privacy scan failed\n' >&2
    exit "${status}"
    ;;
esac
