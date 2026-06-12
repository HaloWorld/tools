#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CODEX_COMMAND="${ROOT_DIR}/bin/ut-codex-usage"
CODEX_BINARY="${ROOT_DIR}/target/release/ut-codex-usage"
LIST_COMMAND="${ROOT_DIR}/bin/ut-list"
LIST_BINARY="${ROOT_DIR}/target/release/ut-list"
REPO_COMMAND="${ROOT_DIR}/bin/ut-repo-snapshot"
REPO_BINARY="${ROOT_DIR}/target/release/ut-repo-snapshot"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

note() {
  printf 'ok: %s\n' "$*"
}

[[ -x "${CODEX_COMMAND}" ]] || fail "missing executable command: ${CODEX_COMMAND}"
[[ -x "${LIST_COMMAND}" ]] || fail "missing executable command: ${LIST_COMMAND}"
[[ -x "${REPO_COMMAND}" ]] || fail "missing executable command: ${REPO_COMMAND}"

cargo build --release -p ut-codex-usage -p ut-list -p ut-repo-snapshot >/dev/null
[[ -x "${CODEX_BINARY}" ]] || fail "missing release binary: ${CODEX_BINARY}"
[[ -x "${LIST_BINARY}" ]] || fail "missing release binary: ${LIST_BINARY}"
[[ -x "${REPO_BINARY}" ]] || fail "missing release binary: ${REPO_BINARY}"

help_text="$("${CODEX_COMMAND}" --help)"
grep -q "ut-codex-usage all" <<<"${help_text}" || fail "command help does not mention all-history usage"
grep -q -- "--doctor" <<<"${help_text}" || fail "command help does not mention doctor usage"
note "ut-codex-usage help passed"

version_text="$("${CODEX_COMMAND}" --version)"
grep -q "ut-codex-usage 0.1.0" <<<"${version_text}" || fail "command version output is wrong: ${version_text}"
note "ut-codex-usage version passed"

list_help="$("${LIST_COMMAND}" --help)"
grep -q "ut-list --json" <<<"${list_help}" || fail "ut-list help does not mention JSON output"
grep -q "ut-list doctor" <<<"${list_help}" || fail "ut-list help does not mention doctor"
note "ut-list help passed"

list_version="$("${LIST_COMMAND}" --version)"
grep -q "ut-list 0.1.0" <<<"${list_version}" || fail "ut-list version output is wrong: ${list_version}"
note "ut-list version passed"

list_text="$("${LIST_COMMAND}")"
grep -q "ut-codex-usage" <<<"${list_text}" || fail "ut-list output is missing ut-codex-usage"
grep -q "ut-list" <<<"${list_text}" || fail "ut-list output is missing ut-list"
grep -q "ut-repo-snapshot" <<<"${list_text}" || fail "ut-list output is missing ut-repo-snapshot"
note "ut-list default output passed"

list_json_path="$(mktemp "${TMPDIR:-/tmp}/ut-list.XXXXXX.json")"
list_doctor_path="$(mktemp "${TMPDIR:-/tmp}/ut-list-doctor.XXXXXX.json")"
"${LIST_COMMAND}" --json > "${list_json_path}"
"${LIST_COMMAND}" doctor --json > "${list_doctor_path}"

node - "${list_json_path}" "${list_doctor_path}" <<'NODE'
const fs = require("node:fs");

const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const doctor = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const names = new Set(report.commands.map((command) => command.name));

if (report.tool !== "ut-list") {
  throw new Error(`report.tool expected ut-list, got ${report.tool}`);
}

if (report.version !== "0.1.0") {
  throw new Error(`report.version expected 0.1.0, got ${report.version}`);
}

for (const name of ["ut-codex-usage", "ut-list", "ut-repo-snapshot"]) {
  if (!names.has(name)) throw new Error(`ut-list JSON is missing ${name}`);
}

if (doctor.tool !== "ut-list" || doctor.status !== "ok" || doctor.self_listed !== true) {
  throw new Error("ut-list doctor did not report ok");
}
NODE

rm -f "${list_json_path}" "${list_doctor_path}"
note "ut-list JSON and doctor passed"

repo_help="$("${REPO_COMMAND}" --help)"
grep -q "ut-repo-snapshot --json" <<<"${repo_help}" || fail "ut-repo-snapshot help does not mention JSON output"
grep -q "counts only" <<<"${repo_help}" || fail "ut-repo-snapshot help does not mention counts-only output"
note "ut-repo-snapshot help passed"

repo_version="$("${REPO_COMMAND}" --version)"
grep -q "ut-repo-snapshot 0.1.0" <<<"${repo_version}" || fail "ut-repo-snapshot version output is wrong: ${repo_version}"
note "ut-repo-snapshot version passed"

repo_check_dir="$(mktemp -d "${TMPDIR:-/tmp}/ut-repo-check.XXXXXX")"
git init -q "${repo_check_dir}"
printf 'private\n' > "${repo_check_dir}/secret-file-name.env"
repo_json_path="$(mktemp "${TMPDIR:-/tmp}/ut-repo-snapshot.XXXXXX.json")"
repo_doctor_path="$(mktemp "${TMPDIR:-/tmp}/ut-repo-snapshot-doctor.XXXXXX.json")"
(
  cd "${repo_check_dir}"
  "${REPO_COMMAND}" --json > "${repo_json_path}"
  "${REPO_COMMAND}" doctor --json > "${repo_doctor_path}"
)

