use serde::Serialize;
use std::env;
use std::path::Path;
use std::process::Command;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Default, Serialize)]
pub struct StatusCounts {
    pub staged: usize,
    pub modified: usize,
    pub deleted: usize,
    pub renamed: usize,
    pub untracked: usize,
    pub conflicted: usize,
}

impl StatusCounts {
    pub fn dirty(&self) -> bool {
        self.staged
            + self.modified
            + self.deleted
            + self.renamed
            + self.untracked
            + self.conflicted
            > 0
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoSnapshot {
    pub tool: &'static str,
    pub version: &'static str,
    pub git_available: bool,
    pub inside_work_tree: bool,
    pub branch_state: &'static str,
    pub has_upstream: bool,
    pub ahead: usize,
    pub behind: usize,
    pub dirty: bool,
    pub counts: StatusCounts,
    pub privacy: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct DoctorReport {
    pub tool: &'static str,
    pub version: &'static str,
    pub status: &'static str,
    pub git_available: bool,
    pub inside_work_tree: bool,
    pub output_includes_paths: bool,
}

pub fn snapshot_current_dir() -> RepoSnapshot {
    let cwd = env::current_dir().ok();
    snapshot(cwd.as_deref().unwrap_or_else(|| Path::new(".")))
}

pub fn doctor_current_dir() -> DoctorReport {
    let snapshot = snapshot_current_dir();
    DoctorReport {
        tool: "ut-repo-snapshot",
        version: VERSION,
        status: if snapshot.git_available { "ok" } else { "warn" },
        git_available: snapshot.git_available,
        inside_work_tree: snapshot.inside_work_tree,
        output_includes_paths: false,
    }
}

pub fn snapshot(cwd: &Path) -> RepoSnapshot {
    if !git_available() {
        return empty_snapshot(false, false);
    }

    if !inside_work_tree(cwd) {
        return empty_snapshot(true, false);
    }

    match git(cwd, &["status", "--porcelain=v1", "--branch"]) {
        Ok(output) => parse_status_output(&output),
        Err(_) => empty_snapshot(true, false),
    }
}

fn empty_snapshot(git_available: bool, inside_work_tree: bool) -> RepoSnapshot {
    RepoSnapshot {
        tool: "ut-repo-snapshot",
        version: VERSION,
        git_available,
        inside_work_tree,
        branch_state: "unknown",
        has_upstream: false,
        ahead: 0,
        behind: 0,
        dirty: false,
        counts: StatusCounts::default(),
        privacy: "counts only; file paths and remote URLs are not printed",
    }
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn inside_work_tree(cwd: &Path) -> bool {
    git(cwd, &["rev-parse", "--is-inside-work-tree"])
        .map(|output| output.trim() == "true")
        .unwrap_or(false)
}

fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|err| format!("could not run git: {err}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_status_output(output: &str) -> RepoSnapshot {
    let mut snapshot = empty_snapshot(true, true);
    let mut counts = StatusCounts::default();

    for line in output.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            parse_branch_header(header, &mut snapshot);
            continue;
        }

        let bytes = line.as_bytes();
        if bytes.len() < 2 {
            continue;
        }

        let x = bytes[0] as char;
        let y = bytes[1] as char;

        if x == '?' && y == '?' {
            counts.untracked += 1;
            continue;
        }

        if is_conflict(x, y) {
            counts.conflicted += 1;
            continue;
        }

        if matches!(x, 'A' | 'M' | 'D' | 'R' | 'C') {
            counts.staged += 1;
        }
        if x == 'R' {
            counts.renamed += 1;
        }
        if y == 'M' {
            counts.modified += 1;
        }
        if y == 'D' {
            counts.deleted += 1;
        }
    }

    snapshot.dirty = counts.dirty();
    snapshot.counts = counts;
    snapshot
}

fn parse_branch_header(header: &str, snapshot: &mut RepoSnapshot) {
    let mut head = header;
    let mut state = "";
    if let Some((left, right)) = header.split_once(" [") {
        head = left;
        state = right.trim_end_matches(']');
    }

    if let Some((branch, upstream)) = head.split_once("...") {
        snapshot.branch_state = branch_state(branch);
        snapshot.has_upstream = !upstream.trim().is_empty();
    } else {
        snapshot.branch_state = branch_state(head);
    }

    for item in state.split(',').map(str::trim) {
        if let Some(value) = item.strip_prefix("ahead ") {
            snapshot.ahead = value.parse().unwrap_or(0);
        } else if let Some(value) = item.strip_prefix("behind ") {
            snapshot.behind = value.parse().unwrap_or(0);
        }
    }
}

fn branch_state(value: &str) -> &'static str {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "HEAD (no branch)" {
        "detached_or_unknown"
    } else {
        "attached"
    }
}

fn is_conflict(x: char, y: char) -> bool {
    matches!(
        (x, y),
        ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U')
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_branch_header() {
        let snapshot = parse_status_output("## main...origin/main\n");
        assert_eq!(snapshot.branch_state, "attached");
        assert!(snapshot.has_upstream);
        assert!(!snapshot.dirty);
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(!json.contains("origin/main"));
    }

    #[test]
    fn parses_ahead_behind_and_counts_without_paths() {
        let snapshot = parse_status_output(
            "## main...origin/main [ahead 2, behind 1]\n M private.txt\nA  staged.txt\nR  old -> new\n?? secret.env\nUU conflict.txt\n",
        );
        assert_eq!(snapshot.ahead, 2);
        assert_eq!(snapshot.behind, 1);
        assert_eq!(snapshot.counts.modified, 1);
        assert_eq!(snapshot.counts.staged, 2);
        assert_eq!(snapshot.counts.renamed, 1);
        assert_eq!(snapshot.counts.untracked, 1);
        assert_eq!(snapshot.counts.conflicted, 1);
        assert!(snapshot.dirty);
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(!json.contains("main"));
        assert!(!json.contains("origin/main"));
        assert!(!json.contains("private.txt"));
        assert!(!json.contains("secret.env"));
    }
}
