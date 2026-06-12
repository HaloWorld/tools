use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use ut_codex_usage::{build_report_json, parse_profile_total, ReportOptions};
use ut_list::{command_directory, command_report_from_dir, CommandReport};
use ut_repo_snapshot::RepoSnapshot;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexUsageRequest {
    profile_total: Option<String>,
    top: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppMetadata {
    product_name: &'static str,
    version: &'static str,
    bundle_identifier: &'static str,
}

#[tauri::command]
fn codex_usage_report(request: CodexUsageRequest) -> Result<Value, String> {
    let options = codex_usage_options_from_request(request)?;
    build_report_json(options).map_err(|err| desktop_error_message(format!("{err:#}")))
}

fn codex_usage_options_from_request(request: CodexUsageRequest) -> Result<ReportOptions, String> {
    let mut options = ReportOptions::all_history();
    options.top = request.top.unwrap_or(12);

    if let Some(profile_total) = request
        .profile_total
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        options.profile_total =
            Some(parse_profile_total(profile_total).map_err(|err| err.to_string())?);
    }

    Ok(options)
}

#[tauri::command]
fn app_metadata() -> AppMetadata {
    AppMetadata {
        product_name: "Universal Tools",
        version: env!("CARGO_PKG_VERSION"),
        bundle_identifier: "com.haloworld.universaltools",
    }
}

#[tauri::command]
fn command_index_report() -> Result<CommandReport, String> {
    let command_dir = command_directory()?;
    command_index_report_from_dir(&command_dir)
}

fn command_index_report_from_dir(command_dir: &Path) -> Result<CommandReport, String> {
    command_report_from_dir(command_dir)
}

#[tauri::command]
fn repo_snapshot_report() -> RepoSnapshot {
    ut_repo_snapshot::snapshot_current_dir()
}

fn desktop_error_message(message: String) -> String {
    if message.starts_with("No JSONL files found under ") {
        return "No local Codex logs found. Open Codex once, then refresh Codex Usage.".to_string();
    }

    if message.starts_with("Codex home does not exist: ") {
        return "Codex local data is not available on this Mac yet.".to_string();
    }

    message
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            codex_usage_report,
            app_metadata,
            command_index_report,
            repo_snapshot_report
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Universal Tools");
}

#[cfg(test)]
mod tests {
    use super::{
        app_metadata, codex_usage_options_from_request, command_index_report_from_dir,
        desktop_error_message, repo_snapshot_report, CodexUsageRequest,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_command_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is before UNIX_EPOCH")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "ut-desktop-command-index-test-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create test command dir");
        dir
    }

    fn write_executable(path: &Path) {
        fs::write(path, "#!/bin/sh\nexit 0\n").expect("write test command");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = fs::metadata(path).expect("read test command metadata").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("set test command permissions");
        }
    }

    #[test]
    fn app_metadata_matches_release_identity() {
        let metadata = app_metadata();

        assert_eq!(metadata.product_name, "Universal Tools");
        assert_eq!(metadata.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(metadata.bundle_identifier, "com.haloworld.universaltools");
    }

    #[test]
    fn codex_usage_request_builds_all_history_options() {
        let options = codex_usage_options_from_request(CodexUsageRequest {
            profile_total: Some("18.4B".to_string()),
            top: Some(18),
        })
        .expect("request should build report options");

        assert_eq!(options.range.as_deref(), Some("all"));
        assert_eq!(options.top, 18);
        assert_eq!(options.profile_total, Some(18_400_000_000.0));
    }

    #[test]
    fn codex_usage_request_rejects_invalid_profile_total() {
        let err = codex_usage_options_from_request(CodexUsageRequest {
            profile_total: Some("not-a-number".to_string()),
            top: None,
        })
        .expect_err("invalid profile total should fail");

        assert!(err.contains("expected a number"));
    }

    #[test]
    fn command_index_reads_public_commands_from_app_directory() {
        let dir = temp_command_dir();
        write_executable(&dir.join("ut-list"));
        write_executable(&dir.join("ut-repo-snapshot"));
        write_executable(&dir.join("ut-codex-usage"));
        write_executable(&dir.join("ut-desktop"));
        fs::write(dir.join("README.md"), "ignored").expect("write ignored file");

        let report = command_index_report_from_dir(&dir).expect("command index report should load");
        let command_names: Vec<_> = report
            .commands
            .iter()
            .map(|command| command.name.as_str())
            .collect();

        assert_eq!(report.tool, "ut-list");
        assert_eq!(report.command_count, 3);
        assert_eq!(
            command_names,
            vec!["ut-list", "ut-repo-snapshot", "ut-codex-usage"]
        );

        fs::remove_dir_all(dir).expect("remove test command dir");
    }

    #[test]
    fn repo_snapshot_report_hides_branch_names() {
        let report = repo_snapshot_report();
        let json = serde_json::to_string(&report).expect("serialize repo snapshot");

        assert_eq!(report.tool, "ut-repo-snapshot");
        assert_eq!(report.version, env!("CARGO_PKG_VERSION"));
        assert!(!json.contains("origin/main"));
    }

    #[test]
    fn hides_codex_paths_when_no_logs_exist() {
        let message = "No JSONL files found under /synthetic/.codex/sessions or /synthetic/.codex/archived_sessions";
        let out = desktop_error_message(message.to_string());

        assert_eq!(
            out,
            "No local Codex logs found. Open Codex once, then refresh Codex Usage."
        );
        assert!(!out.contains("/synthetic"));
    }
}
