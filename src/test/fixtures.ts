import type { RepositorySnapshot } from "../lib/types";

export function snapshotFixture(): RepositorySnapshot {
  return {
    repo: {
      id: "/tmp/repo",
      path: "/tmp/repo",
      displayName: "repo",
      createdAt: "1",
      updatedAt: "1",
      lastScannedAt: null,
      pinned: false,
      archived: false,
    },
    defaultBranch: "main",
    worktrees: [
      {
        path: "/tmp/repo-feature",
        branch: "feature/demo",
        headSha: "abc",
        createdAt: "20",
        detached: false,
        locked: false,
        prunable: false,
        scanError: null,
        dirtySummary: {
          modified: 1,
          added: 0,
          deleted: 0,
          renamed: 0,
          untracked: 1,
          conflicted: 0,
        },
        lastCommit: null,
      },
    ],
    localBranches: [
      {
        name: "feature/demo",
        fullRef: "refs/heads/feature/demo",
        createdAt: "30",
        upstream: "origin/feature/demo",
        ahead: 1,
        behind: 0,
        isMergedToDefault: false,
        worktreePath: "/tmp/repo-feature",
        lastCommit: null,
        isRemote: false,
      },
    ],
    remoteBranches: [
      {
        name: "origin/feature/demo",
        fullRef: "refs/remotes/origin/feature/demo",
        createdAt: "25",
        upstream: null,
        ahead: 0,
        behind: 0,
        isMergedToDefault: false,
        worktreePath: null,
        lastCommit: null,
        isRemote: true,
      },
    ],
    stashes: [
      {
        id: "stash@{0}",
        createdAt: "10",
        message: "WIP on feature/demo",
      },
    ],
    diagnostics: [],
  };
}
