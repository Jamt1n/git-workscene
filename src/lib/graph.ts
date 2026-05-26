import type { Edge, Node } from "@xyflow/react";
import type { BranchSnapshot, RepositorySnapshot, WorktreeSnapshot } from "./types";
import { dirtyTotal } from "./types";

export type GitNodeKind = "repository" | "worktree" | "branch" | "remote" | "stash";

export interface GitNodeData extends Record<string, unknown> {
  kind: GitNodeKind;
  title: string;
  subtitle: string;
  badges: string[];
  repoPath: string;
  path?: string;
  branch?: string;
  isRemote?: boolean;
  diagnostics?: string[];
}

export type GitFlowNode = Node<GitNodeData, "gitNode">;

export interface GitGraph {
  nodes: GitFlowNode[];
  edges: Edge[];
}

export function buildGraph(snapshots: RepositorySnapshot[]): GitGraph {
  const nodes: GitFlowNode[] = [];
  const edges: Edge[] = [];

  snapshots.forEach((snapshot, repoIndex) => {
    const baseY = repoIndex * 420;
    const repoId = repoNodeId(snapshot.repo.path);
    nodes.push({
      id: repoId,
      type: "gitNode",
      position: { x: 0, y: baseY },
      data: {
        kind: "repository",
        title: snapshot.repo.displayName,
        subtitle: compactPath(snapshot.repo.path),
        badges: [
          `${snapshot.worktrees.length} worktrees`,
          `${snapshot.localBranches.length} branches`,
          snapshot.diagnostics.length ? "needs attention" : "tracked",
        ],
        repoPath: snapshot.repo.path,
        path: snapshot.repo.path,
        diagnostics: snapshot.diagnostics,
      },
    });

    snapshot.worktrees.forEach((worktree, index) => {
      const nodeId = worktreeNodeId(worktree.path);
      nodes.push(worktreeNode(snapshot.repo.path, worktree, index, baseY));
      edges.push({
        id: `${repoId}->${nodeId}`,
        source: repoId,
        target: nodeId,
        type: "smoothstep",
        animated: dirtyTotal(worktree.dirtySummary) > 0,
      });
    });

    snapshot.localBranches.forEach((branch, index) => {
      const nodeId = branchNodeId(snapshot.repo.path, branch.name);
      nodes.push(branchNode(snapshot.repo.path, branch, index, baseY, false));

      const worktree = snapshot.worktrees.find(
        (candidate) => candidate.branch === branch.name,
      );
      if (worktree) {
        edges.push({
          id: `${worktreeNodeId(worktree.path)}->${nodeId}`,
          source: worktreeNodeId(worktree.path),
          target: nodeId,
          type: "smoothstep",
        });
      } else {
        edges.push({
          id: `${repoId}->${nodeId}`,
          source: repoId,
          target: nodeId,
          type: "smoothstep",
          style: { opacity: 0.35 },
        });
      }

      if (branch.upstream) {
        edges.push({
          id: `${nodeId}->${remoteNodeId(snapshot.repo.path, branch.upstream)}`,
          source: nodeId,
          target: remoteNodeId(snapshot.repo.path, branch.upstream),
          type: "smoothstep",
          style: { strokeDasharray: "6 5" },
        });
      }
    });

    snapshot.remoteBranches.slice(0, 24).forEach((branch, index) => {
      nodes.push(branchNode(snapshot.repo.path, branch, index, baseY, true));
    });

    snapshot.stashes.forEach((stash, index) => {
      const nodeId = stashNodeId(snapshot.repo.path, stash.id);
      nodes.push({
        id: nodeId,
        type: "gitNode",
        position: { x: 1040, y: baseY + index * 92 },
        data: {
          kind: "stash",
          title: stash.id,
          subtitle: stash.message,
          badges: ["stash"],
          repoPath: snapshot.repo.path,
        },
      });
      edges.push({
        id: `${repoId}->${nodeId}`,
        source: repoId,
        target: nodeId,
        type: "smoothstep",
        style: { opacity: 0.45 },
      });
    });
  });

  return { nodes, edges };
}

function worktreeNode(
  repoPath: string,
  worktree: WorktreeSnapshot,
  index: number,
  baseY: number,
): GitFlowNode {
  const dirty = dirtyTotal(worktree.dirtySummary);
  const badges = [
    dirty ? `${dirty} dirty` : "clean",
    worktree.locked ? "locked" : "open",
    worktree.prunable ? "prunable" : "active",
    worktree.scanError ? "scan issue" : "",
  ].filter(Boolean);

  return {
    id: worktreeNodeId(worktree.path),
    type: "gitNode",
    position: { x: 340, y: baseY + index * 132 },
    data: {
      kind: "worktree",
      title: folderName(worktree.path),
      subtitle: worktree.branch ?? "detached HEAD",
      badges,
      repoPath,
      path: worktree.path,
      branch: worktree.branch ?? undefined,
      diagnostics: worktree.scanError ? [worktree.scanError] : undefined,
    },
  };
}

function branchNode(
  repoPath: string,
  branch: BranchSnapshot,
  index: number,
  baseY: number,
  remote: boolean,
): GitFlowNode {
  return {
    id: remote ? remoteNodeId(repoPath, branch.name) : branchNodeId(repoPath, branch.name),
    type: "gitNode",
    position: { x: remote ? 980 : 680, y: baseY + index * 104 },
    data: {
      kind: remote ? "remote" : "branch",
      title: branch.name,
      subtitle: branch.lastCommit?.subject ?? branch.fullRef,
      badges: branchBadges(branch),
      repoPath,
      branch: branch.name,
      path: branch.worktreePath ?? undefined,
      isRemote: remote,
    },
  };
}

function branchBadges(branch: BranchSnapshot) {
  const badges = [];
  if (branch.ahead) badges.push(`${branch.ahead} ahead`);
  if (branch.behind) badges.push(`${branch.behind} behind`);
  if (branch.worktreePath) badges.push("worktree");
  if (branch.isMergedToDefault) badges.push("merged");
  if (!badges.length) badges.push(branch.isRemote ? "remote" : "local");
  return badges;
}

export function repoNodeId(repoPath: string) {
  return `repo:${repoPath}`;
}

export function worktreeNodeId(path: string) {
  return `worktree:${path}`;
}

export function branchNodeId(repoPath: string, branch: string) {
  return `branch:${repoPath}:${branch}`;
}

export function remoteNodeId(repoPath: string, branch: string) {
  return `remote:${repoPath}:${branch}`;
}

export function stashNodeId(repoPath: string, stash: string) {
  return `stash:${repoPath}:${stash}`;
}

function folderName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function compactPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : path;
}
