import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type {
  BranchSnapshot,
  RepositorySnapshot,
  StashSnapshot,
  WorktreeSnapshot,
} from "./types";
import { dirtyTotal } from "./types";

export type GitNodeKind = "repository" | "worktree" | "branch" | "stash";
export type BranchMode = "all" | "focused";
export type GitEdgeKind =
  | "worktree"
  | "dirtyWorktree"
  | "checkedOut"
  | "branch"
  | "stash";

export interface GitNodeData extends Record<string, unknown> {
  kind: GitNodeKind;
  title: string;
  subtitle: string;
  badges: string[];
  handles?: GitNodeHandles;
  repoPath: string;
  path?: string;
  branch?: string;
  upstream?: string;
  defaultBranch?: string;
  isActive?: boolean;
  isMainWorktree?: boolean;
  ahead?: number;
  behind?: number;
  lastCommitSha?: string;
  upstreamTipSha?: string;
  dirtyCount?: number;
  diagnostics?: string[];
}

export type GitFlowNode = Node<GitNodeData, "gitNode">;
export type GitFlowEdge = Edge<GitEdgeData>;

export interface GitNodeHandles {
  source: string[];
  target: string[];
}

export interface GitEdgeData extends Record<string, unknown> {
  kind: GitEdgeKind;
  label: string;
  description: string;
}

export interface GitGraph {
  nodes: GitFlowNode[];
  edges: GitFlowEdge[];
}

export interface GitGraphOptions {
  branchMode: BranchMode;
  showStashes: boolean;
}

const primaryBranchNames = new Set(["main", "master", "test", "prerelease"]);
const defaultGraphOptions: GitGraphOptions = {
  branchMode: "all",
  showStashes: false,
};

const repoX = 0;
const worktreeX = 340;
const branchStartX = 680;
const branchColumnWidth = 280;
const stashGapX = 340;
const worktreeRowHeight = 132;
const branchRowHeight = 104;
const stashRowHeight = 92;
const branchRowsPerColumn = 9;
const projectGap = 220;

const edgeMarker = {
  type: MarkerType.ArrowClosed,
  width: 14,
  height: 14,
  color: "rgba(245,241,232,0.62)",
};

const edgeColors = {
  worktree: "rgba(99,214,181,0.74)",
  checkedOut: "rgba(245,241,232,0.66)",
  branch: "rgba(226,93,122,0.48)",
  stash: "rgba(243,179,91,0.58)",
};

function edgeStyle(kind: keyof typeof edgeColors) {
  return {
    stroke: edgeColors[kind],
    strokeWidth: kind === "worktree" ? 1.8 : 1.35,
    opacity: kind === "branch" ? 0.5 : 0.82,
  };
}

