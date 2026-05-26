use crate::models::{
    BranchSnapshot, CommandResult, CommitSummary, DirtySummary, RepositoryRecord,
    RepositorySnapshot, StashSnapshot, WorktreeSnapshot,
};
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn discover_repository(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.to_string_lossy()));
    }

    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    let output = run_git(&canonical, &["rev-parse", "--show-toplevel"])?;
    Ok(PathBuf::from(output.trim()))
}

pub fn scan_repository(repo: &RepositoryRecord) -> Result<RepositorySnapshot, String> {
    let root = discover_repository(Path::new(&repo.path))?;
    let mut normalized_repo = repo.clone();
    normalized_repo.path = root.to_string_lossy().to_string();
    normalized_repo.id = normalized_repo.path.clone();

    let worktrees = scan_worktrees(&root)?;
    let default_branch = default_branch(&root);
    let merged = merged_branches(&root, default_branch.as_deref());
    let local_branches = scan_branches(&root, false, &merged)?;
    let remote_branches = scan_branches(&root, true, &HashSet::new())?;
    let stashes = scan_stashes(&root)?;

    Ok(RepositorySnapshot {
        repo: normalized_repo,
        worktrees,
        local_branches,
        remote_branches,
        stashes,
        diagnostics: Vec::new(),
    })
}

pub fn scan_worktrees(repo_path: &Path) -> Result<Vec<WorktreeSnapshot>, String> {
    let output = run_git(repo_path, &["worktree", "list", "--porcelain", "-z"])?;
    let mut worktrees = Vec::new();
    let mut current = PartialWorktree::default();

    for field in output.split('\0').filter(|field| !field.is_empty()) {
        if let Some(path) = field.strip_prefix("worktree ") {
            if current.path.is_some() {
                worktrees.push(current.finish()?);
                current = PartialWorktree::default();
            }
            current.path = Some(path.to_string());
        } else if let Some(head) = field.strip_prefix("HEAD ") {
            current.head_sha = Some(head.to_string());
        } else if let Some(branch) = field.strip_prefix("branch ") {
            current.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
        } else if field == "detached" {
            current.detached = true;
        } else if field.starts_with("locked") {
            current.locked = true;
        } else if field.starts_with("prunable") {
            current.prunable = true;
        }
    }

    if current.path.is_some() {
        worktrees.push(current.finish()?);
    }

    Ok(worktrees)
}

pub fn create_worktree(
    repo_path: &Path,
    branch: &str,
    worktree_path: &Path,
    create_branch: bool,
) -> Result<CommandResult, String> {
    let root = discover_repository(repo_path)?;
    let worktree = worktree_path.to_string_lossy().to_string();
    let args = if create_branch {
        vec!["worktree", "add", "-b", branch, &worktree]
    } else {
        vec!["worktree", "add", &worktree, branch]
    };
    run_git(&root, &args)?;

    Ok(CommandResult {
        ok: true,
        summary: format!("Created worktree for {branch}"),
        command: git_command(&root, &args),
        changed_paths: vec![worktree],
    })
}

pub fn delete_worktree(worktree_path: &Path, force: bool) -> Result<CommandResult, String> {
    let root = worktree_command_root(worktree_path)?;
    let worktree = worktree_path.to_string_lossy().to_string();
    let args = if force {
        vec!["worktree", "remove", "--force", &worktree]
    } else {
        vec!["worktree", "remove", &worktree]
    };
    run_git(&root, &args)?;

    Ok(CommandResult {
        ok: true,
        summary: "Removed worktree".to_string(),
        command: git_command(&root, &args),
        changed_paths: vec![worktree],
    })
}

pub fn delete_branch(repo_path: &Path, branch: &str, force: bool) -> Result<CommandResult, String> {
    let root = discover_repository(repo_path)?;
    let flag = if force { "-D" } else { "-d" };
    let args = vec!["branch", flag, branch];
    run_git(&root, &args)?;

    Ok(CommandResult {
        ok: true,
        summary: format!("Deleted branch {branch}"),
        command: git_command(&root, &args),
        changed_paths: vec![root.to_string_lossy().to_string()],
    })
}

