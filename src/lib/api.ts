import { invoke } from "@tauri-apps/api/core";
import type {
  CommitPage,
  CommandResult,
  FileChangeItem,
  RepositoryRecord,
  RepositorySnapshot,
  SafetyPreview,
} from "./types";

export function addRepository(path: string) {
  return invoke<RepositoryRecord>("add_repository", { path });
}

export function addRepositories(path: string) {
  return invoke<RepositoryRecord[]>("add_repositories", { path });
}

export function listRepositories() {
  return invoke<RepositoryRecord[]>("list_repositories");
}

export function removeRepository(path: string) {
  return invoke<void>("remove_repository", { path });
}

export function scanAllRepositories() {
  return invoke<RepositorySnapshot[]>("scan_all_repositories");
}

export function scanRepository(path: string) {
  return invoke<RepositorySnapshot>("scan_repository", { path });
}

export function deleteWorktreePreview(repoPath: string, worktreePath: string) {
  return invoke<SafetyPreview>("delete_worktree_preview", { repoPath, worktreePath });
}

export function deleteBranchPreview(repoPath: string, branch: string) {
  return invoke<SafetyPreview>("delete_branch_preview", { repoPath, branch });
}

export function cleanupMergedBranchesPreview(repoPath: string) {
  return invoke<SafetyPreview>("cleanup_merged_branches_preview", { repoPath });
}

export function branchesOutsideTargetsPreview(repoPath: string) {
  return invoke<SafetyPreview>("branches_outside_targets_preview", { repoPath });
}

export function createWorktree(
  repoPath: string,
  branch: string,
  worktreePath: string,
  createBranch: boolean,
) {
  return invoke<CommandResult>("create_worktree", {
    repoPath,
    branch,
    worktreePath,
    createBranch,
  });
}

export function deleteWorktree(repoPath: string, worktreePath: string, force: boolean) {
  return invoke<CommandResult>("delete_worktree", { repoPath, worktreePath, force });
}

export function deleteBranch(repoPath: string, branch: string, force: boolean) {
  return invoke<CommandResult>("delete_branch", { repoPath, branch, force });
}

export function checkoutBranch(repoPath: string, branch: string) {
  return invoke<CommandResult>("checkout_branch", { repoPath, branch });
}

export function fastForwardBranch(repoPath: string, branch: string) {
  return invoke<CommandResult>("fast_forward_branch", { repoPath, branch });
}

export function cleanupMergedBranches(repoPath: string) {
  return invoke<CommandResult>("cleanup_merged_branches", { repoPath });
}

export function cleanupSelectedMergedBranches(repoPath: string, branches: string[]) {
  return invoke<CommandResult>("cleanup_selected_merged_branches", { repoPath, branches });
}

export function deleteSelectedBranches(repoPath: string, branches: string[], force: boolean) {
  return invoke<CommandResult>("delete_selected_branches", { repoPath, branches, force });
}

export function listBranchCommits(
  repoPath: string,
  branch: string,
  offset: number,
  limit: number,
) {
  return invoke<CommitPage>("list_branch_commits", { repoPath, branch, offset, limit });
}

export function listWorktreeChanges(worktreePath: string) {
  return invoke<FileChangeItem[]>("list_worktree_changes", { worktreePath });
}

export function fetchRepository(repoPath: string) {
  return invoke<CommandResult>("fetch_repository", { repoPath });
}

export function pullWorktree(worktreePath: string) {
  return invoke<CommandResult>("pull_worktree", { worktreePath });
}

export function pushBranch(worktreePath: string) {
  return invoke<CommandResult>("push_branch", { worktreePath });
}

export function stashWorktree(worktreePath: string) {
  return invoke<CommandResult>("stash_worktree", { worktreePath });
}

export function openPath(path: string, kind: "finder" | "terminal" | "editor") {
  return invoke<CommandResult>("open_path", { path, kind });
}
