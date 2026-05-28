use crate::models::{
    BranchSnapshot, CommandResult, CommitListItem, CommitPage, CommitSummary, DirtySummary,
    FileChangeItem, RepositoryRecord, RepositorySnapshot, StashSnapshot, WorktreeSnapshot,
};
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

pub struct MergedBranchCleanupCandidates {
    pub root: PathBuf,
    pub target_branch: String,
    pub target_ref: String,
    pub deletable: Vec<String>,
    pub checked_out: Vec<String>,
    pub protected: Vec<String>,
}

pub struct BranchContainmentAudit {
    pub root: PathBuf,
    pub target_branch: String,
    pub target_ref: String,
    pub outside_branches: Vec<String>,
    pub protected: Vec<String>,
}

pub fn discover_repository(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.to_string_lossy()));
    }

    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    let output = run_git(&canonical, &["rev-parse", "--show-toplevel"])?;
    Ok(PathBuf::from(output.trim()))
}

pub fn discover_repository_owner(path: &Path) -> Result<PathBuf, String> {
    let root = discover_repository(path)?;
    let common_dir = run_git(&root, &["rev-parse", "--git-common-dir"])?;
    let common_path = absolute_git_path(&root, common_dir.trim())?;

    if common_path.file_name().and_then(|name| name.to_str()) == Some(".git") {
        if let Some(parent) = common_path.parent() {
            return parent.canonicalize().map_err(|error| error.to_string());
        }
    }

    root.canonicalize().map_err(|error| error.to_string())
}

pub fn discover_repository_inputs(path: &Path) -> Result<Vec<PathBuf>, String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.to_string_lossy()));
    }

    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    let mut child_roots = Vec::new();
    let mut seen = HashSet::new();

    if canonical.is_dir() {
        let mut children = canonical
            .read_dir()
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        children.sort_by_key(|entry| entry.file_name());

        for entry in children {
            let child = entry.path();
            if !child.is_dir() {
                continue;
            }

            let Ok(child_canonical) = child.canonicalize() else {
                continue;
            };
            let Ok(root) = discover_repository(&child_canonical) else {
                continue;
            };
            let Ok(root_canonical) = root.canonicalize() else {
                continue;
            };

            if root_canonical == child_canonical {
                let Ok(owner_root) = discover_repository_owner(&child_canonical) else {
                    continue;
                };
                if seen.insert(owner_root.clone()) {
                    child_roots.push(owner_root);
                }
            }
        }
    }

    if !child_roots.is_empty() {
        return Ok(child_roots);
    }

    discover_repository_owner(&canonical).map(|root| vec![root])
}

pub fn normalize_repository_record(repo: &RepositoryRecord) -> Result<RepositoryRecord, String> {
    let root = discover_repository_owner(Path::new(&repo.path))?;
    let mut normalized = repo.clone();
    let root_record = RepositoryRecord::from_path(&root);
    normalized.id = root_record.id;
    normalized.path = root_record.path;
    normalized.display_name = root_record.display_name;
    Ok(normalized)
}

pub fn scan_repository(repo: &RepositoryRecord) -> Result<RepositorySnapshot, String> {
    let normalized_repo = normalize_repository_record(repo)?;
    let root = PathBuf::from(&normalized_repo.path);

    let worktrees = scan_worktrees(&root)?;
    let default_branch = default_branch(&root);
    let merged = merged_branches(&root, default_branch.as_deref());
    let local_branches = scan_branches(&root, false, &merged)?;
    let remote_branches = scan_upstream_remote_branches(&root, &local_branches)?;
    let stashes = scan_stashes(&root)?;

    Ok(RepositorySnapshot {
        repo: normalized_repo,
        default_branch,
        worktrees,
        local_branches,
        remote_branches,
        stashes,
        diagnostics: Vec::new(),
    })
}

