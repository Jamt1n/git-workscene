import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import { buildGraph } from "./graph";
import { dirtyTotal } from "./types";
import { snapshotFixture } from "../test/fixtures";

describe("buildGraph", () => {
  it("connects repository, worktree, and local branch nodes without remote nodes", () => {
    const snapshot = snapshotFixture();

    const graph = buildGraph([snapshot]);

    expect(graph.nodes.map((node) => node.data.kind)).toEqual([
      "repository",
      "worktree",
      "branch",
    ]);
    expect(graph.edges.some((edge) => edge.source.startsWith("repo:"))).toBe(true);
    expect(graph.nodes.some((node) => node.id.startsWith("remote:"))).toBe(false);
    expect(graph.edges.some((edge) => edge.id.includes("origin/feature/demo"))).toBe(false);
    expect(graph.nodes.some((node) => node.data.title === "stash@{0}")).toBe(false);
  });

  it("marks dirty worktree edges as animated", () => {
    const graph = buildGraph([snapshotFixture()]);

    const worktreeEdge = graph.edges.find((edge) => edge.target.startsWith("worktree:"));

    expect(worktreeEdge?.animated).toBe(true);
    expect(worktreeEdge?.data?.label).toBe("Dirty worktree");
    expect(worktreeEdge?.data?.description).toBe("This worktree has uncommitted changes");
  });

  it("locks nodes into the generated layout", () => {
    const graph = buildGraph([snapshotFixture()]);

    expect(graph.nodes.every((node) => node.draggable === false)).toBe(true);
    expect(graph.nodes.every((node) => node.sourcePosition === Position.Right)).toBe(true);
    expect(graph.nodes.every((node) => node.targetPosition === Position.Left)).toBe(true);
  });

  it("marks relation edges for visible connection styling", () => {
    const graph = buildGraph([snapshotFixture()]);

    expect(graph.edges.every((edge) => edge.type === "gitCurve")).toBe(true);
    expect(graph.edges.map((edge) => edge.data?.label)).toEqual([
      "Dirty worktree",
      "Worktree -> Branch",
    ]);
    expect(graph.edges.map((edge) => edge.className)).toEqual([
      "git-edge git-edge-worktree",
      "git-edge git-edge-checked-out",
    ]);
    expect(graph.edges.every((edge) => edge.markerEnd)).toBe(true);
  });

  it("marks checked-out local branches as active nodes", () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/idle",
      fullRef: "refs/heads/feature/idle",
      upstream: null,
      worktreePath: null,
      createdAt: "99",
    });

    const graph = buildGraph([snapshot]);
    const activeBranch = graph.nodes.find((node) => node.data.title === "feature/demo");
    const idleBranch = graph.nodes.find((node) => node.data.title === "feature/idle");

    expect(activeBranch?.data.isActive).toBe(true);
    expect(activeBranch?.data.dirtyCount).toBe(2);
    expect(activeBranch?.data.badges).toContain("active");
    expect(idleBranch?.data.isActive).toBe(false);
    expect(idleBranch?.data.badges).not.toContain("active");
  });

  it("marks the repository root worktree as the main working tree", () => {
    const snapshot = snapshotFixture();
    snapshot.worktrees.push({
      ...snapshot.worktrees[0],
      path: "/tmp/repo",
      branch: "main",
      dirtySummary: {
        modified: 0,
        added: 0,
        deleted: 0,
        renamed: 0,
        untracked: 0,
        conflicted: 0,
      },
      createdAt: "40",
    });

    const graph = buildGraph([snapshot]);
    const mainWorktree = graph.nodes.find(
      (node) => node.data.kind === "worktree" && node.data.path === "/tmp/repo",
    );

    expect(mainWorktree?.data.isMainWorktree).toBe(true);
    expect(mainWorktree?.data.badges).toContain("main");
  });

  it("assigns independent handles to each relation edge", () => {
    const snapshot = snapshotFixture();
    snapshot.worktrees.push({
      ...snapshot.worktrees[0],
      path: "/tmp/repo-other-worktree",
      branch: "feature/other",
      createdAt: "10",
    });
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/other",
      fullRef: "refs/heads/feature/other",
      upstream: null,
      worktreePath: "/tmp/repo-other-worktree",
      createdAt: "11",
    });

    const graph = buildGraph([snapshot]);
    const repoNode = graph.nodes.find((node) => node.data.kind === "repository");
    const repoEdges = graph.edges.filter((edge) => edge.source === repoNode?.id);

    expect(new Set(repoEdges.map((edge) => edge.sourceHandle)).size).toBe(repoEdges.length);
    expect(repoNode?.data.handles?.source).toHaveLength(repoEdges.length);
    expect(graph.edges.every((edge) => edge.sourceHandle && edge.targetHandle)).toBe(true);
  });

  it("shows repository diagnostics as attention badges", () => {
    const snapshot = snapshotFixture();
    snapshot.diagnostics = ["repo moved"];

    const graph = buildGraph([snapshot]);
    const repoNode = graph.nodes.find((node) => node.data.kind === "repository");

    expect(repoNode?.data.badges).toContain("needs attention");
  });

  it("keeps invalid worktrees visible with diagnostics", () => {
    const snapshot = snapshotFixture();
    snapshot.worktrees[0].prunable = true;
    snapshot.worktrees[0].scanError = "Git marks this worktree as prunable";
    snapshot.worktrees[0].dirtySummary = {
      modified: 0,
      added: 0,
      deleted: 0,
      renamed: 0,
      untracked: 0,
      conflicted: 0,
    };

    const graph = buildGraph([snapshot]);
    const worktreeNode = graph.nodes.find((node) => node.data.kind === "worktree");

    expect(worktreeNode?.data.badges).toEqual([
      "clean",
      "open",
      "prunable",
      "scan issue",
    ]);
    expect(worktreeNode?.data.diagnostics).toEqual([
      "Git marks this worktree as prunable",
    ]);
  });

  it("keeps upstream data on the local branch for inspector comparison", () => {
    const snapshot = snapshotFixture();

    const graph = buildGraph([snapshot]);
    const branch = graph.nodes.find((node) => node.data.kind === "branch");

    expect(branch?.data.upstream).toBe("origin/feature/demo");
  });

  it("orders graph columns by created time descending", () => {
    const snapshot = snapshotFixture();
    snapshot.worktrees.push({
      ...snapshot.worktrees[0],
      path: "/tmp/repo-newer-worktree",
      branch: "feature/newer",
      createdAt: "40",
    });
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/newer",
      fullRef: "refs/heads/feature/newer",
      upstream: null,
      worktreePath: "/tmp/repo-newer-worktree",
      createdAt: "50",
    });

    const graph = buildGraph([snapshot]);
    const worktrees = graph.nodes.filter((node) => node.data.kind === "worktree");
    const branches = graph.nodes.filter((node) => node.data.kind === "branch");

    expect(worktrees[0].data.title).toBe("repo-newer-worktree");
    expect(branches[0].data.title).toBe("feature/newer");
  });

  it("wraps dense branch lists into horizontal columns", () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches = Array.from({ length: 12 }, (_, index) => ({
      ...snapshot.localBranches[0],
      name: `feature/${index}`,
      fullRef: `refs/heads/feature/${index}`,
      upstream: null,
      worktreePath: null,
      createdAt: String(200 - index),
    }));

    const graph = buildGraph([snapshot]);
    const firstBranch = graph.nodes.find((node) => node.data.title === "feature/0");
    const wrappedBranch = graph.nodes.find((node) => node.data.title === "feature/9");

    expect(wrappedBranch?.position.x).toBeGreaterThan(firstBranch?.position.x ?? 0);
    expect(wrappedBranch?.position.y).toBe(firstBranch?.position.y);
  });

  it("places later repositories below a dense branch grid", () => {
    const dense = snapshotFixture();
    dense.repo.path = "/tmp/dense-repo";
    dense.repo.displayName = "dense-repo";
    dense.repo.createdAt = "2";
    dense.worktrees[0].path = "/tmp/dense-repo-feature";
    dense.localBranches = Array.from({ length: 12 }, (_, index) => ({
      ...dense.localBranches[0],
      name: `feature/${index}`,
      fullRef: `refs/heads/feature/${index}`,
      upstream: null,
      worktreePath: null,
      createdAt: String(200 - index),
    }));

    const later = snapshotFixture();
    later.repo.path = "/tmp/later-repo";
    later.repo.displayName = "later-repo";
    later.repo.createdAt = "1";
    later.worktrees[0].path = "/tmp/later-repo-feature";
    later.localBranches[0].worktreePath = "/tmp/later-repo-feature";

    const graph = buildGraph([later, dense]);
    const denseNode = graph.nodes.find((node) => node.data.title === "dense-repo");
    const laterNode = graph.nodes.find((node) => node.data.title === "later-repo");

    expect(laterNode?.position.y).toBeGreaterThan(denseNode?.position.y ?? 0);
    expect(laterNode?.position.y).toBeGreaterThan(1000);
  });

  it("shows every local branch by default", () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/hidden",
      fullRef: "refs/heads/feature/hidden",
      upstream: null,
      worktreePath: null,
      createdAt: "99",
    });

    const graph = buildGraph([snapshot]);
    const repoNode = graph.nodes.find((node) => node.data.kind === "repository");

    expect(graph.nodes.some((node) => node.data.title === "feature/hidden")).toBe(true);
    expect(repoNode?.data.badges).toContain("2 branches");
    expect(repoNode?.data.badges).toContain("all branches");
  });

  it("hides unrelated local branches in focused mode", () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/hidden",
      fullRef: "refs/heads/feature/hidden",
      upstream: null,
      worktreePath: null,
      createdAt: "99",
    });

    const graph = buildGraph([snapshot], { branchMode: "focused", showStashes: false });
    const repoNode = graph.nodes.find((node) => node.data.kind === "repository");

    expect(graph.nodes.some((node) => node.data.title === "feature/hidden")).toBe(false);
    expect(repoNode?.data.badges).toContain("1/2 branches");
    expect(repoNode?.data.badges).toContain("1 hidden");
  });

  it("renders stash nodes only when enabled", () => {
    const hidden = buildGraph([snapshotFixture()]);

    expect(hidden.nodes.some((node) => node.data.kind === "stash")).toBe(false);

    const shown = buildGraph([snapshotFixture()], { branchMode: "all", showStashes: true });

    expect(shown.nodes.some((node) => node.data.title === "stash@{0}")).toBe(true);
    expect(shown.edges.some((edge) => edge.className === "git-edge git-edge-stash")).toBe(true);
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