export function buildGraph(
  snapshots: RepositorySnapshot[],
  options: GitGraphOptions = defaultGraphOptions,
): GitGraph {
  const nodes: GitFlowNode[] = [];
  const edges: GitFlowEdge[] = [];
  const nodeHandles = new Map<string, GitNodeHandles>();
  let baseY = 0;

  sortByCreatedDesc(snapshots, (snapshot) => snapshot.repo.createdAt).forEach((snapshot) => {
    const worktrees = sortByCreatedDesc(snapshot.worktrees, (worktree) => worktree.createdAt);
    const localBranches =
      options.branchMode === "all"
        ? sortByCreatedDesc(snapshot.localBranches, (branch) => branch.createdAt)
        : visibleLocalBranches(snapshot.localBranches, worktrees);
    const branchColumns = columnCount(localBranches.length, branchRowsPerColumn);
    const visibleStashCount = options.showStashes ? snapshot.stashes.length : 0;
    const worktreeByBranch = new Map(
      worktrees
        .filter((worktree) => worktree.branch)
        .map((worktree) => [worktree.branch, worktree] as const),
    );
    const remoteBranchByName = new Map(
      snapshot.remoteBranches.map((branch) => [branch.name, branch] as const),
    );
    const hiddenBranchCount = snapshot.localBranches.length - localBranches.length;
    const repoId = repoNodeId(snapshot.repo.path);
    nodes.push({
      id: repoId,
      type: "gitNode",
      position: { x: repoX, y: baseY },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      data: {
        kind: "repository",
        title: snapshot.repo.displayName,
        subtitle: compactPath(snapshot.repo.path),
        badges: [
          `${worktrees.length} worktrees`,
          options.branchMode === "all"
            ? `${snapshot.localBranches.length} branches`
            : `${localBranches.length}/${snapshot.localBranches.length} branches`,
          snapshot.stashes.length ? `${snapshot.stashes.length} stashes` : "",
          hiddenBranchCount ? `${hiddenBranchCount} hidden` : "all branches",
          snapshot.diagnostics.length ? "needs attention" : "tracked",
        ].filter((badge): badge is string => Boolean(badge)),
        repoPath: snapshot.repo.path,
        path: snapshot.repo.path,
        defaultBranch: snapshot.defaultBranch ?? undefined,
        diagnostics: snapshot.diagnostics,
      },
    });

    worktrees.forEach((worktree, index) => {
      const nodeId = worktreeNodeId(worktree.path);
      const dirty = dirtyTotal(worktree.dirtySummary) > 0;
      nodes.push(worktreeNode(snapshot.repo.path, worktree, index, baseY));
      edges.push({
        id: `${repoId}->${nodeId}`,
        source: repoId,
        target: nodeId,
        sourceHandle: addNodeHandle(nodeHandles, repoId, "source"),
        targetHandle: addNodeHandle(nodeHandles, nodeId, "target"),
        type: "gitCurve",
        className: "git-edge git-edge-worktree",
        data: edgeData(dirty ? "dirtyWorktree" : "worktree"),
        markerEnd: edgeMarker,
        style: edgeStyle("worktree"),
        animated: dirty,
      });
    });

    localBranches.forEach((branch, index) => {
      const nodeId = branchNodeId(snapshot.repo.path, branch.name);
      const worktree = worktreeByBranch.get(branch.name);
      const upstreamBranch = branch.upstream
        ? remoteBranchByName.get(branch.upstream)
        : undefined;
      nodes.push(branchNode(snapshot.repo.path, branch, index, baseY, worktree, upstreamBranch));

      if (worktree) {
        edges.push({
          id: `${worktreeNodeId(worktree.path)}->${nodeId}`,
          source: worktreeNodeId(worktree.path),
          target: nodeId,
          sourceHandle: addNodeHandle(nodeHandles, worktreeNodeId(worktree.path), "source"),
          targetHandle: addNodeHandle(nodeHandles, nodeId, "target"),
          type: "gitCurve",
          className: "git-edge git-edge-checked-out",
          data: edgeData("checkedOut"),
          markerEnd: edgeMarker,
          style: edgeStyle("checkedOut"),
        });
      } else {
        edges.push({
          id: `${repoId}->${nodeId}`,
          source: repoId,
          target: nodeId,
          sourceHandle: addNodeHandle(nodeHandles, repoId, "source"),
          targetHandle: addNodeHandle(nodeHandles, nodeId, "target"),
          type: "gitCurve",
          className: "git-edge git-edge-branch",
          data: edgeData("branch"),
          markerEnd: edgeMarker,
          style: edgeStyle("branch"),
        });
      }
    });

    if (options.showStashes) {
      sortByCreatedDesc(snapshot.stashes, (stash) => stash.createdAt).forEach((stash, index) => {
        const nodeId = stashNodeId(snapshot.repo.path, stash.id);
        nodes.push(stashNode(snapshot.repo.path, stash, index, baseY, branchColumns));
        edges.push({
          id: `${repoId}->${nodeId}`,
          source: repoId,
          target: nodeId,
          sourceHandle: addNodeHandle(nodeHandles, repoId, "source"),
          targetHandle: addNodeHandle(nodeHandles, nodeId, "target"),
          type: "gitCurve",
          className: "git-edge git-edge-stash",
          data: edgeData("stash"),
          markerEnd: edgeMarker,
          style: edgeStyle("stash"),
        });
      });
    }

    baseY += projectHeight(worktrees.length, localBranches.length, visibleStashCount) + projectGap;
  });

  return {
    nodes: nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        handles: nodeHandles.get(node.id),
      },
    })),
    edges,
  };
}

function worktreeNode(
  repoPath: string,
  worktree: WorktreeSnapshot,
  index: number,
  baseY: number,
): GitFlowNode {
  const dirty = dirtyTotal(worktree.dirtySummary);
  const isMainWorktree = worktree.path.replace(/\/+$/, "") === repoPath.replace(/\/+$/, "");
  const badges = [
    dirty ? `${dirty} dirty` : "clean",
    worktree.locked ? "locked" : "open",
    worktree.prunable ? "prunable" : isMainWorktree ? "main" : "active",
    worktree.scanError ? "scan issue" : "",
  ].filter(Boolean);

  return {
    id: worktreeNodeId(worktree.path),
    type: "gitNode",
    position: { x: worktreeX, y: baseY + index * worktreeRowHeight },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: false,
    data: {
      kind: "worktree",
      title: folderName(worktree.path),
      subtitle: worktree.branch ?? "detached HEAD",
      badges,
      repoPath,
      path: worktree.path,
      branch: worktree.branch ?? undefined,
      isMainWorktree,
      dirtyCount: dirty,
      diagnostics: worktree.scanError ? [worktree.scanError] : undefined,
    },
  };
}