pub fn fetch_repository(repo_path: &Path) -> Result<CommandResult, String> {
    let root = discover_repository(repo_path)?;
    let args = vec!["fetch", "--all", "--prune"];
    run_git(&root, &args)?;
    Ok(result("Fetched repository", &root, &args))
}

pub fn pull_worktree(worktree_path: &Path) -> Result<CommandResult, String> {
    let root = discover_repository(worktree_path)?;
    let args = vec!["pull", "--ff-only"];
    run_git(&root, &args)?;
    Ok(result("Pulled worktree", &root, &args))
}

pub fn push_branch(worktree_path: &Path) -> Result<CommandResult, String> {
    let root = discover_repository(worktree_path)?;
    let args = vec!["push"];
    run_git(&root, &args)?;
    Ok(result("Pushed branch", &root, &args))
}

pub fn stash_worktree(worktree_path: &Path) -> Result<CommandResult, String> {
    let root = discover_repository(worktree_path)?;
    let args = vec!["stash", "push", "-u", "-m", "Git Workscene stash"];
    run_git(&root, &args)?;
    Ok(result("Stashed worktree changes", &root, &args))
}

pub fn open_path(path: &Path, kind: &str) -> Result<CommandResult, String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.to_string_lossy()));
    }

    let mut command = Command::new("open");
    match kind {
        "terminal" => {
            command.arg("-a").arg("Terminal").arg(path);
        }
        "editor" => {
            command.arg("-a").arg("Visual Studio Code").arg(path);
        }
        _ => {
            command.arg(path);
        }
    }

    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(CommandResult {
        ok: true,
        summary: format!("Opened {}", path.to_string_lossy()),
        command: format!("open {}", shell_path(path)),
        changed_paths: Vec::new(),
    })
}

pub(crate) fn run_git(path: &Path, args: &[&str]) -> Result<String, String> {
    let args = args.iter().map(OsString::from).collect::<Vec<_>>();
    run_git_os(path, &args)
}

pub(crate) fn dirty_summary(path: &Path) -> Result<DirtySummary, String> {
    let output = run_git(path, &["status", "--porcelain=v1"])?;
    let mut summary = DirtySummary::default();

    for line in output.lines() {
        if line.len() < 2 {
            continue;
        }

        let code = &line[0..2];
        if code == "??" {
            summary.untracked += 1;
            continue;
        }

        if code.contains('U') || code == "AA" || code == "DD" {
            summary.conflicted += 1;
            continue;
        }

        for status in code.chars() {
            match status {
                'M' => summary.modified += 1,
                'A' => summary.added += 1,
                'D' => summary.deleted += 1,
                'R' => summary.renamed += 1,
                _ => {}
            }
        }
    }

    Ok(summary)
}

