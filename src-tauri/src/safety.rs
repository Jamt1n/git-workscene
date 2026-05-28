use crate::git;
use crate::models::SafetyPreview;
use std::path::Path;

pub fn delete_worktree_preview(
    repo_path: &Path,
    worktree_path: &Path,
) -> Result<SafetyPreview, String> {
    let root = git::discover_repository_owner(repo_path)?;
    let worktrees = git::scan_worktrees(&root)?;
    let target = worktrees
        .into_iter()
        .find(|worktree| git::same_worktree_path(&worktree.path, worktree_path))
        .ok_or_else(|| {
            format!(
                "Worktree is not registered by Git: {}",
                worktree_path.to_string_lossy()
            )
        })?;

    let mut facts = vec![
        format!("Path: {}", target.path),
        format!(
            "Branch: {}",
            target.branch.as_deref().unwrap_or("detached HEAD")
        ),
        format!("Dirty files: {}", target.dirty_summary.total()),
        format!("Locked: {}", target.locked),
        format!("Prunable: {}", target.prunable),
    ];
    if let Some(commit) = target.last_commit {
        facts.push(format!(
            "Last commit: {} {}",
            commit.short_sha, commit.subject
        ));
    }
    if target.prunable {
        facts.push("Action: prune stale Git worktree metadata".to_string());
        facts.push("Directory is left on disk if it still exists".to_string());
    }

    let mut blockers = Vec::new();
    let is_main_working_tree =
        git::same_worktree_path(root.to_string_lossy().as_ref(), worktree_path);
    if is_main_working_tree {
        facts.push("Main working tree: true".to_string());
        blockers.push(
            "Main working tree cannot be removed by git worktree remove. Remove the repository from the project list instead."
                .to_string(),
        );
    }
    if target.locked {
        blockers.push("Git reports this worktree is locked".to_string());
    }

    Ok(SafetyPreview {
        operation: "deleteWorktree".to_string(),
        risk_level: if blockers.is_empty() {
            "high"
        } else {
            "blocked"
        }
        .to_string(),
        title: if target.prunable {
            "Prune stale worktree".to_string()
        } else {
            "Delete worktree".to_string()
        },
        facts,
        blockers,
        command: if is_main_working_tree {
            "Main working tree cannot be removed by git worktree remove".to_string()
        } else if target.prunable {
            format!("git -C {} worktree prune --expire now", shell_path(&root))
        } else {
            format!(
                "git -C {} worktree remove {}",
                shell_path(&root),
                shell_arg(&target.path)
            )
        },
        requires_confirmation: true,
        target_path: Some(target.path),
        target_branch: None,
        branch_names: Vec::new(),
    })
}

pub fn delete_branch_preview(repo_path: &Path, branch: &str) -> Result<SafetyPreview, String> {
    let root = git::discover_repository(repo_path)?;
    let repo = crate::models::RepositoryRecord::from_path(&root);
    let snapshot = git::scan_repository(&repo)?;
    let target = snapshot
        .local_branches
        .into_iter()
        .find(|candidate| candidate.name == branch)
        .ok_or_else(|| format!("Branch not found: {branch}"))?;

    let mut facts = vec![
        format!("Branch: {}", target.name),
        format!("Merged to default: {}", target.is_merged_to_default),
        format!("Ahead: {}", target.ahead),
        format!("Behind: {}", target.behind),
    ];
    if let Some(upstream) = &target.upstream {
        facts.push(format!("Upstream: {upstream}"));
    }
    if let Some(commit) = &target.last_commit {
        facts.push(format!(
            "Last commit: {} {}",
            commit.short_sha, commit.subject
        ));
    }

    let mut blockers = Vec::new();
    if let Some(path) = &target.worktree_path {
        blockers.push(format!("Branch is checked out by worktree: {path}"));
    }

    let risk_level = if !blockers.is_empty() {
        "blocked"
    } else if target.is_merged_to_default && target.ahead == 0 {
        "medium"
    } else {
        "high"
    };

    Ok(SafetyPreview {
        operation: "deleteBranch".to_string(),
        risk_level: risk_level.to_string(),
        title: "Delete branch".to_string(),
        facts,
        blockers,
        command: format!("git branch -d '{}'", target.name.replace('\'', "'\\''")),
        requires_confirmation: true,
        target_path: Some(root.to_string_lossy().to_string()),
        target_branch: Some(target.name),
        branch_names: Vec::new(),
    })
}

