#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_BUNDLE="${UT_APP_BUNDLE:-"${ROOT_DIR}/target/release/bundle/macos/Universal Tools.app"}"
INSTALL_DIR="${UT_LOCAL_INSTALL_DIR:-"${HOME}/Applications"}"
LINK_CLI="${UT_LINK_CLI:-0}"
BIN_DIR="${UT_LOCAL_BIN_DIR:-"${HOME}/.local/bin"}"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "missing file: $1"
}

require_dir() {
  [[ -d "$1" ]] || fail "missing directory: $1"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "${APP_BUNDLE}/Contents/Info.plist" 2>/dev/null || true
}

require_command ditto
require_dir "${APP_BUNDLE}"
require_file "${APP_BUNDLE}/Contents/Info.plist"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-desktop"

product_name="$(plist_value "CFBundleDisplayName")"
if [[ -z "${product_name}" ]]; then
  product_name="$(plist_value "CFBundleName")"
fi
[[ -n "${product_name}" ]] || fail "could not read app product name"

[[ -n "${INSTALL_DIR}" ]] || fail "UT_LOCAL_INSTALL_DIR must not be empty"
[[ "${INSTALL_DIR}" != "/" ]] || fail "refusing to install into /"

mkdir -p "${INSTALL_DIR}"
destination="${INSTALL_DIR%/}/${product_name}.app"

if [[ -e "${destination}" && ! -d "${destination}" ]]; then
  fail "install destination exists but is not an app bundle: ${destination}"
fi

rm -rf "${destination}"
ditto --norsrc --noextattr --noqtn --noacl "${APP_BUNDLE}" "${destination}"
UT_APP_BUNDLE="${destination}" "${SCRIPT_DIR}/check-macos-release.sh" local >/dev/null

printf 'ok: installed %s\n' "${destination}"

if [[ "${LINK_CLI}" == "1" ]]; then
  [[ -n "${BIN_DIR}" ]] || fail "UT_LOCAL_BIN_DIR must not be empty when UT_LINK_CLI=1"
  mkdir -p "${BIN_DIR}"

  command_count=0
  while IFS= read -r command_path; do
    command_name="$(basename "${command_path}")"
    [[ "${command_name}" == "ut-desktop" ]] && continue
    [[ -x "${command_path}" ]] || continue

    ln -sf "${command_path}" "${BIN_DIR%/}/${command_name}"
    "${BIN_DIR%/}/${command_name}" --version >/dev/null
    command_count=$((command_count + 1))
    printf 'ok: linked %s\n' "${BIN_DIR%/}/${command_name}"
  done < <(find "${destination}/Contents/MacOS" -maxdepth 1 -type f -name 'ut-*' -print)

  [[ "${command_count}" -gt 0 ]] || fail "no embedded CLI commands found to link"
  printf 'ok: linked %s CLI commands into %s\n' "${command_count}" "${BIN_DIR}"
fi