fn absolute_git_path(root: &Path, git_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(git_path);
    let full_path = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };

    full_path.canonicalize().map_err(|error| error.to_string())
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
        } else if let Some(reason) = field.strip_prefix("prunable") {
            current.prunable = true;
            current.prunable_reason = non_empty(reason.trim());
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

pub fn delete_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    force: bool,
) -> Result<CommandResult, String> {
    let root = discover_repository_owner(repo_path)?;
    if same_worktree_path(root.to_string_lossy().as_ref(), worktree_path) {
        return Err(
            "Main working tree cannot be removed by git worktree remove. Remove the repository from the project list instead."
                .to_string(),
        );
    }

    let worktrees = scan_worktrees(&root)?;
    let Some(target) = worktrees
        .iter()
        .find(|worktree| same_worktree_path(&worktree.path, worktree_path))
    else {
        return Err(format!(
            "Worktree is not registered by Git: {}",
            worktree_path.to_string_lossy()
        ));
    };

    if target.prunable {
        let args = vec!["worktree", "prune", "--expire", "now"];
        run_git(&root, &args)?;
        return Ok(CommandResult {
            ok: true,
            summary: "Pruned stale worktree metadata".to_string(),
            command: git_command(&root, &args),
            changed_paths: vec![worktree_path.to_string_lossy().to_string()],
        });
    }

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

pub fn checkout_branch(repo_path: &Path, branch: &str) -> Result<CommandResult, String> {
    let root = discover_repository_owner(repo_path)?;
    let args = vec!["checkout", branch];
    run_git(&root, &args)?;
    Ok(result(&format!("Checked out {branch}"), &root, &args))
}

pub fn fast_forward_branch(repo_path: &Path, branch: &str) -> Result<CommandResult, String> {
    let root = discover_repository_owner(repo_path)?;
    let branch_ref = format!("refs/heads/{branch}");
    run_git(&root, &["show-ref", "--verify", "--quiet", &branch_ref])?;

    let upstream = run_git(
        &root,
        &["for-each-ref", "--format=%(upstream:short)", &branch_ref],
    )?
    .trim()
    .to_string();
    if upstream.is_empty() {
        return Err(format!("Branch has no upstream: {branch}"));
    }

    let fetch_args = vec!["fetch", "--all", "--prune"];
    run_git(&root, &fetch_args)?;
    if !git_ok(&root, &["merge-base", "--is-ancestor", branch, &upstream]) {
        return Err(format!(
            "{branch} cannot fast-forward to {upstream}; it has local commits or diverged history"
        ));
    }

    let worktree = scan_worktrees(&root)?
        .into_iter()
        .find(|worktree| worktree.branch.as_deref() == Some(branch));

    if let Some(worktree) = worktree {
        let worktree_path = PathBuf::from(worktree.path);
        let merge_args = vec!["merge", "--ff-only", upstream.as_str()];
        run_git(&worktree_path, &merge_args)?;
        return Ok(CommandResult {
            ok: true,
            summary: format!("Fast-forwarded {branch} to {upstream}"),
            command: format!(
                "{} && {}",
                git_command(&root, &fetch_args),
                git_command(&worktree_path, &merge_args)
            ),
            changed_paths: vec![worktree_path.to_string_lossy().to_string()],
        });
    }

    let update_args = vec!["branch", "--force", branch, upstream.as_str()];
    run_git(&root, &update_args)?;
    Ok(CommandResult {
        ok: true,
        summary: format!("Fast-forwarded {branch} to {upstream}"),
        command: format!(
            "{} && {}",
            git_command(&root, &fetch_args),
            git_command(&root, &update_args)
        ),
        changed_paths: vec![root.to_string_lossy().to_string()],
    })
}

pub fn merged_branch_cleanup_candidates(
    repo_path: &Path,
) -> Result<MergedBranchCleanupCandidates, String> {
    let root = discover_repository_owner(repo_path)?;
    let target = resolve_cleanup_target(&root)?;

    let merged = run_git(
        &root,
        &[
            "branch",
            "--format=%(refname:short)",
            "--merged",
            &target.ref_name,
        ],
    )?;
    let checked_out_branches = scan_worktrees(&root)?
        .into_iter()
        .filter_map(|worktree| worktree.branch)
        .collect::<HashSet<_>>();
    let protected_names = HashSet::from([
        "main".to_string(),
        "master".to_string(),
        "test".to_string(),
        "prerelease".to_string(),
    ]);
    let mut deletable = Vec::new();
    let mut checked_out = Vec::new();
    let mut protected = Vec::new();

    for branch in merged
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
    {
        if protected_names.contains(branch) {
            protected.push(branch.to_string());
        } else if checked_out_branches.contains(branch) {
            checked_out.push(branch.to_string());
        } else {
            deletable.push(branch.to_string());
        }
    }

    deletable.sort();
    deletable.dedup();
    checked_out.sort();
    checked_out.dedup();
    protected.sort();
    protected.dedup();

    Ok(MergedBranchCleanupCandidates {
        root,
        target_branch: target.branch,
        target_ref: target.ref_name,
        deletable,
        checked_out,
        protected,
    })
}

pub fn cleanup_merged_branches(repo_path: &Path) -> Result<CommandResult, String> {
    let candidates = merged_branch_cleanup_candidates(repo_path)?;
    let target_display = remote_ref_display(&candidates.target_ref);
    if candidates.deletable.is_empty() {
        return Ok(CommandResult {
            ok: true,
            summary: format!("No local branches merged into {target_display} to delete"),
            command: "No branches to delete".to_string(),
            changed_paths: Vec::new(),
        });
    }

    let mut args = vec![OsString::from("branch"), OsString::from("-D")];
    args.extend(candidates.deletable.iter().map(OsString::from));
    run_git_os(&candidates.root, &args)?;

    Ok(CommandResult {
        ok: true,
        summary: format!(
            "Deleted {} local branches merged into {target_display}",
            candidates.deletable.len()
        ),
        command: cleanup_target_fetch_command(&candidates.root, &candidates.target_ref)
            .map(|fetch_command| {
                format!(
                    "{} && {}",
                    fetch_command,
                    git_command_os(&candidates.root, &args)
                )
            })
            .unwrap_or_else(|| git_command_os(&candidates.root, &args)),
        changed_paths: candidates.deletable,
    })
}

pub fn cleanup_selected_merged_branches(
    repo_path: &Path,
    branches: &[String],
) -> Result<CommandResult, String> {
    let candidates = merged_branch_cleanup_candidates(repo_path)?;
    let selected = normalize_branch_selection(branches);
    let target_display = remote_ref_display(&candidates.target_ref);
    if selected.is_empty() {
        return Ok(CommandResult {
            ok: true,
            summary: "No branches selected".to_string(),
            command: "No branches selected".to_string(),
            changed_paths: Vec::new(),
        });
    }

    let allowed = candidates.deletable.iter().cloned().collect::<HashSet<_>>();
    let blocked = selected
        .iter()
        .filter(|branch| !allowed.contains(*branch))
        .cloned()
        .collect::<Vec<_>>();
    if !blocked.is_empty() {
        return Err(format!(
            "Selected branches are no longer safe to delete: {}",
            blocked.join(", ")
        ));
    }

    delete_branch_names(
        &candidates.root,
        &selected,
        true,
        format!(
            "Deleted {} selected branches merged into {target_display}",
            selected.len()
        ),
        cleanup_target_fetch_command(&candidates.root, &candidates.target_ref),
    )
}

pub fn delete_selected_branches(
    repo_path: &Path,
    branches: &[String],
    force: bool,
) -> Result<CommandResult, String> {
    let root = discover_repository_owner(repo_path)?;
    let selected = normalize_branch_selection(branches);
    if selected.is_empty() {
        return Ok(CommandResult {
            ok: true,
            summary: "No branches selected".to_string(),
            command: "No branches selected".to_string(),
            changed_paths: Vec::new(),
        });
    }

    validate_deletable_branches(&root, &selected)?;
    delete_branch_names(
        &root,
        &selected,
        force,
        format!("Deleted {} selected local branches", selected.len()),
        None,
    )
}

fn delete_branch_names(
    root: &Path,
    branches: &[String],
    force: bool,
    summary: String,
    command_prefix: Option<String>,
) -> Result<CommandResult, String> {
    let flag = if force { "-D" } else { "-d" };
    let mut args = vec![OsString::from("branch"), OsString::from(flag)];
    args.extend(branches.iter().map(OsString::from));
    run_git_os(root, &args)?;

    let delete_command = git_command_os(root, &args);
    let command = command_prefix
        .map(|prefix| format!("{prefix} && {delete_command}"))
        .unwrap_or(delete_command);

    Ok(CommandResult {
        ok: true,
        summary,
        command,
        changed_paths: branches.to_vec(),
    })
}

fn validate_deletable_branches(root: &Path, branches: &[String]) -> Result<(), String> {
    let protected_names = protected_branch_names();
    let checked_out_branches = scan_worktrees(root)?
        .into_iter()
        .filter_map(|worktree| worktree.branch)
        .collect::<HashSet<_>>();
    let local_branches = run_git(root, &["branch", "--format=%(refname:short)"])?
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(ToString::to_string)
        .collect::<HashSet<_>>();
    let mut blockers = Vec::new();

    for branch in branches {
        if protected_names.contains(branch) {
            blockers.push(format!("{branch} is protected"));
        } else if checked_out_branches.contains(branch) {
            blockers.push(format!("{branch} is checked out by a worktree"));
        } else if !local_branches.contains(branch) {
            blockers.push(format!("{branch} is not a local branch"));
        }
    }

    if blockers.is_empty() {
        Ok(())
    } else {
        Err(blockers.join("; "))
    }
}

fn normalize_branch_selection(branches: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    branches
        .iter()
        .map(|branch| branch.trim())
        .filter(|branch| !branch.is_empty())
        .filter(|branch| seen.insert((*branch).to_string()))
        .map(ToString::to_string)
        .collect()
}

pub fn branches_outside_default_target(repo_path: &Path) -> Result<BranchContainmentAudit, String> {
    let root = discover_repository_owner(repo_path)?;
    let target = resolve_cleanup_target(&root)?;
    let branches = run_git(
        &root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads",
        ],
    )?;
    let protected_names = protected_branch_names();
    let mut outside_branches = Vec::new();
    let mut protected = Vec::new();

    for branch in branches
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
    {
        if protected_names.contains(branch) {
            protected.push(branch.to_string());
            continue;
        }

        if !git_ok(
            &root,
            &["merge-base", "--is-ancestor", branch, &target.ref_name],
        ) {
            outside_branches.push(branch.to_string());
        }
    }

    protected.sort();
    protected.dedup();

    Ok(BranchContainmentAudit {
        root,
        target_branch: target.branch,
        target_ref: target.ref_name,
        outside_branches,
        protected,
    })
}

