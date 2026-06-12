#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_BUNDLE="${UT_APP_BUNDLE:-"${ROOT_DIR}/target/release/bundle/macos/Universal Tools.app"}"

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

embed_tool() {
  local package="$1"
  local command="$2"
  local source="${ROOT_DIR}/target/release/${command}"
  local dest="${APP_BUNDLE}/Contents/MacOS/${command}"

  cargo build --release -p "${package}" >/dev/null
  require_file "${source}"
  install -m 0755 "${source}" "${dest}"
  "${dest}" --help >/dev/null
  note "embedded ${command}"
}

require_dir "${APP_BUNDLE}"
require_dir "${APP_BUNDLE}/Contents/MacOS"

embed_tool "ut-list" "ut-list"
embed_tool "ut-repo-snapshot" "ut-repo-snapshot"
embed_tool "ut-codex-usage" "ut-codex-usage"
