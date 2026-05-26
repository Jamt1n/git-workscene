export interface RepositoryRecord {
  id: string;
  path: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  lastScannedAt: string | null;
  pinned: boolean;
  archived: boolean;
}

export interface DirtySummary {
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
  untracked: number;
  conflicted: number;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  relativeTime: string;
}

export interface WorktreeSnapshot {
  path: string;
  branch: string | null;
  headSha: string | null;
  createdAt: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  scanError: string | null;
  dirtySummary: DirtySummary;
  lastCommit: CommitSummary | null;
}

export interface BranchSnapshot {
  name: string;
  fullRef: string;
  createdAt: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isMergedToDefault: boolean;
  worktreePath: string | null;
  lastCommit: CommitSummary | null;
  isRemote: boolean;
}

export interface StashSnapshot {
  id: string;
  createdAt: string;
  message: string;
}

export interface RepositorySnapshot {
  repo: RepositoryRecord;
  worktrees: WorktreeSnapshot[];
  localBranches: BranchSnapshot[];
  remoteBranches: BranchSnapshot[];
  stashes: StashSnapshot[];
  diagnostics: string[];
}

export interface SafetyPreview {
  operation: "deleteWorktree" | "deleteBranch" | string;
  riskLevel: "low" | "medium" | "high" | "blocked" | string;
  title: string;
  facts: string[];
  blockers: string[];
  command: string;
  requiresConfirmation: boolean;
  targetPath: string | null;
}

export interface CommandResult {
  ok: boolean;
  summary: string;
  command: string;
  changedPaths: string[];
}

export interface ActivityEntry {
  id: string;
  operation: string;
  summary: string;
  command?: string;
  ok: boolean;
  createdAt: string;
}

export function dirtyTotal(summary: DirtySummary) {
  return (
    summary.modified +
    summary.added +
    summary.deleted +
    summary.renamed +
    summary.untracked +
    summary.conflicted
  );
}