fn protected_branch_names() -> HashSet<String> {
    HashSet::from([
        "main".to_string(),
        "master".to_string(),
        "test".to_string(),
        "prerelease".to_string(),
    ])
}

struct CleanupTarget {
    branch: String,
    ref_name: String,
}

fn resolve_cleanup_target(root: &Path) -> Result<CleanupTarget, String> {
    if run_git(root, &["remote", "get-url", "origin"]).is_ok() {
        let branch = remote_default_branch(root)?;
        let ref_name = fetch_cleanup_target(root, &branch)?;
        return Ok(CleanupTarget { branch, ref_name });
    }

    let branch =
        default_branch(root).ok_or_else(|| "Unable to resolve default branch".to_string())?;
    let ref_name = format!("refs/heads/{branch}");
    run_git(root, &["show-ref", "--verify", "--quiet", &ref_name])?;
    Ok(CleanupTarget { branch, ref_name })
}

fn remote_default_branch(root: &Path) -> Result<String, String> {
    let output = run_git(root, &["ls-remote", "--symref", "origin", "HEAD"])?;
    output
        .lines()
        .find_map(|line| {
            line.strip_prefix("ref: refs/heads/")
                .and_then(|value| value.split_whitespace().next())
                .map(ToString::to_string)
        })
        .ok_or_else(|| "Unable to resolve origin default branch".to_string())
}

fn fetch_cleanup_target(root: &Path, target_branch: &str) -> Result<String, String> {
    let target_ref = format!("refs/remotes/origin/{target_branch}");
    let refspec = format!("refs/heads/{target_branch}:{target_ref}");
    run_git(root, &["fetch", "origin", &refspec, "--prune"])?;
    run_git(root, &["show-ref", "--verify", "--quiet", &target_ref])?;
    Ok(target_ref)
}

pub(crate) fn cleanup_target_fetch_command(root: &Path, target_ref: &str) -> Option<String> {
    target_ref
        .strip_prefix("refs/remotes/origin/")
        .map(|target_branch| {
            let refspec = format!("refs/heads/{target_branch}:{target_ref}");
            git_command(root, &["fetch", "origin", &refspec, "--prune"])
        })
}

fn remote_ref_display(ref_name: &str) -> String {
    ref_name
        .strip_prefix("refs/remotes/")
        .unwrap_or(ref_name)
        .to_string()
}

pub fn list_branch_commits(
    repo_path: &Path,
    branch: &str,
    offset: usize,
    limit: usize,
) -> Result<CommitPage, String> {
    let root = discover_repository(repo_path)?;
    let limit = limit.clamp(1, 100);
    let branch_revision = format!("{branch}^{{commit}}");
    if !git_ok(
        &root,
        &["rev-parse", "--verify", "--quiet", &branch_revision],
    ) {
        if is_remote_tracking_branch_name(&root, branch) {
            return Ok(CommitPage {
                commits: Vec::new(),
                has_more: false,
            });
        }

        return Err(format!("Branch not found: {branch}"));
    }

    let fetch_count = limit + 1;
    let format = "%H%x1f%h%x1f%an%x1f%at%x1f%cr%x1f%s";
    let args = vec![
        OsString::from("log"),
        OsString::from(format!("--format={format}")),
        OsString::from(format!("--skip={offset}")),
        OsString::from(format!("--max-count={fetch_count}")),
        OsString::from(branch),
        OsString::from("--"),
    ];
    let output = run_git_os(&root, &args)?;
    let mut commits = output
        .lines()
        .filter_map(commit_list_item)
        .collect::<Vec<_>>();
    let has_more = commits.len() > limit;
    commits.truncate(limit);

    Ok(CommitPage { commits, has_more })
}

