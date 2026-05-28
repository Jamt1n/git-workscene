mod git;
mod models;
mod safety;
#[cfg(test)]
mod sandbox;
mod storage;

use models::{
    CommandResult, CommitPage, FileChangeItem, RepositoryRecord, RepositorySnapshot, SafetyPreview,
};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{Manager, State};

struct AppState {
    storage: storage::Storage,
}

#[tauri::command]
fn add_repository(path: String, state: State<'_, AppState>) -> Result<RepositoryRecord, String> {
    let root = git::discover_repository_owner(&PathBuf::from(path))?;
    state.storage.upsert_repository(&root)
}

#[tauri::command]
fn add_repositories(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<RepositoryRecord>, String> {
    git::discover_repository_inputs(&PathBuf::from(path))?
        .into_iter()
        .map(|root| state.storage.upsert_repository(&root))
        .collect()
}

#[tauri::command]
fn list_repositories(state: State<'_, AppState>) -> Result<Vec<RepositoryRecord>, String> {
    state.storage.list_repositories()
}

#[tauri::command]
fn remove_repository(path: String, state: State<'_, AppState>) -> Result<(), String> {
    state.storage.archive_repository(&path)
}

#[tauri::command]
async fn scan_repository(path: String) -> Result<RepositorySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = git::discover_repository_owner(&PathBuf::from(path))?;
        let repo = RepositoryRecord::from_path(&root);
        git::scan_repository(&repo)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn scan_all_repositories(
    state: State<'_, AppState>,
) -> Result<Vec<RepositorySnapshot>, String> {
    let repos = state.storage.list_repositories()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = HashSet::new();
        let mut snapshots = Vec::new();

        for repo in repos {
            let normalized = git::normalize_repository_record(&repo);
            match normalized {
                Ok(normalized_repo) => {
                    if seen.insert(normalized_repo.path.clone()) {
                        snapshots.push(match git::scan_repository(&normalized_repo) {
                            Ok(snapshot) => snapshot,
                            Err(error) => RepositorySnapshot::failed(normalized_repo, error),
                        });
                    }
                }
                Err(error) => {
                    if seen.insert(repo.path.clone()) {
                        snapshots.push(RepositorySnapshot::failed(repo, error));
                    }
                }
            }
        }

        Ok(snapshots)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_worktree_preview(
    repo_path: String,
    worktree_path: String,
) -> Result<SafetyPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        safety::delete_worktree_preview(&PathBuf::from(repo_path), &PathBuf::from(worktree_path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_branch_preview(repo_path: String, branch: String) -> Result<SafetyPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        safety::delete_branch_preview(&PathBuf::from(repo_path), &branch)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn cleanup_merged_branches_preview(repo_path: String) -> Result<SafetyPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        safety::cleanup_merged_branches_preview(&PathBuf::from(repo_path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn branches_outside_targets_preview(repo_path: String) -> Result<SafetyPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        safety::branches_outside_targets_preview(&PathBuf::from(repo_path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_worktree(
    repo_path: String,
    branch: String,
    worktree_path: String,
    create_branch: bool,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::create_worktree(
            &PathBuf::from(repo_path),
            &branch,
            &PathBuf::from(worktree_path),
            create_branch,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::delete_worktree(
            &PathBuf::from(repo_path),
            &PathBuf::from(worktree_path),
            force,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_branch(
    repo_path: String,
    branch: String,
    force: bool,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::delete_branch(&PathBuf::from(repo_path), &branch, force)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn checkout_branch(repo_path: String, branch: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::checkout_branch(&PathBuf::from(repo_path), &branch)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fast_forward_branch(repo_path: String, branch: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::fast_forward_branch(&PathBuf::from(repo_path), &branch)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn cleanup_merged_branches(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::cleanup_merged_branches(&PathBuf::from(repo_path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn cleanup_selected_merged_branches(
    repo_path: String,
    branches: Vec<String>,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::cleanup_selected_merged_branches(&PathBuf::from(repo_path), &branches)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_selected_branches(
    repo_path: String,
    branches: Vec<String>,
    force: bool,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::delete_selected_branches(&PathBuf::from(repo_path), &branches, force)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_branch_commits(
    repo_path: String,
    branch: String,
    offset: usize,
    limit: usize,
) -> Result<CommitPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::list_branch_commits(&PathBuf::from(repo_path), &branch, offset, limit)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_worktree_changes(worktree_path: String) -> Result<Vec<FileChangeItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::list_worktree_changes(&PathBuf::from(worktree_path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_repository(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || git::fetch_repository(&PathBuf::from(repo_path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pull_worktree(worktree_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || git::pull_worktree(&PathBuf::from(worktree_path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn push_branch(worktree_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || git::push_branch(&PathBuf::from(worktree_path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn stash_worktree(worktree_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || git::stash_worktree(&PathBuf::from(worktree_path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_path(path: String, kind: String) -> Result<CommandResult, String> {
    git::open_path(&PathBuf::from(path), &kind)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data directory");
            let storage = storage::Storage::open(app_data_dir.join("registry.sqlite3"))
                .expect("failed to open repository registry");
            app.manage(AppState { storage });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_repository,
            add_repositories,
            list_repositories,
            remove_repository,
            scan_repository,
            scan_all_repositories,
            delete_worktree_preview,
            delete_branch_preview,
            cleanup_merged_branches_preview,
            branches_outside_targets_preview,
            create_worktree,
            delete_worktree,
            delete_branch,
            checkout_branch,
            fast_forward_branch,
            cleanup_merged_branches,
            cleanup_selected_merged_branches,
            delete_selected_branches,
            list_branch_commits,
            list_worktree_changes,
            fetch_repository,
            pull_worktree,
            push_branch,
            stash_worktree,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