function branchNode(
  repoPath: string,
  branch: BranchSnapshot,
  index: number,
  baseY: number,
  worktree?: WorktreeSnapshot,
  upstreamBranch?: BranchSnapshot,
): GitFlowNode {
  const column = Math.floor(index / branchRowsPerColumn);
  const row = index % branchRowsPerColumn;

  return {
    id: branchNodeId(repoPath, branch.name),
    type: "gitNode",
    position: {
      x: branchStartX + column * branchColumnWidth,
      y: baseY + row * branchRowHeight,
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: false,
    data: {
      kind: "branch",
      title: branch.name,
      subtitle: branch.lastCommit?.subject ?? branch.fullRef,
      badges: branchBadges(branch),
      repoPath,
      branch: branch.name,
      upstream: branch.upstream ?? undefined,
      path: branch.worktreePath ?? undefined,
      isActive: Boolean(branch.worktreePath),
      ahead: branch.ahead,
      behind: branch.behind,
      lastCommitSha: branch.lastCommit?.sha,
      upstreamTipSha: upstreamBranch?.lastCommit?.sha,
      dirtyCount: worktree ? dirtyTotal(worktree.dirtySummary) : 0,
    },
  };
}

function branchBadges(branch: BranchSnapshot) {
  const badges = [];
  if (branch.ahead) badges.push(`${branch.ahead} ahead`);
  if (branch.behind) badges.push(`${branch.behind} behind`);
  if (branch.worktreePath) badges.push("active");
  if (branch.isMergedToDefault) badges.push("merged");
  if (!badges.length) badges.push(branch.upstream ? "tracked" : "local");
  return badges;
}

function edgeData(kind: GitEdgeKind): GitEdgeData {
  const labels: Record<GitEdgeKind, Pick<GitEdgeData, "label" | "description">> = {
    worktree: {
      label: "Repository -> Worktree",
      description: "Repository owns this worktree directory",
    },
    dirtyWorktree: {
      label: "Dirty worktree",
      description: "This worktree has uncommitted changes",
    },
    checkedOut: {
      label: "Worktree -> Branch",
      description: "This worktree currently checks out this branch",
    },
    branch: {
      label: "Repository -> Branch",
      description: "Local branch exists but is not checked out by a worktree",
    },
    stash: {
      label: "Repository -> Stash",
      description: "Repository contains this saved stash",
    },
  };
  const label = labels[kind];

  return {
    kind,
    label: label.label,
    description: label.description,
  };
}

function addNodeHandle(
  handlesByNode: Map<string, GitNodeHandles>,
  nodeId: string,
  side: keyof GitNodeHandles,
) {
  const handles = handlesByNode.get(nodeId) ?? { source: [], target: [] };
  const handleId = `${nodeId}:${side}:${handles[side].length}`;
  handles[side].push(handleId);
  handlesByNode.set(nodeId, handles);
  return handleId;
}

function stashNode(
  repoPath: string,
  stash: StashSnapshot,
  index: number,
  baseY: number,
  branchColumns: number,
): GitFlowNode {
  return {
    id: stashNodeId(repoPath, stash.id),
    type: "gitNode",
    position: {
      x: branchStartX + branchColumns * branchColumnWidth + stashGapX,
      y: baseY + index * stashRowHeight,
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: false,
    data: {
      kind: "stash",
      title: stash.id,
      subtitle: stash.message,
      badges: ["stash"],
      repoPath,
    },
  };
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

function visibleLocalBranches(
  branches: BranchSnapshot[],
  worktrees: WorktreeSnapshot[],
) {
  const worktreeBranches = new Set(
    worktrees
      .map((worktree) => worktree.branch)
      .filter((branch): branch is string => Boolean(branch)),
  );

  return sortByCreatedDesc(branches, (branch) => branch.createdAt).filter(
    (branch) => worktreeBranches.has(branch.name) || primaryBranchNames.has(branch.name),
  );
}

function columnCount(itemCount: number, rowsPerColumn: number) {
  return Math.max(1, Math.ceil(itemCount / rowsPerColumn));
}

function projectHeight(worktreeCount: number, branchCount: number, stashCount: number) {
  const branchRows = Math.min(branchCount, branchRowsPerColumn);
  return Math.max(
    160,
    worktreeCount * worktreeRowHeight,
    branchRows * branchRowHeight,
    stashCount * stashRowHeight,
  );
}

function sortByCreatedDesc<T>(items: T[], getCreatedAt: (item: T) => string | null | undefined) {
  return [...items].sort((left, right) => {
    const rightTime = Number(getCreatedAt(right) ?? 0);
    const leftTime = Number(getCreatedAt(left) ?? 0);
    return rightTime - leftTime;
  });
}
