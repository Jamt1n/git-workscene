mod git;
mod models;
mod safety;
#[cfg(test)]
mod sandbox;
mod storage;

use models::{CommandResult, RepositoryRecord, RepositorySnapshot, SafetyPreview};
use std::path::PathBuf;
use tauri::{Manager, State};

struct AppState {
    storage: storage::Storage,
}

#[tauri::command]
fn add_repository(path: String, state: State<'_, AppState>) -> Result<RepositoryRecord, String> {
    let root = git::discover_repository(&PathBuf::from(path))?;
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
        let root = git::discover_repository(&PathBuf::from(path))?;
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
        Ok(repos
            .into_iter()
            .map(|repo| match git::scan_repository(&repo) {
                Ok(snapshot) => snapshot,
                Err(error) => RepositorySnapshot::failed(repo, error),
            })
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn delete_worktree_preview(worktree_path: String) -> Result<SafetyPreview, String> {
    safety::delete_worktree_preview(&PathBuf::from(worktree_path))
}

#[tauri::command]
fn delete_branch_preview(repo_path: String, branch: String) -> Result<SafetyPreview, String> {
    safety::delete_branch_preview(&PathBuf::from(repo_path), &branch)
}

#[tauri::command]
fn create_worktree(
    repo_path: String,
    branch: String,
    worktree_path: String,
    create_branch: bool,
) -> Result<CommandResult, String> {
    git::create_worktree(
        &PathBuf::from(repo_path),
        &branch,
        &PathBuf::from(worktree_path),
        create_branch,
    )
}

#[tauri::command]
fn delete_worktree(worktree_path: String, force: bool) -> Result<CommandResult, String> {
    git::delete_worktree(&PathBuf::from(worktree_path), force)
}

#[tauri::command]
fn delete_branch(repo_path: String, branch: String, force: bool) -> Result<CommandResult, String> {
    git::delete_branch(&PathBuf::from(repo_path), &branch, force)
}

#[tauri::command]
fn fetch_repository(repo_path: String) -> Result<CommandResult, String> {
    git::fetch_repository(&PathBuf::from(repo_path))
}

#[tauri::command]
fn pull_worktree(worktree_path: String) -> Result<CommandResult, String> {
    git::pull_worktree(&PathBuf::from(worktree_path))
}

#[tauri::command]
fn push_branch(worktree_path: String) -> Result<CommandResult, String> {
    git::push_branch(&PathBuf::from(worktree_path))
}

#[tauri::command]
fn stash_worktree(worktree_path: String) -> Result<CommandResult, String> {
    git::stash_worktree(&PathBuf::from(worktree_path))
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
            create_worktree,
            delete_worktree,
            delete_branch,
            fetch_repository,
            pull_worktree,
            push_branch,
            stash_worktree,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
