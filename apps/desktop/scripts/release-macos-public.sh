#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_BUNDLE="${UT_APP_BUNDLE:-"${ROOT_DIR}/target/release/bundle/macos/Universal Tools.app"}"
DIST_DIR="${UT_DIST_DIR:-"${ROOT_DIR}/target/release/distribution"}"
SIGN_IDENTITY="${UT_DEVELOPER_ID_APPLICATION:-}"
NOTARY_PROFILE="${UT_NOTARYTOOL_PROFILE:-}"

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

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "${APP_BUNDLE}/Contents/Info.plist"
}

release_zip_path() {
  local version archs
  version="$(plist_value "CFBundleShortVersionString")"
  archs="$(/usr/bin/lipo -archs "${APP_BUNDLE}/Contents/MacOS/ut-desktop" | tr ' ' '-')"
  printf '%s/Universal-Tools-%s-macos-%s.zip' "${DIST_DIR}" "${version}" "${archs}"
}

"${SCRIPT_DIR}/check-public-release-prereqs.sh"

require_dir "${APP_BUNDLE}"
require_file "${APP_BUNDLE}/Contents/Info.plist"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-desktop"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-list"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-repo-snapshot"
require_file "${APP_BUNDLE}/Contents/MacOS/ut-codex-usage"

codesign --force --deep --options runtime --timestamp --sign "${SIGN_IDENTITY}" "${APP_BUNDLE}"
codesign --verify --deep --strict --verbose=2 "${APP_BUNDLE}" >/dev/null
note "Developer ID signing passed"

UT_RELEASE_KIND=public "${SCRIPT_DIR}/package-macos-release.sh" >/dev/null
zip_path="$(release_zip_path)"
require_file "${zip_path}"

xcrun notarytool submit "${zip_path}" --keychain-profile "${NOTARY_PROFILE}" --wait
note "notarization passed"

xcrun stapler staple "${APP_BUNDLE}"
xcrun stapler validate "${APP_BUNDLE}" >/dev/null
note "staple validation passed"

"${SCRIPT_DIR}/check-macos-release.sh" public
UT_RELEASE_KIND=public "${SCRIPT_DIR}/package-macos-release.sh"
"${SCRIPT_DIR}/write-homebrew-cask.mjs"
"${SCRIPT_DIR}/write-release-notes.mjs"
"${SCRIPT_DIR}/check-release-artifacts.mjs"
"${ROOT_DIR}/scripts/privacy-scan.sh"

printf 'ok: public release artifact is ready under %s\n' "${DIST_DIR}"