fn is_remote_tracking_branch_name(root: &Path, branch: &str) -> bool {
    run_git(root, &["remote"])
        .map(|output| {
            output
                .lines()
                .map(str::trim)
                .filter(|remote| !remote.is_empty())
                .any(|remote| branch.starts_with(&format!("{remote}/")))
        })
        .unwrap_or(false)
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

pub fn list_worktree_changes(worktree_path: &Path) -> Result<Vec<FileChangeItem>, String> {
    let root = discover_repository(worktree_path)?;
    let output = run_git(&root, &["status", "--porcelain=v1", "-z"])?;
    Ok(parse_file_changes(&output))
}

fn parse_file_changes(output: &str) -> Vec<FileChangeItem> {
    let fields = output
        .split('\0')
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    let mut changes = Vec::new();
    let mut index = 0;

    while index < fields.len() {
        let field = fields[index];
        if field.len() < 3 {
            index += 1;
            continue;
        }

        let code = &field[0..2];
        let path = field[3..].to_string();
        let index_code = code.chars().next().unwrap_or(' ');
        let worktree_code = code.chars().nth(1).unwrap_or(' ');
        let previous_path = if matches!(index_code, 'R' | 'C') {
            index += 1;
            fields.get(index).map(|path| (*path).to_string())
        } else {
            None
        };

        changes.push(FileChangeItem {
            path,
            previous_path,
            index_status: status_name(index_code).to_string(),
            worktree_status: status_name(worktree_code).to_string(),
            status: change_status(code),
        });

        index += 1;
    }

    changes
}

fn change_status(code: &str) -> String {
    if code == "??" {
        return "Untracked".to_string();
    }
    if code.contains('U') || code == "AA" || code == "DD" {
        return "Conflicted".to_string();
    }

    let index_status = code.chars().next().unwrap_or(' ');
    let worktree_status = code.chars().nth(1).unwrap_or(' ');
    let mut parts = Vec::new();

    if index_status != ' ' {
        parts.push(format!(
            "Staged {}",
            status_name(index_status).to_lowercase()
        ));
    }
    if worktree_status != ' ' {
        parts.push(format!(
            "Working {}",
            status_name(worktree_status).to_lowercase()
        ));
    }

    if parts.is_empty() {
        "Changed".to_string()
    } else {
        parts.join(" + ")
    }
}

fn status_name(status: char) -> &'static str {
    match status {
        'M' => "Modified",
        'A' => "Added",
        'D' => "Deleted",
        'R' => "Renamed",
        'C' => "Copied",
        'U' => "Conflict",
        '?' => "Untracked",
        '!' => "Ignored",
        _ => "None",
    }
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
    let refs = vec![if remote { "refs/remotes" } else { "refs/heads" }.to_string()];
    scan_branch_refs(repo_path, remote, merged, &refs)
}

fn scan_upstream_remote_branches(
    repo_path: &Path,
    local_branches: &[BranchSnapshot],
) -> Result<Vec<BranchSnapshot>, String> {
    let upstream_names = local_branches
        .iter()
        .filter_map(|branch| branch.upstream.as_ref())
        .cloned()
        .collect::<HashSet<_>>();
    let mut refs = local_branches
        .iter()
        .filter_map(|branch| branch.upstream.as_ref())
        .map(|upstream| format!("refs/remotes/{upstream}"))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    refs.sort();

    if refs.is_empty() {
        return Ok(Vec::new());
    }

    Ok(scan_branch_refs(repo_path, true, &HashSet::new(), &refs)?
        .into_iter()
        .filter(|branch| upstream_names.contains(&branch.name))
        .collect())
}

fn scan_branch_refs(
    repo_path: &Path,
    remote: bool,
    merged: &HashSet<String>,
    refs: &[String],
) -> Result<Vec<BranchSnapshot>, String> {
    let format = "%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(worktreepath)%1f%(creatordate:unix)%1f%(upstream:track)%1f%(objectname)%1f%(objectname:short)%1f%(contents:subject)%1f%(committerdate:relative)";
    let mut args = vec![
        OsString::from("for-each-ref"),
        OsString::from(format!("--format={format}")),
    ];
    args.extend(
        refs.iter()
            .map(|ref_name| OsString::from(ref_name.as_str())),
    );
    let output = run_git_os(repo_path, &args)?;
    let mut branches = Vec::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let parts = line.split('\x1f').collect::<Vec<_>>();
        if parts.len() < 10 {
            continue;
        }

        let full_ref = parts[0].to_string();
        let name = parts[1].to_string();
        if remote && name.ends_with("/HEAD") {
            continue;
        }

        let upstream = non_empty(parts[2]);
        let (ahead, behind) = parse_tracking(parts[5]);

        branches.push(BranchSnapshot {
            name: name.clone(),
            full_ref,
            created_at: non_empty(parts[4]).unwrap_or_else(|| "0".to_string()),
            upstream,
            ahead,
            behind,
            is_merged_to_default: merged.contains(&name),
            worktree_path: non_empty(parts[3]),
            last_commit: commit_summary(parts[6], parts[7], parts[8], parts[9]),
            is_remote: remote,
        });
    }

    Ok(branches)
}

