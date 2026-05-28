import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  Bell,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { BranchMode } from "../lib/graph";
import type { RepositorySnapshot } from "../lib/types";

interface RepoSidebarProps {
  snapshots: RepositorySnapshot[];
  loading: boolean;
  adding: boolean;
  updateStatus: "idle" | "checking" | "available" | "installing" | "ready" | "up-to-date" | "error";
  selectedRepoPath: string | null;
  branchMode: BranchMode;
  showStashes: boolean;
  onAddRepository: () => void;
  onRefresh: () => void;
  onCheckForUpdates: () => void;
  onSelectRepository: (path: string) => void;
  onRemoveRepository: (path: string) => void;
  onReorderRepositories: (sourcePath: string, targetPath: string) => void;
  onBranchModeChange: (mode: BranchMode) => void;
  onShowStashesChange: (show: boolean) => void;
}

export function RepoSidebar({
  snapshots,
  loading,
  adding,
  updateStatus,
  selectedRepoPath,
  branchMode,
  showStashes,
  onAddRepository,
  onRefresh,
  onCheckForUpdates,
  onSelectRepository,
  onRemoveRepository,
  onReorderRepositories,
  onBranchModeChange,
  onShowStashesChange,
}: RepoSidebarProps) {
  const [repoFilter, setRepoFilter] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );
  const normalizedRepoFilter = repoFilter.trim().toLowerCase();
  const visibleSnapshots = useMemo(() => {
    if (!normalizedRepoFilter) return snapshots;
    return snapshots.filter((snapshot) =>
      `${snapshot.repo.displayName}\n${snapshot.repo.path}`.toLowerCase().includes(
        normalizedRepoFilter,
      ),
    );
  }, [normalizedRepoFilter, snapshots]);
  const visibleRepoPaths = visibleSnapshots.map((snapshot) => snapshot.repo.path);

  function handleRepositoryDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorderRepositories(String(active.id), String(over.id));
  }

  return (
    <aside className="sidebar">
      <header className="brand">
        <div>
          <p className="eyebrow">Git Workscene</p>
          <h1>Workspace Map</h1>
        </div>
        <div className="brand-actions">
          <button
            title="Check for updates"
            aria-label="Check for updates"
            className={updateStatus === "available" ? "has-update" : ""}
            onClick={onCheckForUpdates}
            disabled={updateStatus === "checking" || updateStatus === "installing"}
          >
            {updateStatus === "checking" || updateStatus === "installing" ? (
              <LoaderCircle className="loading-icon" size={16} />
            ) : (
              <Bell size={16} />
            )}
          </button>
          <button title="Refresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <button
        className="primary-action"
        onClick={onAddRepository}
        disabled={adding}
        aria-busy={adding}
      >
        {adding ? <LoaderCircle className="loading-icon" size={16} /> : <FolderPlus size={16} />}
        {adding ? "Adding..." : "Add repository"}
      </button>

      <div className="search-shell">
        <Search size={15} />
        <input
          placeholder="Filter repos"
          value={repoFilter}
          onChange={(event) => setRepoFilter(event.currentTarget.value)}
        />
      </div>

      <section className="view-controls" aria-label="Graph view controls">
        <div className="view-control-row">
          <span>
            <GitBranch size={14} />
            Branches
          </span>
          <div className="segmented-control">
            <button
              className={branchMode === "all" ? "is-active" : ""}
              onClick={() => onBranchModeChange("all")}
            >
              All
            </button>
            <button
              className={branchMode === "focused" ? "is-active" : ""}
              onClick={() => onBranchModeChange("focused")}
            >
              Focused
            </button>
          </div>
        </div>
        <label className="toggle-row">
          <span>
            <Archive size={14} />
            Stashes
          </span>
          <input
            type="checkbox"
            checked={showStashes}
            onChange={(event) => onShowStashesChange(event.currentTarget.checked)}
          />
        </label>
      </section>

      <div className="repo-list">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleRepositoryDragEnd}
        >
          <SortableContext items={visibleRepoPaths} strategy={verticalListSortingStrategy}>
            {visibleSnapshots.map((snapshot) => (
              <SortableRepositoryRow
                key={snapshot.repo.path}
                snapshot={snapshot}
                selected={selectedRepoPath === snapshot.repo.path}
                onSelectRepository={onSelectRepository}
                onRemoveRepository={onRemoveRepository}
              />
            ))}
          </SortableContext>
        </DndContext>
        {repoFilter && !visibleSnapshots.length ? (
          <p className="repo-empty">No matching repositories</p>
        ) : null}
      </div>
    </aside>
  );
}

function SortableRepositoryRow({
  snapshot,
  selected,
  onSelectRepository,
  onRemoveRepository,
}: {
  snapshot: RepositorySnapshot;
  selected: boolean;
  onSelectRepository: (path: string) => void;
  onRemoveRepository: (path: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: snapshot.repo.path,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      className={["repo-row", selected ? "is-active" : "", isDragging ? "is-dragging" : ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
      {...attributes}
      {...listeners}
    >
      <button
        className="repo-select"
        aria-label={`Select ${snapshot.repo.displayName}`}
        onClick={() => onSelectRepository(snapshot.repo.path)}
      >
        <strong>{snapshot.repo.displayName}</strong>
        <span>{snapshot.repo.path}</span>
        <div>
          <b>{snapshot.worktrees.length}</b> worktrees
          <b>{snapshot.localBranches.length}</b> branches
        </div>
      </button>
      <button
        className="repo-remove"
        title="Remove repository"
        aria-label={`Remove ${snapshot.repo.displayName}`}
        onClick={() => onRemoveRepository(snapshot.repo.path)}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