node - "${repo_json_path}" "${repo_doctor_path}" <<'NODE'
const fs = require("node:fs");

const reportText = fs.readFileSync(process.argv[2], "utf8");
const doctorText = fs.readFileSync(process.argv[3], "utf8");
const report = JSON.parse(reportText);
const doctor = JSON.parse(doctorText);

if (report.tool !== "ut-repo-snapshot") {
  throw new Error(`report.tool expected ut-repo-snapshot, got ${report.tool}`);
}

if (report.version !== "0.1.0") {
  throw new Error(`report.version expected 0.1.0, got ${report.version}`);
}

if (report.inside_work_tree !== true || report.dirty !== true) {
  throw new Error("repo snapshot did not detect dirty temporary git repository");
}

if (report.counts.untracked !== 1) {
  throw new Error(`repo snapshot expected one untracked file, got ${report.counts.untracked}`);
}

if (reportText.includes("secret-file-name.env")) {
  throw new Error("repo snapshot JSON leaked a file name");
}

if (
  doctor.tool !== "ut-repo-snapshot" ||
  doctor.status !== "ok" ||
  doctor.output_includes_paths !== false
) {
  throw new Error("ut-repo-snapshot doctor did not report safe output");
}
NODE

rm -rf "${repo_check_dir}"
rm -f "${repo_json_path}" "${repo_doctor_path}"
note "ut-repo-snapshot JSON and doctor passed"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/ut-cli-check.XXXXXX")"
trap 'rm -rf "${tmp_dir}"' EXIT

codex_home="${tmp_dir}/codex-home"
session_dir="${codex_home}/sessions/2026/01/02"
json_path="${tmp_dir}/report.json"
doctor_path="${tmp_dir}/doctor.json"
mkdir -p "${session_dir}"

cat > "${session_dir}/synthetic-session.jsonl" <<'JSONL'
{"type":"session_meta","timestamp":"2026-01-02T00:00:00Z","payload":{"id":"synthetic-cli-check","source":"codex-cli","timestamp":"2026-01-02T00:00:00Z","cwd":"/synthetic/universal-tools"}}
{"type":"turn_context","timestamp":"2026-01-02T00:00:01Z","payload":{"turn_id":"turn-1","model":"gpt-5","cwd":"/synthetic/universal-tools"}}
{"type":"response_item","timestamp":"2026-01-02T00:00:01Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Summarize synthetic usage."}]}}
{"type":"event_msg","timestamp":"2026-01-02T00:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":200,"reasoning_output_tokens":50}}}}
{"type":"turn_context","timestamp":"2026-01-02T00:00:03Z","payload":{"turn_id":"turn-2","model":"gpt-5","cwd":"/synthetic/universal-tools"}}
{"type":"event_msg","timestamp":"2026-01-02T00:00:04Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2500,"cached_input_tokens":900,"output_tokens":500,"reasoning_output_tokens":120}}}}
JSONL

"${CODEX_COMMAND}" all --codex-home "${codex_home}" --json > "${json_path}"
"${CODEX_COMMAND}" doctor --codex-home "${codex_home}" --json > "${doctor_path}"

node - "${json_path}" "${doctor_path}" <<'NODE'
const fs = require("node:fs");

const reportPath = process.argv[2];
const doctorPath = process.argv[3];
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const doctor = JSON.parse(fs.readFileSync(doctorPath, "utf8"));

const expected = {
  input_tokens: 2500,
  cached_input_tokens: 900,
  uncached_input_tokens: 1600,
  output_tokens: 500,
  reasoning_output_tokens: 120,
  raw_total_tokens: 3000,
  cli_display_total: 2100,
};

for (const [key, value] of Object.entries(expected)) {
  if (report.summary[key] !== value) {
    throw new Error(`summary.${key} expected ${value}, got ${report.summary[key]}`);
  }
}

if (report.scan_stats.files_with_token_events !== 1) {
  throw new Error(`files_with_token_events expected 1, got ${report.scan_stats.files_with_token_events}`);
}

if (report.scan_stats.token_events_counted !== 2) {
  throw new Error(`token_events_counted expected 2, got ${report.scan_stats.token_events_counted}`);
}

if (doctor.tool !== "ut-codex-usage") {
  throw new Error(`doctor.tool expected ut-codex-usage, got ${doctor.tool}`);
}

if (doctor.version !== "0.1.0") {
  throw new Error(`doctor.version expected 0.1.0, got ${doctor.version}`);
}

if (doctor.codex_home_exists !== true || doctor.sessions_dir_exists !== true) {
  throw new Error("doctor did not detect synthetic Codex home");
}

if (doctor.jsonl_files !== 1) {
  throw new Error(`doctor.jsonl_files expected 1, got ${doctor.jsonl_files}`);
}
NODE

note "ut-codex-usage synthetic all-history report passed"
note "ut-codex-usage doctor passed"