fn scan_stashes(repo_path: &Path) -> Result<Vec<StashSnapshot>, String> {
    let output = run_git(repo_path, &["stash", "list", "--format=%gd%x09%ct%x09%gs"])?;
    Ok(output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let id = parts.next()?;
            let created_at = parts.next()?;
            let message = parts.next()?;
            Some(StashSnapshot {
                id: id.to_string(),
                created_at: created_at.to_string(),
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

fn last_commit(path: &Path) -> Option<CommitSummary> {
    last_commit_for_ref(path, "HEAD")
}

fn commit_summary(
    sha: &str,
    short_sha: &str,
    subject: &str,
    relative_time: &str,
) -> Option<CommitSummary> {
    (!sha.is_empty()).then(|| CommitSummary {
        sha: sha.to_string(),
        short_sha: short_sha.to_string(),
        subject: subject.to_string(),
        relative_time: relative_time.to_string(),
    })
}

fn commit_list_item(line: &str) -> Option<CommitListItem> {
    let mut parts = line.splitn(6, '\x1f');
    Some(CommitListItem {
        sha: parts.next()?.to_string(),
        short_sha: parts.next()?.to_string(),
        author_name: parts.next()?.to_string(),
        committed_at: parts.next()?.to_string(),
        relative_time: parts.next()?.to_string(),
        subject: parts.next()?.to_string(),
    })
}

fn parse_tracking(value: &str) -> (u32, u32) {
    let mut ahead = 0;
    let mut behind = 0;
    let value = value.trim().trim_start_matches('[').trim_end_matches(']');

    for part in value.split(',').map(str::trim) {
        if let Some(count) = part.strip_prefix("ahead ") {
            ahead = count.parse().unwrap_or(0);
        }
        if let Some(count) = part.strip_prefix("behind ") {
            behind = count.parse().unwrap_or(0);
        }
    }

    (ahead, behind)
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

pub(crate) fn same_worktree_path(candidate: &str, target: &Path) -> bool {
    comparable_path(Path::new(candidate)) == comparable_path(target)
}

fn comparable_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }

    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if let Ok(canonical_parent) = parent.canonicalize() {
            return canonical_parent.join(name);
        }
    }

    path.to_path_buf()
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

fn git_command_os(root: &Path, args: &[OsString]) -> String {
    format!(
        "git -C {} {}",
        shell_path(root),
        args.iter()
            .map(|arg| shell_arg(arg.to_string_lossy().as_ref()))
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
    prunable_reason: Option<String>,
}

impl PartialWorktree {
    fn finish(self) -> Result<WorktreeSnapshot, String> {
        let path = self
            .path
            .ok_or_else(|| "worktree path missing".to_string())?;
        let path_buf = PathBuf::from(&path);
        let path_exists = path_buf.exists();
        let mut scan_error = if self.prunable {
            Some(match &self.prunable_reason {
                Some(reason) => format!("Git marks this worktree as prunable: {reason}"),
                None => "Git marks this worktree as prunable".to_string(),
            })
        } else if !path_exists {
            Some("Worktree path does not exist".to_string())
        } else {
            None
        };

        let dirty_summary = if path_exists && !self.prunable {
            match dirty_summary(&path_buf) {
                Ok(summary) => summary,
                Err(error) => {
                    scan_error = Some(error);
                    DirtySummary::default()
                }
            }
        } else {
            DirtySummary::default()
        };
        let last_commit = if path_exists && !self.prunable {
            last_commit(&path_buf)
        } else {
            None
        };

        Ok(WorktreeSnapshot {
            path,
            branch: self.branch,
            head_sha: self.head_sha,
            created_at: path_created_at(&path_buf),
            detached: self.detached,
            locked: self.locked,
            prunable: self.prunable,
            scan_error,
            dirty_summary,
            last_commit,
        })
    }
}

fn path_created_at(path: &Path) -> String {
    path.metadata()
        .and_then(|metadata| metadata.created())
        .ok()
        .and_then(|created| created.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{git, SandboxRepo};
    use std::path::PathBuf;

    fn setup_origin_target(sandbox: &SandboxRepo, target_branch: &str) -> PathBuf {
        let remote = sandbox.root.parent().unwrap().join("origin.git");
        std::fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare"]);
        if run_git(&sandbox.root, &["remote", "get-url", "origin"]).is_err() {
            git(
                &sandbox.root,
                &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
            );
        }
        if target_branch != "main" {
            git(&sandbox.root, &["branch", target_branch]);
        }
        let refspec = format!("{target_branch}:{target_branch}");
        git(&sandbox.root, &["push", "origin", refspec.as_str()]);
        let head_ref = format!("refs/heads/{target_branch}");
        git(&remote, &["symbolic-ref", "HEAD", head_ref.as_str()]);
        remote
    }

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
        assert!(dirty_worktree.created_at.parse::<u64>().unwrap() > 0);
        assert!(dirty_worktree.scan_error.is_none());
        assert_eq!(dirty_worktree.dirty_summary.untracked, 1);

        let branch = snapshot
            .local_branches
            .iter()
            .find(|branch| branch.name == "feature/demo")
            .unwrap();
        assert!(branch.created_at.parse::<u64>().unwrap() > 0);
        assert_eq!(
            branch.last_commit.as_ref().unwrap().subject,
            "initial commit"
        );
    }

    #[test]
    fn parses_branch_tracking_status() {
        assert_eq!(parse_tracking("[ahead 3, behind 2]"), (3, 2));
        assert_eq!(parse_tracking("[behind 7]"), (0, 7));
        assert_eq!(parse_tracking("[ahead 5]"), (5, 0));
        assert_eq!(parse_tracking("[gone]"), (0, 0));
        assert_eq!(parse_tracking(""), (0, 0));
    }

    #[test]
    fn scans_only_remote_branches_used_by_local_upstreams() {
        let sandbox = SandboxRepo::create();
        let remote = sandbox.root.parent().unwrap().join("origin.git");
        std::fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare"]);
        git(
            &sandbox.root,
            &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
        );
        git(&sandbox.root, &["push", "origin", "main"]);
        git(&sandbox.worktree, &["push", "-u", "origin", "feature/demo"]);
        git(
            &sandbox.root,
            &["update-ref", "refs/remotes/origin/unrelated", "HEAD"],
        );

        let snapshot = scan_repository(&RepositoryRecord::from_path(&sandbox.root)).unwrap();
        let remote_names = snapshot
            .remote_branches
            .iter()
            .map(|branch| branch.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(remote_names, vec!["origin/feature/demo"]);
        assert_eq!(
            snapshot
                .local_branches
                .iter()
                .find(|branch| branch.name == "feature/demo")
                .unwrap()
                .upstream
                .as_deref(),
            Some("origin/feature/demo")
        );
    }

    #[test]
    fn force_removes_dirty_worktree_and_branch() {
        let sandbox = SandboxRepo::create();

        let worktree_result = delete_worktree(&sandbox.root, &sandbox.worktree, true).unwrap();
        assert!(worktree_result.ok);
        assert!(!sandbox.worktree.exists());

        let branch_result = delete_branch(&sandbox.root, "feature/demo", true).unwrap();
        assert!(branch_result.ok);

        let branches = run_git(&sandbox.root, &["branch", "--format=%(refname:short)"]).unwrap();
        assert!(!branches.lines().any(|branch| branch == "feature/demo"));
    }

    #[test]
    fn checks_out_local_branch_in_owner_repository() {
        let sandbox = SandboxRepo::create();
        git(&sandbox.root, &["branch", "checkout/target"]);

        let result = checkout_branch(&sandbox.root, "checkout/target").unwrap();

        assert!(result.ok);
        assert!(result.command.contains("checkout"));
        let current = run_git(&sandbox.root, &["branch", "--show-current"]).unwrap();
        assert_eq!(current.trim(), "checkout/target");
    }

    #[test]
    fn fast_forwards_tracked_branch_to_upstream() {
        let sandbox = SandboxRepo::create();
        let remote = setup_origin_target(&sandbox, "main");
        git(
            &sandbox.root,
            &["branch", "--set-upstream-to", "origin/main", "main"],
        );
        let remote_work = sandbox.root.parent().unwrap().join("remote-work");
        git(
            sandbox.root.parent().unwrap(),
            &[
                "clone",
                remote.to_string_lossy().as_ref(),
                remote_work.to_string_lossy().as_ref(),
            ],
        );
        git(&remote_work, &["config", "user.email", "sandbox@example.test"]);
        git(&remote_work, &["config", "user.name", "Sandbox"]);
        std::fs::write(remote_work.join("remote.txt"), "remote\n").unwrap();
        git(&remote_work, &["add", "remote.txt"]);
        git(&remote_work, &["commit", "-m", "remote update"]);
        git(&remote_work, &["push", "origin", "main"]);

        let result = fast_forward_branch(&sandbox.root, "main").unwrap();

        assert!(result.ok);
        assert!(result.command.contains("fetch"));
        assert!(result.command.contains("ff-only"));
        let local = run_git(&sandbox.root, &["rev-parse", "main"]).unwrap();
        let upstream = run_git(&sandbox.root, &["rev-parse", "origin/main"]).unwrap();
        assert_eq!(local, upstream);
    }

    #[test]
    fn refuses_to_remove_main_working_tree() {
        let sandbox = SandboxRepo::create();

        let error = delete_worktree(&sandbox.root, &sandbox.root, true).unwrap_err();

        assert!(error.contains("Main working tree cannot be removed"));
    }

    #[test]
    fn removes_prunable_missing_worktree_from_owner_repository() {
        let sandbox = SandboxRepo::create();
        std::fs::remove_dir_all(&sandbox.worktree).unwrap();

        let worktree_result = delete_worktree(&sandbox.root, &sandbox.worktree, false).unwrap();

        assert!(worktree_result.ok);
        let worktrees = scan_worktrees(&sandbox.root).unwrap();
        assert!(!worktrees
            .iter()
            .any(|worktree| same_worktree_path(&worktree.path, &sandbox.worktree)));
    }

    #[test]
    fn prunes_worktree_whose_path_exists_but_gitdir_is_invalid() {
        let sandbox = SandboxRepo::create();
        std::fs::remove_file(sandbox.worktree.join(".git")).unwrap();

        let worktree_result = delete_worktree(&sandbox.root, &sandbox.worktree, true).unwrap();

        assert!(worktree_result.ok);
        assert!(worktree_result.command.contains("prune"));
        assert!(worktree_result.command.contains("--expire"));
        let worktrees = scan_worktrees(&sandbox.root).unwrap();
        assert!(!worktrees
            .iter()
            .any(|worktree| same_worktree_path(&worktree.path, &sandbox.worktree)));
        assert!(sandbox.worktree.exists());
    }

    #[test]
    fn finds_local_branches_merged_into_cleanup_target() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");
        git(&sandbox.root, &["branch", "cleanup/merged"]);

        let candidates = merged_branch_cleanup_candidates(&sandbox.root).unwrap();

        assert_eq!(candidates.target_branch, "master");
        assert_eq!(candidates.target_ref, "refs/remotes/origin/master");
        assert_eq!(candidates.deletable, vec!["cleanup/merged"]);
        assert!(candidates.protected.iter().any(|branch| branch == "master"));
        assert!(candidates
            .checked_out
            .iter()
            .any(|branch| branch == "feature/demo"));
    }

    #[test]
    fn cleanup_uses_latest_origin_target_not_stale_local_branch() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");
        git(&sandbox.root, &["checkout", "master"]);
        std::fs::write(sandbox.root.join("local-only.txt"), "local\n").unwrap();
        git(&sandbox.root, &["add", "local-only.txt"]);
        git(&sandbox.root, &["commit", "-m", "local master only"]);
        git(&sandbox.root, &["branch", "cleanup/local-only"]);
        git(
            &sandbox.root,
            &["branch", "cleanup/merged", "origin/master"],
        );

        let candidates = merged_branch_cleanup_candidates(&sandbox.root).unwrap();

        assert_eq!(candidates.deletable, vec!["cleanup/merged"]);
        assert!(!candidates
            .deletable
            .iter()
            .any(|branch| branch == "cleanup/local-only"));
    }

    #[test]
    fn deletes_only_local_branches_merged_into_cleanup_target() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");
        git(&sandbox.root, &["branch", "cleanup/merged"]);

        let result = cleanup_merged_branches(&sandbox.root).unwrap();

        assert!(result.ok);
        assert!(result
            .changed_paths
            .iter()
            .any(|branch| branch == "cleanup/merged"));
        assert!(result.command.contains("refs/remotes/origin/master"));
        let branches = run_git(&sandbox.root, &["branch", "--format=%(refname:short)"]).unwrap();
        assert!(!branches.lines().any(|branch| branch == "cleanup/merged"));
        assert!(branches.lines().any(|branch| branch == "master"));
        assert!(branches.lines().any(|branch| branch == "feature/demo"));
    }

    #[test]
    fn deletes_only_selected_cleanup_branches_after_rechecking_target() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");
        git(&sandbox.root, &["branch", "cleanup/one"]);
        git(&sandbox.root, &["branch", "cleanup/two"]);

        let result =
            cleanup_selected_merged_branches(&sandbox.root, &["cleanup/one".to_string()]).unwrap();

        assert!(result.ok);
        assert_eq!(result.changed_paths, vec!["cleanup/one"]);
        assert!(result.command.contains("refs/remotes/origin/master"));
        let branches = run_git(&sandbox.root, &["branch", "--format=%(refname:short)"]).unwrap();
        assert!(!branches.lines().any(|branch| branch == "cleanup/one"));
        assert!(branches.lines().any(|branch| branch == "cleanup/two"));
    }

    #[test]
    fn rejects_selected_cleanup_branches_that_are_not_safe_candidates() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");

        let error = cleanup_selected_merged_branches(&sandbox.root, &["feature/demo".to_string()])
            .unwrap_err();

        assert!(error.contains("no longer safe"));
    }

    #[test]
    fn deletes_selected_local_branches() {
        let sandbox = SandboxRepo::create();
        git(&sandbox.root, &["branch", "audit/one"]);
        git(&sandbox.root, &["branch", "audit/two"]);

        let result =
            delete_selected_branches(&sandbox.root, &["audit/one".to_string()], true).unwrap();

        assert!(result.ok);
        assert_eq!(result.changed_paths, vec!["audit/one"]);
        let branches = run_git(&sandbox.root, &["branch", "--format=%(refname:short)"]).unwrap();
        assert!(!branches.lines().any(|branch| branch == "audit/one"));
        assert!(branches.lines().any(|branch| branch == "audit/two"));
    }

    #[test]
    fn rejects_protected_or_checked_out_selected_branches() {
        let sandbox = SandboxRepo::create();

        let error = delete_selected_branches(
            &sandbox.root,
            &["main".to_string(), "feature/demo".to_string()],
            true,
        )
        .unwrap_err();

        assert!(error.contains("main is protected"));
        assert!(error.contains("feature/demo is checked out"));
    }

    #[test]
    fn resolves_main_as_remote_default_cleanup_target() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "main");
        git(&sandbox.root, &["branch", "cleanup/merged"]);

        let candidates = merged_branch_cleanup_candidates(&sandbox.root).unwrap();

        assert_eq!(candidates.target_branch, "main");
        assert_eq!(candidates.target_ref, "refs/remotes/origin/main");
        assert_eq!(candidates.deletable, vec!["cleanup/merged"]);
    }

    #[test]
    fn finds_local_branches_outside_latest_default_target() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");
        git(&sandbox.root, &["checkout", "-b", "audit/outside"]);
        std::fs::write(sandbox.root.join("outside.txt"), "outside\n").unwrap();
        git(&sandbox.root, &["add", "outside.txt"]);
        git(&sandbox.root, &["commit", "-m", "outside branch"]);
        git(&sandbox.root, &["checkout", "main"]);
        git(
            &sandbox.root,
            &["branch", "audit/contained", "origin/master"],
        );

        let audit = branches_outside_default_target(&sandbox.root).unwrap();

        assert_eq!(audit.target_branch, "master");
        assert_eq!(audit.target_ref, "refs/remotes/origin/master");
        assert_eq!(audit.outside_branches, vec!["audit/outside"]);
        assert!(audit.protected.iter().any(|branch| branch == "master"));
    }

    #[test]
    fn branch_audit_uses_latest_origin_default_not_stale_local_target() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");
        git(&sandbox.root, &["checkout", "master"]);
        std::fs::write(sandbox.root.join("local-master.txt"), "local\n").unwrap();
        git(&sandbox.root, &["add", "local-master.txt"]);
        git(&sandbox.root, &["commit", "-m", "local master only"]);
        git(&sandbox.root, &["branch", "audit/local-master-only"]);

        let audit = branches_outside_default_target(&sandbox.root).unwrap();

        assert!(audit
            .outside_branches
            .iter()
            .any(|branch| branch == "audit/local-master-only"));
    }

    #[test]
    fn lists_branch_commits_by_page() {
        let sandbox = SandboxRepo::create();
        std::fs::write(sandbox.root.join("second.txt"), "second\n").unwrap();
        git(&sandbox.root, &["add", "second.txt"]);
        git(&sandbox.root, &["commit", "-m", "second commit"]);

        let first_page = list_branch_commits(&sandbox.root, "main", 0, 1).unwrap();
        assert_eq!(first_page.commits.len(), 1);
        assert!(first_page.has_more);
        assert_eq!(first_page.commits[0].subject, "second commit");
        assert_eq!(first_page.commits[0].author_name, "Sandbox");

        let next_page = list_branch_commits(&sandbox.root, "main", 1, 10).unwrap();
        assert_eq!(next_page.commits.len(), 1);
        assert!(!next_page.has_more);
        assert_eq!(next_page.commits[0].subject, "initial commit");
    }

    #[test]
    fn missing_remote_tracking_branch_commit_list_is_empty() {
        let sandbox = SandboxRepo::create();
        let remote = sandbox.root.parent().unwrap().join("origin.git");
        std::fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare"]);
        git(
            &sandbox.root,
            &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
        );

        let page = list_branch_commits(&sandbox.root, "origin/missing", 0, 30).unwrap();

        assert!(page.commits.is_empty());
        assert!(!page.has_more);
    }

    #[test]
    fn missing_local_branch_commit_list_reports_not_found() {
        let sandbox = SandboxRepo::create();

        let error = list_branch_commits(&sandbox.root, "missing-local", 0, 30).unwrap_err();

        assert_eq!(error, "Branch not found: missing-local");
    }

    #[test]
    fn rejects_non_git_directories() {
        let temp = tempfile::tempdir().unwrap();

        let error = discover_repository(temp.path()).unwrap_err();

        assert!(error.contains("rev-parse"));
    }

    #[test]
    fn discovers_direct_child_repositories_for_workspace_directory() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("workspace");
        let repo_a = workspace.join("repo-a");
        let repo_b = workspace.join("repo-b");
        let plain = workspace.join("plain");
        std::fs::create_dir_all(&repo_a).unwrap();
        std::fs::create_dir_all(&repo_b).unwrap();
        std::fs::create_dir_all(&plain).unwrap();
        git(&repo_a, &["init", "-b", "main"]);
        git(&repo_b, &["init", "-b", "main"]);

        let roots = discover_repository_inputs(&workspace).unwrap();
        let names = roots
            .iter()
            .map(|root| root.file_name().unwrap().to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["repo-a", "repo-b"]);
    }

    #[test]
    fn discovers_primary_repository_for_linked_worktree() {
        let sandbox = SandboxRepo::create();

        let worktree_root = discover_repository(&sandbox.worktree).unwrap();
        let owner_root = discover_repository_owner(&sandbox.worktree).unwrap();

        assert_eq!(worktree_root, sandbox.worktree.canonicalize().unwrap());
        assert_eq!(owner_root, sandbox.root.canonicalize().unwrap());
    }

    #[test]
    fn deduplicates_workspace_worktrees_by_primary_repository() {
        let sandbox = SandboxRepo::create();
        let workspace = sandbox.root.parent().unwrap();

        let roots = discover_repository_inputs(workspace).unwrap();

        assert_eq!(roots, vec![sandbox.root.canonicalize().unwrap()]);
    }

    #[test]
    fn scans_linked_worktree_record_as_primary_repository() {
        let sandbox = SandboxRepo::create();
        let repo = RepositoryRecord::from_path(&sandbox.worktree);

        let snapshot = scan_repository(&repo).unwrap();

        assert_eq!(snapshot.repo.display_name, "repo");
        assert_eq!(
            Path::new(&snapshot.repo.path).canonicalize().unwrap(),
            sandbox.root.canonicalize().unwrap()
        );
    }

    #[test]
    fn discovers_selected_repository_when_no_child_repositories_exist() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(repo.join("src")).unwrap();
        git(&repo, &["init", "-b", "main"]);

        let roots = discover_repository_inputs(&repo).unwrap();

        assert_eq!(roots, vec![repo.canonicalize().unwrap()]);
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
        assert!(snapshot.stashes[0].created_at.parse::<u64>().unwrap() > 0);
    }

    #[test]
    fn scans_prunable_worktree_whose_path_is_missing() {
        let sandbox = SandboxRepo::create();
        std::fs::remove_dir_all(&sandbox.worktree).unwrap();
        let output = run_git(&sandbox.root, &["worktree", "list", "--porcelain"]).unwrap();
        assert!(output.contains("prunable"));

        let snapshot = scan_repository(&RepositoryRecord::from_path(&sandbox.root)).unwrap();

        let stale = snapshot
            .worktrees
            .iter()
            .find(|worktree| worktree.branch.as_deref() == Some("feature/demo"))
            .unwrap();
        assert!(stale.prunable);
        assert!(stale
            .scan_error
            .as_deref()
            .unwrap()
            .contains("Git marks this worktree as prunable"));
        assert_eq!(stale.dirty_summary.total(), 0);
    }

    #[test]
    fn scans_prunable_worktree_whose_path_exists_but_gitdir_is_invalid() {
        let sandbox = SandboxRepo::create();
        std::fs::remove_file(sandbox.worktree.join(".git")).unwrap();
        let output = run_git(&sandbox.root, &["worktree", "list", "--porcelain"]).unwrap();
        assert!(output.contains("prunable"));
        assert!(sandbox.worktree.exists());

        let snapshot = scan_repository(&RepositoryRecord::from_path(&sandbox.root)).unwrap();

        let stale = snapshot
            .worktrees
            .iter()
            .find(|worktree| worktree.branch.as_deref() == Some("feature/demo"))
            .unwrap();
        assert!(stale.prunable);
        assert!(stale
            .scan_error
            .as_deref()
            .unwrap()
            .contains("Git marks this worktree as prunable"));
        assert_eq!(stale.dirty_summary.total(), 0);
        assert!(snapshot
            .local_branches
            .iter()
            .any(|branch| branch.name == "feature/demo"));
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

    #[test]
    fn lists_worktree_file_changes() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        std::fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.email", "sandbox@example.test"]);
        git(&root, &["config", "user.name", "Sandbox"]);
        for file in ["modified.txt", "renamed.txt"] {
            std::fs::write(root.join(file), "base\n").unwrap();
        }
        git(&root, &["add", "."]);
        git(&root, &["commit", "-m", "base"]);

        std::fs::write(root.join("modified.txt"), "changed\n").unwrap();
        std::fs::write(root.join("added.txt"), "added\n").unwrap();
        git(&root, &["add", "added.txt"]);
        git(&root, &["mv", "renamed.txt", "renamed-new.txt"]);
        std::fs::write(root.join("untracked.txt"), "untracked\n").unwrap();

        let changes = list_worktree_changes(&root).unwrap();
        let modified = changes
            .iter()
            .find(|change| change.path == "modified.txt")
            .unwrap();
        let added = changes
            .iter()
            .find(|change| change.path == "added.txt")
            .unwrap();
        let renamed = changes
            .iter()
            .find(|change| change.path == "renamed-new.txt")
            .unwrap();
        let untracked = changes
            .iter()
            .find(|change| change.path == "untracked.txt")
            .unwrap();

        assert_eq!(modified.status, "Working modified");
        assert_eq!(added.status, "Staged added");
        assert_eq!(renamed.previous_path.as_deref(), Some("renamed.txt"));
        assert_eq!(renamed.status, "Staged renamed");
        assert_eq!(untracked.status, "Untracked");
    }
}
