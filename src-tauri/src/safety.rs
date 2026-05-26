use crate::git;
use crate::models::SafetyPreview;
use std::path::Path;

pub fn delete_worktree_preview(worktree_path: &Path) -> Result<SafetyPreview, String> {
    let root = git::discover_repository(worktree_path)?;
    let target_path = worktree_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let worktrees = git::scan_worktrees(&root)?;
    let target = worktrees
        .into_iter()
        .find(|worktree| {
            Path::new(&worktree.path)
                .canonicalize()
                .map(|path| path == target_path)
                .unwrap_or(false)
        })
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

    let mut blockers = Vec::new();
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
        title: "Delete worktree".to_string(),
        facts,
        blockers,
        command: format!(
            "git worktree remove '{}'",
            target.path.replace('\'', "'\\''")
        ),
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
        target_branch: None,
        branch_names: Vec::new(),
    })
}

pub fn cleanup_merged_branches_preview(
    repo_path: &Path,
    target_branch: &str,
) -> Result<SafetyPreview, String> {
    let candidates = git::merged_branch_cleanup_candidates(repo_path, target_branch)?;
    let mut facts = vec![
        format!("Target branch: {target_branch}"),
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
        format!(
            "git -C {} branch -D {}",
            shell_path(&candidates.root),
            candidates
                .deletable
                .iter()
                .map(|branch| shell_arg(branch))
                .collect::<Vec<_>>()
                .join(" ")
        )
    };

    Ok(SafetyPreview {
        operation: "cleanupMergedBranches".to_string(),
        risk_level: if blockers.is_empty() {
            "medium"
        } else {
            "blocked"
        }
        .to_string(),
        title: format!("Clean branches merged into {target_branch}"),
        facts,
        blockers,
        command,
        requires_confirmation: true,
        target_path: Some(candidates.root.to_string_lossy().to_string()),
        target_branch: Some(target_branch.to_string()),
        branch_names: candidates.deletable,
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

    #[test]
    fn previews_dirty_worktree_delete() {
        let sandbox = SandboxRepo::create();

        let preview = delete_worktree_preview(&sandbox.worktree).unwrap();

        assert_eq!(preview.operation, "deleteWorktree");
        assert!(preview.facts.iter().any(|fact| fact == "Dirty files: 1"));
        assert!(preview.requires_confirmation);
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
    fn previews_cleanup_of_branches_merged_into_master() {
        let sandbox = SandboxRepo::create();
        git(&sandbox.root, &["branch", "master"]);
        git(&sandbox.root, &["branch", "cleanup/merged"]);

        let preview = cleanup_merged_branches_preview(&sandbox.root, "master").unwrap();

        assert_eq!(preview.operation, "cleanupMergedBranches");
        assert_eq!(preview.risk_level, "medium");
        assert_eq!(preview.target_branch.as_deref(), Some("master"));
        assert_eq!(preview.branch_names, vec!["cleanup/merged"]);
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact == "Delete: cleanup/merged"));
        assert!(preview
            .facts
            .iter()
            .any(|fact| fact.contains("Skipped protected")));
    }

    #[test]
    fn blocks_cleanup_preview_without_safe_candidates() {
        let sandbox = SandboxRepo::create();
        git(&sandbox.root, &["branch", "prerelease"]);

        let preview = cleanup_merged_branches_preview(&sandbox.root, "prerelease").unwrap();

        assert_eq!(preview.risk_level, "blocked");
        assert!(preview.branch_names.is_empty());
        assert!(preview
            .blockers
            .iter()
            .any(|blocker| blocker == "No local branches are safe to delete."));
    }

    #[test]
    fn reports_missing_branch_preview_error() {
        let sandbox = SandboxRepo::create();

        let error = delete_branch_preview(&sandbox.root, "missing/branch").unwrap_err();

        assert!(error.contains("Branch not found"));
    }
}