fn run_git_os(path: &Path, args: &[OsString]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    } else {
        let args = args
            .iter()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        Err(format!(
            "git -C {} {} failed: {}",
            path.to_string_lossy(),
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn scan_branches(
    repo_path: &Path,
    remote: bool,
    merged: &HashSet<String>,
) -> Result<Vec<BranchSnapshot>, String> {
    let refs = if remote { "refs/remotes" } else { "refs/heads" };
    let format = "%(refname)%09%(refname:short)%09%(upstream:short)%09%(worktreepath)";
    let output = run_git(
        repo_path,
        &["for-each-ref", &format!("--format={format}"), refs],
    )?;
    let mut branches = Vec::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let parts = line.split('\t').collect::<Vec<_>>();
        if parts.len() < 4 {
            continue;
        }

        let full_ref = parts[0].to_string();
        let name = parts[1].to_string();
        if remote && name.ends_with("/HEAD") {
            continue;
        }

        let upstream = non_empty(parts[2]);
        let (ahead, behind) = upstream
            .as_deref()
            .map(|upstream| ahead_behind(repo_path, &name, upstream))
            .unwrap_or((0, 0));

        branches.push(BranchSnapshot {
            name: name.clone(),
            full_ref,
            upstream,
            ahead,
            behind,
            is_merged_to_default: merged.contains(&name),
            worktree_path: non_empty(parts[3]),
            last_commit: last_commit_for_ref(repo_path, &name),
            is_remote: remote,
        });
    }

    Ok(branches)
}

fn scan_stashes(repo_path: &Path) -> Result<Vec<StashSnapshot>, String> {
    let output = run_git(repo_path, &["stash", "list", "--format=%gd%x09%gs"])?;
    Ok(output
        .lines()
        .filter_map(|line| {
            let (id, message) = line.split_once('\t')?;
            Some(StashSnapshot {
                id: id.to_string(),
                message: message.to_string(),
            })
        })
        .collect())
}

fn default_branch(repo_path: &Path) -> Option<String> {
    if git_ok(
        repo_path,
        &["show-ref", "--verify", "--quiet", "refs/heads/main"],
    ) {
        Some("main".to_string())
    } else if git_ok(
        repo_path,
        &["show-ref", "--verify", "--quiet", "refs/heads/master"],
    ) {
        Some("master".to_string())
    } else {
        run_git(repo_path, &["branch", "--show-current"])
            .ok()
            .filter(|branch| !branch.is_empty())
    }
}

fn merged_branches(repo_path: &Path, default_branch: Option<&str>) -> HashSet<String> {
    let Some(default_branch) = default_branch else {
        return HashSet::new();
    };

    run_git(
        repo_path,
        &[
            "branch",
            "--format=%(refname:short)",
            "--merged",
            default_branch,
        ],
    )
    .map(|output| output.lines().map(ToString::to_string).collect())
    .unwrap_or_default()
}

fn ahead_behind(repo_path: &Path, branch: &str, upstream: &str) -> (u32, u32) {
    let spec = format!("{branch}...{upstream}");
    let Ok(output) = run_git(repo_path, &["rev-list", "--left-right", "--count", &spec]) else {
        return (0, 0);
    };

    let mut parts = output.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (ahead, behind)
}

fn last_commit(path: &Path) -> Option<CommitSummary> {
    last_commit_for_ref(path, "HEAD")
}

fn last_commit_for_ref(path: &Path, ref_name: &str) -> Option<CommitSummary> {
    let output = run_git(
        path,
        &["log", "-1", "--format=%H%x09%h%x09%s%x09%cr", ref_name],
    )
    .ok()?;
    let parts = output.split('\t').collect::<Vec<_>>();
    if parts.len() < 4 {
        return None;
    }

    Some(CommitSummary {
        sha: parts[0].to_string(),
        short_sha: parts[1].to_string(),
        subject: parts[2].to_string(),
        relative_time: parts[3].to_string(),
    })
}

fn git_ok(path: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn worktree_command_root(worktree_path: &Path) -> Result<PathBuf, String> {
    let current = discover_repository(worktree_path)?;
    let target = worktree_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let worktrees = scan_worktrees(&current)?;

    Ok(worktrees
        .into_iter()
        .find_map(|worktree| {
            let path = PathBuf::from(worktree.path);
            let canonical = path.canonicalize().ok()?;
            (canonical != target).then_some(path)
        })
        .unwrap_or(current))
}

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn result(summary: &str, root: &Path, args: &[&str]) -> CommandResult {
    CommandResult {
        ok: true,
        summary: summary.to_string(),
        command: git_command(root, args),
        changed_paths: vec![root.to_string_lossy().to_string()],
    }
}

fn git_command(root: &Path, args: &[&str]) -> String {
    format!(
        "git -C {} {}",
        shell_path(root),
        args.iter()
            .map(|arg| shell_arg(arg))
            .collect::<Vec<_>>()
            .join(" ")
    )
}

fn shell_path(path: &Path) -> String {
    shell_arg(path.to_string_lossy().as_ref())
}

fn shell_arg(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[derive(Default)]
struct PartialWorktree {
    path: Option<String>,
    branch: Option<String>,
    head_sha: Option<String>,
    detached: bool,
    locked: bool,
    prunable: bool,
}

impl PartialWorktree {
    fn finish(self) -> Result<WorktreeSnapshot, String> {
        let path = self
            .path
            .ok_or_else(|| "worktree path missing".to_string())?;
        let path_buf = PathBuf::from(&path);
        Ok(WorktreeSnapshot {
            path,
            branch: self.branch,
            head_sha: self.head_sha,
            detached: self.detached,
            locked: self.locked,
            prunable: self.prunable,
            dirty_summary: dirty_summary(&path_buf)?,
            last_commit: last_commit(&path_buf),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{git, SandboxRepo};

    #[test]
    fn scans_repository_worktree_branch_and_dirty_state() {
        let sandbox = SandboxRepo::create();
        let repo = RepositoryRecord::from_path(&sandbox.root);

        let snapshot = scan_repository(&repo).unwrap();
        let worktree_path = sandbox.worktree.canonicalize().unwrap();

        assert_eq!(snapshot.repo.display_name, "repo");
        assert!(snapshot
            .worktrees
            .iter()
            .any(|worktree| Path::new(&worktree.path).canonicalize().unwrap() == worktree_path));
        assert!(snapshot
            .local_branches
            .iter()
            .any(|branch| branch.name == "feature/demo"));

        let dirty_worktree = snapshot
            .worktrees
            .iter()
            .find(|worktree| Path::new(&worktree.path).canonicalize().unwrap() == worktree_path)
            .unwrap();
        assert_eq!(dirty_worktree.dirty_summary.untracked, 1);
    }

    #[test]
    fn force_removes_dirty_worktree_and_branch() {
        let sandbox = SandboxRepo::create();

        let worktree_result = delete_worktree(&sandbox.worktree, true).unwrap();
        assert!(worktree_result.ok);
        assert!(!sandbox.worktree.exists());

        let branch_result = delete_branch(&sandbox.root, "feature/demo", true).unwrap();
        assert!(branch_result.ok);

        let branches = run_git(&sandbox.root, &["branch", "--format=%(refname:short)"]).unwrap();
        assert!(!branches.lines().any(|branch| branch == "feature/demo"));
    }

    #[test]
    fn rejects_non_git_directories() {
        let temp = tempfile::tempdir().unwrap();

        let error = discover_repository(temp.path()).unwrap_err();

        assert!(error.contains("rev-parse"));
    }

    #[test]
    fn scans_stashes() {
        let sandbox = SandboxRepo::create();
        git(
            &sandbox.worktree,
            &["stash", "push", "-u", "-m", "sandbox stash"],
        );

        let snapshot = scan_repository(&RepositoryRecord::from_path(&sandbox.root)).unwrap();

        assert!(snapshot
            .stashes
            .iter()
            .any(|stash| stash.message.contains("sandbox stash")));
    }

    #[test]
    fn creates_worktree_with_new_branch() {
        let sandbox = SandboxRepo::create();
        let task_worktree = sandbox.root.parent().unwrap().join("repo-task");

        let result = create_worktree(&sandbox.root, "feature/task", &task_worktree, true).unwrap();

        assert!(result.ok);
        assert!(task_worktree.exists());
        let branches = run_git(&sandbox.root, &["branch", "--format=%(refname:short)"]).unwrap();
        assert!(branches.lines().any(|branch| branch == "feature/task"));
    }

    #[test]
    fn counts_dirty_status_buckets() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        std::fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.email", "sandbox@example.test"]);
        git(&root, &["config", "user.name", "Sandbox"]);
        for file in ["modified.txt", "deleted.txt", "renamed.txt"] {
            std::fs::write(root.join(file), "base\n").unwrap();
        }
        git(&root, &["add", "."]);
        git(&root, &["commit", "-m", "base"]);

        std::fs::write(root.join("modified.txt"), "changed\n").unwrap();
        std::fs::write(root.join("added.txt"), "added\n").unwrap();
        git(&root, &["add", "added.txt"]);
        std::fs::remove_file(root.join("deleted.txt")).unwrap();
        git(&root, &["mv", "renamed.txt", "renamed-new.txt"]);
        std::fs::write(root.join("untracked.txt"), "untracked\n").unwrap();

        let summary = dirty_summary(&root).unwrap();

        assert_eq!(summary.modified, 1);
        assert_eq!(summary.added, 1);
        assert_eq!(summary.deleted, 1);
        assert_eq!(summary.renamed, 1);
        assert_eq!(summary.untracked, 1);
    }
}
