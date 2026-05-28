use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryRecord {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_scanned_at: Option<String>,
    pub pinned: bool,
    pub archived: bool,
}

impl RepositoryRecord {
    pub fn from_path(path: &Path) -> Self {
        let display_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_else(|| path.to_str().unwrap_or("Repository"))
            .to_string();
        let path = path.to_string_lossy().to_string();
        let now = now_string();

        Self {
            id: path.clone(),
            path,
            display_name,
            created_at: now.clone(),
            updated_at: now,
            last_scanned_at: None,
            pinned: false,
            archived: false,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtySummary {
    pub modified: u32,
    pub added: u32,
    pub deleted: u32,
    pub renamed: u32,
    pub untracked: u32,
    pub conflicted: u32,
}

impl DirtySummary {
    pub fn total(&self) -> u32 {
        self.modified + self.added + self.deleted + self.renamed + self.untracked + self.conflicted
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub relative_time: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitListItem {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author_name: String,
    pub committed_at: String,
    pub relative_time: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPage {
    pub commits: Vec<CommitListItem>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeItem {
    pub path: String,
    pub previous_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSnapshot {
    pub path: String,
    pub branch: Option<String>,
    pub head_sha: Option<String>,
    pub created_at: String,
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
    pub scan_error: Option<String>,
    pub dirty_summary: DirtySummary,
    pub last_commit: Option<CommitSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchSnapshot {
    pub name: String,
    pub full_ref: String,
    pub created_at: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_merged_to_default: bool,
    pub worktree_path: Option<String>,
    pub last_commit: Option<CommitSummary>,
    pub is_remote: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashSnapshot {
    pub id: String,
    pub created_at: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub repo: RepositoryRecord,
    pub default_branch: Option<String>,
    pub worktrees: Vec<WorktreeSnapshot>,
    pub local_branches: Vec<BranchSnapshot>,
    pub remote_branches: Vec<BranchSnapshot>,
    pub stashes: Vec<StashSnapshot>,
    pub diagnostics: Vec<String>,
}

impl RepositorySnapshot {
    pub fn failed(repo: RepositoryRecord, error: String) -> Self {
        Self {
            repo,
            default_branch: None,
            worktrees: Vec::new(),
            local_branches: Vec::new(),
            remote_branches: Vec::new(),
            stashes: Vec::new(),
            diagnostics: vec![error],
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyPreview {
    pub operation: String,
    pub risk_level: String,
    pub title: String,
    pub facts: Vec<String>,
    pub blockers: Vec<String>,
    pub command: String,
    pub requires_confirmation: bool,
    pub target_path: Option<String>,
    pub target_branch: Option<String>,
    pub branch_names: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub ok: bool,
    pub summary: String,
    pub command: String,
    pub changed_paths: Vec<String>,
}

pub fn now_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
