#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_BUNDLE="${UT_APP_BUNDLE:-"${ROOT_DIR}/target/release/bundle/macos/Universal Tools.app"}"
TAURI_CONFIG="${ROOT_DIR}/apps/desktop/src-tauri/tauri.conf.json"
DIST_INDEX="${ROOT_DIR}/apps/desktop/dist/index.html"
MODE="${1:-local}"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

note() {
  printf 'ok: %s\n' "$*"
}

require_file() {
  [[ -f "$1" ]] || fail "missing file: $1"
}

require_dir() {
  [[ -d "$1" ]] || fail "missing directory: $1"
}

require_embedded_string() {
  local binary="$1"
  local needle="$2"
  if ! LC_ALL=C grep -a -Fq -- "${needle}" "${binary}"; then
    fail "app executable is missing embedded frontend marker: ${needle}"
  fi
}

require_dist_string() {
  local needle="$1"
  if ! grep -R -Fq -- "${needle}" "${ROOT_DIR}/apps/desktop/dist"; then
    fail "desktop dist is missing frontend marker: ${needle}"
  fi
}

run_quick() {
  local label="$1"
  shift
  local timeout_seconds="${UT_COMMAND_TIMEOUT_SECONDS:-20}"
  local marker
  marker="$(mktemp "${TMPDIR:-/tmp}/ut-command-timeout.XXXXXX")"
  rm -f "${marker}"

  "$@" >/dev/null &
  local command_pid=$!
  (
    sleep "${timeout_seconds}"
    if kill -0 "${command_pid}" 2>/dev/null; then
      touch "${marker}"
      kill "${command_pid}" 2>/dev/null || true
    fi
  ) &
  local timer_pid=$!

  if wait "${command_pid}"; then
    kill "${timer_pid}" 2>/dev/null || true
    wait "${timer_pid}" 2>/dev/null || true
    rm -f "${marker}"
    return 0
  fi

  local status=$?
  kill "${timer_pid}" 2>/dev/null || true
  wait "${timer_pid}" 2>/dev/null || true
  if [[ -f "${marker}" ]]; then
    rm -f "${marker}"
    fail "${label} timed out after ${timeout_seconds}s"
  fi
  rm -f "${marker}"
  fail "${label} exited with status ${status}"
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "${APP_BUNDLE}/Contents/Info.plist"
}

expect_plist() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(plist_value "$key")"
  [[ "${actual}" == "${expected}" ]] || fail "${key} expected '${expected}', got '${actual}'"
}

case "${MODE}" in
  local|public) ;;
  *) fail "usage: $0 [local|public]" ;;
esac

require_dir "${APP_BUNDLE}"
require_dir "${APP_BUNDLE}/Contents"
require_file "${APP_BUNDLE}/Contents/Info.plist"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-desktop"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-list"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-repo-snapshot"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-codex-usage"
require_file "${APP_BUNDLE}/Contents/Resources/icon.icns"
require_file "${TAURI_CONFIG}"
require_file "${DIST_INDEX}"

if grep -q '"csp"[[:space:]]*:[[:space:]]*null' "${TAURI_CONFIG}"; then
  fail "Tauri CSP must not be null for release builds"
fi

asset_paths="$(grep -Eo '/assets/[^"]+\.(js|css)' "${DIST_INDEX}" | sort -u || true)"
[[ -n "${asset_paths}" ]] || fail "desktop dist index is missing frontend asset links"

while IFS= read -r asset_path; do
  [[ -n "${asset_path}" ]] || continue
  require_file "${ROOT_DIR}/apps/desktop/dist${asset_path}"
  require_embedded_string "${APP_BUNDLE}/Contents/MacOS/ut-desktop" "${asset_path}"
done <<< "${asset_paths}"

require_embedded_string "${APP_BUNDLE}/Contents/MacOS/ut-desktop" "Universal Tools"
require_embedded_string "${APP_BUNDLE}/Contents/MacOS/ut-desktop" "codex_usage_report"
require_dist_string "#repo-snapshot"
require_dist_string "repo_snapshot_report"

expect_plist "CFBundleDisplayName" "Universal Tools"
expect_plist "CFBundleName" "Universal Tools"
expect_plist "CFBundleExecutable" "ut-desktop"
expect_plist "CFBundleIdentifier" "com.haloworld.universaltools"
expect_plist "CFBundlePackageType" "APPL"
expect_plist "LSApplicationCategoryType" "public.app-category.developer-tools"

run_quick "embedded ut-list" "${APP_BUNDLE}/Contents/MacOS/ut-list" --help
run_quick "embedded ut-repo-snapshot" "${APP_BUNDLE}/Contents/MacOS/ut-repo-snapshot" --help
run_quick "embedded ut-codex-usage" "${APP_BUNDLE}/Contents/MacOS/ut-codex-usage" --help

codesign --verify --deep --strict --verbose=2 "${APP_BUNDLE}" >/dev/null 2>&1
note "codesign verification passed"

signature_info="$(codesign --display --verbose=2 "${APP_BUNDLE}" 2>&1)"
grep -q "Identifier=com.haloworld.universaltools" <<<"${signature_info}" || fail "codesign identifier mismatch"

if [[ "${MODE}" == "public" ]]; then
  if grep -q "Signature=adhoc" <<<"${signature_info}"; then
    fail "public release requires Developer ID signing, not ad-hoc signing"
  fi
  spctl --assess --type execute --verbose=2 "${APP_BUNDLE}" >/dev/null
  xcrun stapler validate "${APP_BUNDLE}" >/dev/null
  note "public signing and notarization checks passed"
else
  note "local release bundle shape passed"
fi