pub fn cleanup_merged_branches_preview(repo_path: &Path) -> Result<SafetyPreview, String> {
    let candidates = git::merged_branch_cleanup_candidates(repo_path)?;
    let target_display = candidates
        .target_ref
        .strip_prefix("refs/remotes/")
        .unwrap_or(&candidates.target_ref);
    let mut facts = vec![
        format!("Latest remote target: {target_display}"),
        format!("Safe to delete: {}", candidates.deletable.len()),
    ];

    for branch in candidates.deletable.iter().take(20) {
        facts.push(format!("Delete: {branch}"));
    }
    if candidates.deletable.len() > 20 {
        facts.push(format!("... and {} more", candidates.deletable.len() - 20));
    }
    if !candidates.checked_out.is_empty() {
        facts.push(format!(
            "Skipped checked-out: {}",
            candidates.checked_out.join(", ")
        ));
    }
    if !candidates.protected.is_empty() {
        facts.push(format!(
            "Skipped protected: {}",
            candidates.protected.join(", ")
        ));
    }

    let mut blockers = Vec::new();
    if candidates.deletable.is_empty() {
        blockers.push("No local branches are safe to delete.".to_string());
    }

    let command = if candidates.deletable.is_empty() {
        "No branches to delete".to_string()
    } else {
        let delete_command = format!(
            "git -C {} branch -D {}",
            shell_path(&candidates.root),
            candidates
                .deletable
                .iter()
                .map(|branch| shell_arg(branch))
                .collect::<Vec<_>>()
                .join(" ")
        );
        git::cleanup_target_fetch_command(&candidates.root, &candidates.target_ref)
            .map(|fetch_command| format!("{fetch_command} && {delete_command}"))
            .unwrap_or(delete_command)
    };

    Ok(SafetyPreview {
        operation: "cleanupMergedBranches".to_string(),
        risk_level: if blockers.is_empty() {
            "medium"
        } else {
            "blocked"
        }
        .to_string(),
        title: format!("Clean branches merged into {}", candidates.target_branch),
        facts,
        blockers,
        command,
        requires_confirmation: true,
        target_path: Some(candidates.root.to_string_lossy().to_string()),
        target_branch: Some(candidates.target_branch),
        branch_names: candidates.deletable,
    })
}

pub fn branches_outside_targets_preview(repo_path: &Path) -> Result<SafetyPreview, String> {
    let audit = git::branches_outside_default_target(repo_path)?;
    let target_display = audit
        .target_ref
        .strip_prefix("refs/remotes/")
        .unwrap_or(&audit.target_ref);
    let mut facts = vec![
        format!("Latest remote target: {target_display}"),
        format!(
            "Outside {}: {}",
            audit.target_branch,
            audit.outside_branches.len()
        ),
    ];

    if !audit.protected.is_empty() {
        facts.push(format!("Skipped protected: {}", audit.protected.join(", ")));
    }

    Ok(SafetyPreview {
        operation: "branchesOutsideTargets".to_string(),
        risk_level: "low".to_string(),
        title: format!("Branches not in {}", audit.target_branch),
        facts,
        blockers: Vec::new(),
        command: git::cleanup_target_fetch_command(&audit.root, &audit.target_ref)
            .unwrap_or_else(|| format!("Using local target {}", audit.target_ref)),
        requires_confirmation: false,
        target_path: Some(audit.root.to_string_lossy().to_string()),
        target_branch: Some(audit.target_branch),
        branch_names: audit.outside_branches,
    })
}

fn shell_path(path: &Path) -> String {
    shell_arg(path.to_string_lossy().as_ref())
}

