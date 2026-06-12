use serde::Serialize;
use std::env;
use std::process::ExitCode;
use ut_repo_snapshot::{doctor_current_dir, snapshot_current_dir, RepoSnapshot, VERSION};

fn print_help() {
    println!("Usage:");
    println!("  ut-repo-snapshot");
    println!("  ut-repo-snapshot --json");
    println!("  ut-repo-snapshot doctor");
    println!("  ut-repo-snapshot doctor --json");
    println!("  ut-repo-snapshot --version");
    println!();
    println!("Shows a privacy-safe Git repository status snapshot for the current directory.");
    println!("Default output uses counts only and does not print file paths or remote URLs.");
}

fn print_table(report: &RepoSnapshot) {
    println!("Repo Snapshot");
    println!();

    if !report.git_available {
        println!("  status: git not found");
        println!("  output: counts only; no file paths");
        return;
    }

    if !report.inside_work_tree {
        println!("  status: not a git repository");
        println!("  output: counts only; no file paths");
        return;
    }

    println!("  status: {}", if report.dirty { "dirty" } else { "clean" });
    println!("  branch_state: {}", report.branch_state);
    println!("  has_upstream: {}", report.has_upstream);
    println!("  ahead: {}", report.ahead);
    println!("  behind: {}", report.behind);
    println!();
    println!("  staged: {}", report.counts.staged);
    println!("  modified: {}", report.counts.modified);
    println!("  deleted: {}", report.counts.deleted);
    println!("  renamed: {}", report.counts.renamed);
    println!("  untracked: {}", report.counts.untracked);
    println!("  conflicted: {}", report.counts.conflicted);
    println!();
    println!("  privacy: counts only; file paths and remote URLs are not printed");
}

fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    let out = serde_json::to_string_pretty(value)
        .map_err(|err| format!("could not write json: {err}"))?;
    println!("{out}");
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();

    match args.as_slice() {
        [] => print_table(&snapshot_current_dir()),
        [flag] if flag == "-h" || flag == "--help" => print_help(),
        [flag] if flag == "--version" => println!("ut-repo-snapshot {VERSION}"),
        [flag] if flag == "--json" => print_json(&snapshot_current_dir())?,
        [command] if command == "doctor" => {
            let doctor = doctor_current_dir();
            println!("ut-repo-snapshot doctor");
            println!("  status: {}", doctor.status);
            println!("  git_available: {}", doctor.git_available);
            println!("  inside_work_tree: {}", doctor.inside_work_tree);
            println!("  output_includes_paths: {}", doctor.output_includes_paths);
        }
        [command, flag] if command == "doctor" && flag == "--json" => {
            print_json(&doctor_current_dir())?;
        }
        _ => {
            return Err("usage: ut-repo-snapshot [--json|--version|doctor]".to_string());
        }
    }

    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("ERROR: {err}");
            ExitCode::from(1)
        }
    }
}
