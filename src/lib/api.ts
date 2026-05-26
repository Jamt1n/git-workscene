import { invoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  RepositoryRecord,
  RepositorySnapshot,
  SafetyPreview,
} from "./types";

export function addRepository(path: string) {
  return invoke<RepositoryRecord>("add_repository", { path });
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

export function deleteWorktreePreview(worktreePath: string) {
  return invoke<SafetyPreview>("delete_worktree_preview", { worktreePath });
}

export function deleteBranchPreview(repoPath: string, branch: string) {
  return invoke<SafetyPreview>("delete_branch_preview", { repoPath, branch });
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

export function deleteWorktree(worktreePath: string, force: boolean) {
  return invoke<CommandResult>("delete_worktree", { worktreePath, force });
}

export function deleteBranch(repoPath: string, branch: string, force: boolean) {
  return invoke<CommandResult>("delete_branch", { repoPath, branch, force });
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