fn shell_arg(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{git, SandboxRepo};

    fn setup_origin_target(sandbox: &SandboxRepo, target_branch: &str) {
        let remote = sandbox.root.parent().unwrap().join("origin.git");
        std::fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare"]);
        if crate::git::run_git(&sandbox.root, &["remote", "get-url", "origin"]).is_err() {
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
    }

    #[test]
    fn previews_dirty_worktree_delete() {
        let sandbox = SandboxRepo::create();

        let preview = delete_worktree_preview(&sandbox.root, &sandbox.worktree).unwrap();

        assert_eq!(preview.operation, "deleteWorktree");
        assert!(preview.facts.iter().any(|fact| fact == "Dirty files: 1"));
        assert!(preview.requires_confirmation);
    }

    #[test]
    fn previews_prunable_missing_worktree_from_owner_repository() {
        let sandbox = SandboxRepo::create();
        std::fs::remove_dir_all(&sandbox.worktree).unwrap();

        let preview = delete_worktree_preview(&sandbox.root, &sandbox.worktree).unwrap();

        assert_eq!(preview.operation, "deleteWorktree");
        assert_eq!(preview.title, "Prune stale worktree");
        assert!(preview.facts.iter().any(|fact| fact == "Prunable: true"));
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact == "Action: prune stale Git worktree metadata"));
        assert!(preview.command.contains("worktree prune --expire now"));
    }

    #[test]
    fn previews_prunable_invalid_worktree_as_metadata_prune() {
        let sandbox = SandboxRepo::create();
        std::fs::remove_file(sandbox.worktree.join(".git")).unwrap();

        let preview = delete_worktree_preview(&sandbox.root, &sandbox.worktree).unwrap();

        assert_eq!(preview.operation, "deleteWorktree");
        assert_eq!(preview.title, "Prune stale worktree");
        assert_eq!(preview.risk_level, "high");
        assert!(preview.facts.iter().any(|fact| fact == "Prunable: true"));
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact == "Directory is left on disk if it still exists"));
        assert!(preview.command.contains("worktree prune --expire now"));
    }

    #[test]
    fn blocks_main_working_tree_delete_preview() {
        let sandbox = SandboxRepo::create();

        let preview = delete_worktree_preview(&sandbox.root, &sandbox.root).unwrap();

        assert_eq!(preview.operation, "deleteWorktree");
        assert_eq!(preview.risk_level, "blocked");
        assert!(preview
            .blockers
            .iter()
            .any(|blocker| blocker.contains("Main working tree")));
    }

    #[test]
    fn blocks_branch_delete_when_checked_out_by_worktree() {
        let sandbox = SandboxRepo::create();

        let preview = delete_branch_preview(&sandbox.root, "feature/demo").unwrap();

        assert_eq!(preview.operation, "deleteBranch");
        assert_eq!(preview.risk_level, "blocked");
        assert!(preview
            .blockers
            .iter()
            .any(|blocker| blocker.contains("checked out by worktree")));
    }

    #[test]
    fn marks_merged_unattached_branch_as_medium_risk() {
        let sandbox = SandboxRepo::create();
        git(&sandbox.root, &["branch", "cleanup/merged"]);

        let preview = delete_branch_preview(&sandbox.root, "cleanup/merged").unwrap();

        assert_eq!(preview.risk_level, "medium");
        assert!(preview.blockers.is_empty());
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact == "Merged to default: true"));
    }

    #[test]
    fn previews_cleanup_of_branches_merged_into_default_branch() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");
        git(&sandbox.root, &["branch", "cleanup/merged"]);

        let preview = cleanup_merged_branches_preview(&sandbox.root).unwrap();

        assert_eq!(preview.operation, "cleanupMergedBranches");
        assert_eq!(preview.risk_level, "medium");
        assert_eq!(preview.target_branch.as_deref(), Some("master"));
        assert_eq!(preview.branch_names, vec!["cleanup/merged"]);
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact == "Latest remote target: origin/master"));
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact == "Delete: cleanup/merged"));
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact.contains("Skipped protected")));
        assert!(preview.command.contains("refs/remotes/origin/master"));
    }

    #[test]
    fn blocks_cleanup_preview_without_safe_candidates() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "main");

        let preview = cleanup_merged_branches_preview(&sandbox.root).unwrap();

        assert_eq!(preview.risk_level, "blocked");
        assert!(preview.branch_names.is_empty());
        assert!(preview
            .blockers
            .iter()
            .any(|blocker| blocker == "No local branches are safe to delete."));
    }

    #[test]
    fn previews_branches_outside_default_branch() {
        let sandbox = SandboxRepo::create();
        setup_origin_target(&sandbox, "master");
        git(&sandbox.root, &["checkout", "-b", "audit/outside"]);
        std::fs::write(sandbox.root.join("outside.txt"), "outside\n").unwrap();
        git(&sandbox.root, &["add", "outside.txt"]);
        git(&sandbox.root, &["commit", "-m", "outside branch"]);

        let preview = branches_outside_targets_preview(&sandbox.root).unwrap();

        assert_eq!(preview.operation, "branchesOutsideTargets");
        assert!(!preview.requires_confirmation);
        assert_eq!(preview.target_branch.as_deref(), Some("master"));
        assert_eq!(preview.branch_names, vec!["audit/outside"]);
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact == "Latest remote target: origin/master"));
    }

    #[test]
    fn reports_missing_branch_preview_error() {
        let sandbox = SandboxRepo::create();

        let error = delete_branch_preview(&sandbox.root, "missing/branch").unwrap_err();

        assert!(error.contains("Branch not found"));
    }
}
