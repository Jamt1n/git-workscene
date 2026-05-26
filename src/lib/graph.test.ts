import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";
import type { RepositorySnapshot } from "./types";

describe("buildGraph", () => {
  it("connects repository, worktree, branch, and remote nodes", () => {
    const snapshot: RepositorySnapshot = {
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
      worktrees: [
        {
          path: "/tmp/repo-feature",
          branch: "feature/demo",
          headSha: "abc",
          detached: false,
          locked: false,
          prunable: false,
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
          upstream: null,
          ahead: 0,
          behind: 0,
          isMergedToDefault: false,
          worktreePath: null,
          lastCommit: null,
          isRemote: true,
        },
      ],
      stashes: [],
      diagnostics: [],
    };

    const graph = buildGraph([snapshot]);

    expect(graph.nodes.map((node) => node.data.kind)).toEqual([
      "repository",
      "worktree",
      "branch",
      "remote",
    ]);
    expect(graph.edges.some((edge) => edge.source.startsWith("repo:"))).toBe(true);
    expect(graph.edges.some((edge) => edge.id.includes("origin/feature/demo"))).toBe(true);
  });
});
