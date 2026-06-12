#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${APP_DIR}/../.." && pwd)"
SIGN_IDENTITY="${UT_DEVELOPER_ID_APPLICATION:-}"
NOTARY_PROFILE="${UT_NOTARYTOOL_PROFILE:-}"
RELEASE_BASE_URL="${UT_RELEASE_BASE_URL:-}"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

note() {
  printf 'ok: %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

normalize_github_remote() {
  local remote="$1"

  case "${remote}" in
    git@github.com:*.git)
      printf 'https://github.com/%s\n' "${remote#git@github.com:}" | sed 's/\.git$//'
      ;;
    git@github.com:*)
      printf 'https://github.com/%s\n' "${remote#git@github.com:}"
      ;;
    https://github.com/*.git)
      printf '%s\n' "${remote%.git}"
      ;;
    https://github.com/*)
      printf '%s\n' "${remote}"
      ;;
    *)
      return 1
      ;;
  esac
}

require_command node
require_command git
APP_VERSION="$(node -e "process.stdout.write(require('${APP_DIR}/package.json').version)")"
[[ -n "${APP_VERSION}" ]] || fail "could not read app version"
RELEASE_TAG="v${APP_VERSION}"

if ! git -C "${ROOT_DIR}" diff --quiet; then
  fail "public release requires a clean git worktree"
fi

if ! git -C "${ROOT_DIR}" diff --cached --quiet; then
  fail "public release requires no staged but uncommitted changes"
fi

if [[ -n "$(git -C "${ROOT_DIR}" ls-files --others --exclude-standard)" ]]; then
  fail "public release requires no untracked files"
fi

[[ -n "${RELEASE_BASE_URL}" ]] || fail "set UT_RELEASE_BASE_URL to the public GitHub Release asset base URL"

remote_url="$(git -C "${ROOT_DIR}" config --get remote.origin.url || true)"
repo_url="$(normalize_github_remote "${remote_url}")" || fail "remote.origin.url must be a GitHub repository URL"
release_base_url="${RELEASE_BASE_URL%/}"
expected_release_base_url="${repo_url}/releases/download/${RELEASE_TAG}"

if [[ "${release_base_url}" != "${expected_release_base_url}" ]]; then
  fail "UT_RELEASE_BASE_URL must be ${expected_release_base_url}"
fi

if ! git -C "${ROOT_DIR}" rev-parse -q --verify "refs/tags/${RELEASE_TAG}^{commit}" >/dev/null; then
  fail "public release requires git tag ${RELEASE_TAG}"
fi

tag_commit="$(git -C "${ROOT_DIR}" rev-list -n 1 "${RELEASE_TAG}")"
head_commit="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
if [[ "${tag_commit}" != "${head_commit}" ]]; then
  fail "public release tag ${RELEASE_TAG} must point to HEAD"
fi

[[ -n "${SIGN_IDENTITY}" ]] || fail "set UT_DEVELOPER_ID_APPLICATION to a Developer ID Application signing identity"
[[ -n "${NOTARY_PROFILE}" ]] || fail "set UT_NOTARYTOOL_PROFILE to a notarytool keychain profile"

case "${RELEASE_BASE_URL}" in
  https://*) ;;
  *) fail "UT_RELEASE_BASE_URL must start with https://" ;;
esac

case "${RELEASE_BASE_URL}" in
  *.zip|*.sha256|*.json|*.rb|*.md)
    fail "UT_RELEASE_BASE_URL must be the release asset directory, not an artifact file"
    ;;
esac

case "${release_base_url}" in
  */"${RELEASE_TAG}") ;;
  *) fail "UT_RELEASE_BASE_URL must point to release tag v${APP_VERSION}" ;;
esac

require_command codesign
require_command ditto
require_command ruby
require_command security
require_command shasum
require_command spctl
require_command xcrun
require_command zipinfo

if ! security find-identity -v -p codesigning | grep -Fq "${SIGN_IDENTITY}"; then
  fail "Developer ID signing identity was not found in this keychain: ${SIGN_IDENTITY}"
fi

if ! xcrun notarytool history --keychain-profile "${NOTARY_PROFILE}" >/dev/null 2>&1; then
  fail "notarytool keychain profile is not usable: ${NOTARY_PROFILE}"
fi

note "public release prerequisites passed"
