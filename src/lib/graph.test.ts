import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";
import { dirtyTotal } from "./types";
import { snapshotFixture } from "../test/fixtures";

describe("buildGraph", () => {
  it("connects repository, worktree, branch, remote, and stash nodes", () => {
    const snapshot = snapshotFixture();

    const graph = buildGraph([snapshot]);

    expect(graph.nodes.map((node) => node.data.kind)).toEqual([
      "repository",
      "worktree",
      "branch",
      "remote",
      "stash",
    ]);
    expect(graph.edges.some((edge) => edge.source.startsWith("repo:"))).toBe(true);
    expect(graph.edges.some((edge) => edge.id.includes("origin/feature/demo"))).toBe(true);
    expect(graph.edges.some((edge) => edge.id.includes("stash@{0}"))).toBe(true);
  });

  it("marks dirty worktree edges as animated", () => {
    const graph = buildGraph([snapshotFixture()]);

    const worktreeEdge = graph.edges.find((edge) => edge.target.startsWith("worktree:"));

    expect(worktreeEdge?.animated).toBe(true);
  });

  it("shows repository diagnostics as attention badges", () => {
    const snapshot = snapshotFixture();
    snapshot.diagnostics = ["repo moved"];

    const graph = buildGraph([snapshot]);
    const repoNode = graph.nodes.find((node) => node.data.kind === "repository");

    expect(repoNode?.data.badges).toContain("needs attention");
  });

  it("limits remote branch nodes to keep dense repos readable", () => {
    const snapshot = snapshotFixture();
    snapshot.remoteBranches = Array.from({ length: 30 }, (_, index) => ({
      name: `origin/feature/${index}`,
      fullRef: `refs/remotes/origin/feature/${index}`,
      upstream: null,
      ahead: 0,
      behind: 0,
      isMergedToDefault: false,
      worktreePath: null,
      lastCommit: null,
      isRemote: true,
    }));

    const graph = buildGraph([snapshot]);

    expect(graph.nodes.filter((node) => node.data.kind === "remote")).toHaveLength(24);
  });
});

describe("dirtyTotal", () => {
  it("counts every dirty status bucket", () => {
    expect(
      dirtyTotal({
        modified: 1,
        added: 2,
        deleted: 3,
        renamed: 4,
        untracked: 5,
        conflicted: 6,
      }),
    ).toBe(21);
  });
});
