import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("api wrappers", () => {
  beforeEach(() => {
    invokeMock.mockResolvedValue({});
  });

  it.each([
    ["addRepository", () => api.addRepository("/repo"), "add_repository", { path: "/repo" }],
    ["addRepositories", () => api.addRepositories("/work"), "add_repositories", { path: "/work" }],
    ["listRepositories", () => api.listRepositories(), "list_repositories", undefined],
    ["removeRepository", () => api.removeRepository("/repo"), "remove_repository", { path: "/repo" }],
    ["scanAllRepositories", () => api.scanAllRepositories(), "scan_all_repositories", undefined],
    ["scanRepository", () => api.scanRepository("/repo"), "scan_repository", { path: "/repo" }],
    [
      "deleteWorktreePreview",
      () => api.deleteWorktreePreview("/repo", "/repo-wt"),
      "delete_worktree_preview",
      { repoPath: "/repo", worktreePath: "/repo-wt" },
    ],
    [
      "deleteBranchPreview",
      () => api.deleteBranchPreview("/repo", "feature/demo"),
      "delete_branch_preview",
      { repoPath: "/repo", branch: "feature/demo" },
    ],
    [
      "cleanupMergedBranchesPreview",
      () => api.cleanupMergedBranchesPreview("/repo"),
      "cleanup_merged_branches_preview",
      { repoPath: "/repo" },
    ],
    [
      "branchesOutsideTargetsPreview",
      () => api.branchesOutsideTargetsPreview("/repo"),
      "branches_outside_targets_preview",
      { repoPath: "/repo" },
    ],
    [
      "createWorktree",
      () => api.createWorktree("/repo", "feature/demo", "/repo-wt", false),
      "create_worktree",
      {
        repoPath: "/repo",
        branch: "feature/demo",
        worktreePath: "/repo-wt",
        createBranch: false,
      },
    ],
    [
      "deleteWorktree",
      () => api.deleteWorktree("/repo", "/repo-wt", true),
      "delete_worktree",
      { repoPath: "/repo", worktreePath: "/repo-wt", force: true },
    ],
    [
      "deleteBranch",
      () => api.deleteBranch("/repo", "feature/demo", true),
      "delete_branch",
      { repoPath: "/repo", branch: "feature/demo", force: true },
    ],
    [
      "checkoutBranch",
      () => api.checkoutBranch("/repo", "feature/demo"),
      "checkout_branch",
      { repoPath: "/repo", branch: "feature/demo" },
    ],
    [
      "fastForwardBranch",
      () => api.fastForwardBranch("/repo", "feature/demo"),
      "fast_forward_branch",
      { repoPath: "/repo", branch: "feature/demo" },
    ],
    [
      "cleanupMergedBranches",
      () => api.cleanupMergedBranches("/repo"),
      "cleanup_merged_branches",
      { repoPath: "/repo" },
    ],
    [
      "cleanupSelectedMergedBranches",
      () => api.cleanupSelectedMergedBranches("/repo", ["cleanup/old"]),
      "cleanup_selected_merged_branches",
      { repoPath: "/repo", branches: ["cleanup/old"] },
    ],
    [
      "deleteSelectedBranches",
      () => api.deleteSelectedBranches("/repo", ["feature/outside"], true),
      "delete_selected_branches",
      { repoPath: "/repo", branches: ["feature/outside"], force: true },
    ],
    [
      "listBranchCommits",
      () => api.listBranchCommits("/repo", "feature/demo", 30, 30),
      "list_branch_commits",
      { repoPath: "/repo", branch: "feature/demo", offset: 30, limit: 30 },
    ],
    [
      "listWorktreeChanges",
      () => api.listWorktreeChanges("/repo-feature"),
      "list_worktree_changes",
      { worktreePath: "/repo-feature" },
    ],
    ["fetchRepository", () => api.fetchRepository("/repo"), "fetch_repository", { repoPath: "/repo" }],
    ["pullWorktree", () => api.pullWorktree("/repo"), "pull_worktree", { worktreePath: "/repo" }],
    ["pushBranch", () => api.pushBranch("/repo"), "push_branch", { worktreePath: "/repo" }],
    ["stashWorktree", () => api.stashWorktree("/repo"), "stash_worktree", { worktreePath: "/repo" }],
    ["openPath", () => api.openPath("/repo", "finder"), "open_path", { path: "/repo", kind: "finder" }],
  ])("%s invokes the expected Tauri command", async (_, call, command, payload) => {
    await call();

    if (payload === undefined) {
      expect(invokeMock).toHaveBeenCalledWith(command);
    } else {
      expect(invokeMock).toHaveBeenCalledWith(command, payload);
    }
  });
});
