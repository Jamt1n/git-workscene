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
    })
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
    fn reports_missing_branch_preview_error() {
        let sandbox = SandboxRepo::create();

        let error = delete_branch_preview(&sandbox.root, "missing/branch").unwrap_err();

        assert!(error.contains("Branch not found"));
    }
}
