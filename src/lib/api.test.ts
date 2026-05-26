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
    ["listRepositories", () => api.listRepositories(), "list_repositories", undefined],
    ["removeRepository", () => api.removeRepository("/repo"), "remove_repository", { path: "/repo" }],
    ["scanAllRepositories", () => api.scanAllRepositories(), "scan_all_repositories", undefined],
    ["scanRepository", () => api.scanRepository("/repo"), "scan_repository", { path: "/repo" }],
    [
      "deleteWorktreePreview",
      () => api.deleteWorktreePreview("/repo-wt"),
      "delete_worktree_preview",
      { worktreePath: "/repo-wt" },
    ],
    [
      "deleteBranchPreview",
      () => api.deleteBranchPreview("/repo", "feature/demo"),
      "delete_branch_preview",
      { repoPath: "/repo", branch: "feature/demo" },
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
      () => api.deleteWorktree("/repo-wt", true),
      "delete_worktree",
      { worktreePath: "/repo-wt", force: true },
    ],
    [
      "deleteBranch",
      () => api.deleteBranch("/repo", "feature/demo", true),
      "delete_branch",
      { repoPath: "/repo", branch: "feature/demo", force: true },
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
