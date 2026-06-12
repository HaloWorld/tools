#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_BUNDLE="${UT_APP_BUNDLE:-"${ROOT_DIR}/target/release/bundle/macos/Universal Tools.app"}"
DIST_DIR="${UT_DIST_DIR:-"${ROOT_DIR}/target/release/distribution"}"

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

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "${APP_BUNDLE}/Contents/Info.plist"
}

require_dir "${APP_BUNDLE}"
require_file "${APP_BUNDLE}/Contents/Info.plist"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-desktop"

version="$(plist_value "CFBundleShortVersionString")"
archs="$(/usr/bin/lipo -archs "${APP_BUNDLE}/Contents/MacOS/ut-desktop" | tr ' ' '-')"
[[ -n "${version}" ]] || fail "empty CFBundleShortVersionString"
[[ -n "${archs}" ]] || fail "could not detect app architecture"

artifact_base="Universal-Tools-${version}-macos-${archs}"
zip_path="${DIST_DIR}/${artifact_base}.zip"
checksum_path="${zip_path}.sha256"
verify_dir="$(mktemp -d "${TMPDIR:-/tmp}/ut-release-verify.XXXXXX")"
trap 'rm -rf "${verify_dir}"' EXIT

mkdir -p "${DIST_DIR}"
rm -f "${zip_path}" "${checksum_path}"

ditto -c -k --keepParent --norsrc --noextattr --noqtn --noacl "${APP_BUNDLE}" "${zip_path}"
ditto -x -k --norsrc --noextattr --noqtn --noacl "${zip_path}" "${verify_dir}"
extracted_app="${verify_dir}/Universal Tools.app"
require_file "${extracted_app}/Contents/MacOS/ut-desktop"
if ! UT_APP_BUNDLE="${extracted_app}" "${SCRIPT_DIR}/check-macos-release.sh" >/dev/null 2>&1; then
  fail "extracted app verification failed"
fi

(
  cd "${DIST_DIR}"
  shasum -a 256 "$(basename "${zip_path}")" > "$(basename "${checksum_path}")"
  shasum -a 256 -c "$(basename "${checksum_path}")" >/dev/null
)

UT_APP_BUNDLE="${APP_BUNDLE}" UT_DIST_DIR="${DIST_DIR}" "${SCRIPT_DIR}/write-release-manifest.mjs"

printf 'ok: created %s\n' "${zip_path}"
printf 'ok: created %s\n' "${checksum_path}"
printf 'ok: extracted app verification passed\n'
