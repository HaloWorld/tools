use serde::Serialize;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize)]
pub struct CommandInfo {
    pub name: String,
    pub description: String,
    pub surface: String,
    pub ready: bool,
}

#[derive(Debug, Serialize)]
pub struct CommandReport {
    pub tool: &'static str,
    pub version: &'static str,
    pub command_count: usize,
    pub commands: Vec<CommandInfo>,
}

#[derive(Debug, Serialize)]
pub struct DoctorReport {
    pub tool: &'static str,
    pub version: &'static str,
    pub status: &'static str,
    pub command_count: usize,
    pub self_listed: bool,
}

pub fn command_report() -> Result<CommandReport, String> {
    let exe =
        env::current_exe().map_err(|err| format!("could not locate current executable: {err}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "could not locate command directory".to_string())?;

    command_report_from_dir(dir)
}

pub fn command_report_from_dir(dir: &Path) -> Result<CommandReport, String> {
    let catalog = known_catalog();
    let mut commands = Vec::new();

    for entry in
        fs::read_dir(dir).map_err(|err| format!("could not read command directory: {err}"))?
    {
        let entry = entry.map_err(|err| format!("could not read command entry: {err}"))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !is_public_command_file(&path, name) {
            continue;
        }

        let (description, surface) = catalog
            .get(name)
            .copied()
            .unwrap_or(("Universal Tools command", "CLI"));
        commands.push(CommandInfo {
            name: name.to_string(),
            description: description.to_string(),
            surface: surface.to_string(),
            ready: true,
        });
    }

    commands.sort_by(|left, right| {
        command_rank(&left.name)
            .cmp(&command_rank(&right.name))
            .then_with(|| left.name.cmp(&right.name))
    });
    commands.dedup_by(|left, right| left.name == right.name);

    Ok(CommandReport {
        tool: "ut-list",
        version: VERSION,
        command_count: commands.len(),
        commands,
    })
}

pub fn doctor_report() -> Result<DoctorReport, String> {
    let report = command_report()?;
    let self_listed = report.commands.iter().any(|item| item.name == "ut-list");

    Ok(DoctorReport {
        tool: "ut-list",
        version: VERSION,
        status: if self_listed { "ok" } else { "warn" },
        command_count: report.command_count,
        self_listed,
    })
}

pub fn command_directory() -> Result<PathBuf, String> {
    let exe =
        env::current_exe().map_err(|err| format!("could not locate current executable: {err}"))?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "could not locate command directory".to_string())
}

fn known_catalog() -> BTreeMap<&'static str, (&'static str, &'static str)> {
    BTreeMap::from([
        (
            "ut-list",
            ("Installed Universal Tools command catalog", "CLI + Desktop"),
        ),
        (
            "ut-codex-usage",
            (
                "Codex usage summaries from local session logs",
                "CLI + Desktop",
            ),
        ),
        (
            "ut-repo-snapshot",
            (
                "Privacy-safe Git repository status snapshot",
                "CLI",
            ),
        ),
    ])
}

fn command_rank(name: &str) -> usize {
    match name {
        "ut-list" => 0,
        "ut-repo-snapshot" => 1,
        "ut-codex-usage" => 2,
        _ => 99,
    }
}

fn is_public_command_file(path: &Path, name: &str) -> bool {
    if !name.starts_with("ut-") || name == "ut-desktop" || name.contains('.') {
        return false;
    }

    match fs::metadata(path) {
        Ok(metadata) => {
            if !metadata.is_file() {
                return false;
            }

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                metadata.permissions().mode() & 0o111 != 0
            }

            #[cfg(not(unix))]
            {
                true
            }
        }
        Err(_) => false,
    }
}
