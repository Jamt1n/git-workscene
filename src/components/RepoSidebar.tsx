import { FolderPlus, RefreshCw, Search } from "lucide-react";
import type { RepositorySnapshot } from "../lib/types";

interface RepoSidebarProps {
  snapshots: RepositorySnapshot[];
  loading: boolean;
  selectedRepoPath: string | null;
  onAddRepository: () => void;
  onRefresh: () => void;
  onSelectRepository: (path: string) => void;
}

export function RepoSidebar({
  snapshots,
  loading,
  selectedRepoPath,
  onAddRepository,
  onRefresh,
  onSelectRepository,
}: RepoSidebarProps) {
  const worktreeCount = snapshots.reduce(
    (count, snapshot) => count + snapshot.worktrees.length,
    0,
  );
  const branchCount = snapshots.reduce(
    (count, snapshot) => count + snapshot.localBranches.length,
    0,
  );

  return (
    <aside className="sidebar">
      <header className="brand">
        <div>
          <p className="eyebrow">Git Workscene</p>
          <h1>Workspace Map</h1>
        </div>
        <button title="Refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} />
        </button>
      </header>

      <button className="primary-action" onClick={onAddRepository}>
        <FolderPlus size={16} />
        Add repository
      </button>

      <div className="search-shell">
        <Search size={15} />
        <input placeholder="Filter repos" />
      </div>

      <nav className="nav-groups">
        <Group label="Repositories" value={snapshots.length} />
        <Group label="Worktrees" value={worktreeCount} />
        <Group label="Branches" value={branchCount} />
        <Group
          label="Stashes"
          value={snapshots.reduce((count, snapshot) => count + snapshot.stashes.length, 0)}
        />
      </nav>

      <div className="repo-list">
        {snapshots.map((snapshot) => (
          <button
            key={snapshot.repo.path}
            className={`repo-row ${selectedRepoPath === snapshot.repo.path ? "is-active" : ""}`}
            onClick={() => onSelectRepository(snapshot.repo.path)}
          >
            <strong>{snapshot.repo.displayName}</strong>
            <span>{snapshot.repo.path}</span>
            <div>
              <b>{snapshot.worktrees.length}</b> worktrees
              <b>{snapshot.localBranches.length}</b> branches
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Group({ label, value }: { label: string; value: number }) {
  return (
    <div className="nav-group">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
