#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ut-local-install.XXXXXX")"
trap 'rm -rf "${TMP_ROOT}"' EXIT

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "missing file: $1"
}

INSTALL_DIR="${TMP_ROOT}/Applications"
BIN_DIR="${TMP_ROOT}/bin"

UT_LOCAL_INSTALL_DIR="${INSTALL_DIR}" \
UT_LOCAL_BIN_DIR="${BIN_DIR}" \
UT_LINK_CLI=1 \
"${SCRIPT_DIR}/install-local-app.sh" >/dev/null

APP_BUNDLE="${INSTALL_DIR}/Universal Tools.app"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-desktop"
UT_APP_BUNDLE="${APP_BUNDLE}" "${SCRIPT_DIR}/check-macos-release.sh" local >/dev/null

for command in ut-list ut-repo-snapshot ut-codex-usage; do
  require_file "${BIN_DIR}/${command}"
  "${BIN_DIR}/${command}" --version >/dev/null
  "${BIN_DIR}/${command}" --help >/dev/null
done

list_doctor="$("${BIN_DIR}/ut-list" doctor --json)"
[[ "${list_doctor}" == *'"status":"ok"'* || "${list_doctor}" == *'"status": "ok"'* ]] || fail "ut-list doctor did not report ok"

repo_doctor="$("${BIN_DIR}/ut-repo-snapshot" doctor --json)"
[[ "${repo_doctor}" == *'"output_includes_paths":false'* || "${repo_doctor}" == *'"output_includes_paths": false'* ]] || fail "ut-repo-snapshot doctor did not confirm pathless output"

codex_doctor="$("${BIN_DIR}/ut-codex-usage" doctor --json --codex-home /nonexistent/universal-tools-local-install)"
[[ "${codex_doctor}" == *'"tool":"ut-codex-usage"'* || "${codex_doctor}" == *'"tool": "ut-codex-usage"'* ]] || fail "ut-codex-usage doctor did not return JSON"

printf 'ok: local install simulation passed\n'
