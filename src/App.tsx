import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CanvasView } from "./components/CanvasView";
import { Inspector } from "./components/Inspector";
import { RepoSidebar } from "./components/RepoSidebar";
import * as api from "./lib/api";
import { buildGraph, type BranchMode, type GitFlowNode } from "./lib/graph";
import type { RepositorySnapshot, SafetyPreview } from "./lib/types";

export default function App() {
  const [snapshots, setSnapshots] = useState<RepositorySnapshot[]>([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GitFlowNode | null>(null);
  const [preview, setPreview] = useState<SafetyPreview | null>(null);
  const [branchMode, setBranchMode] = useState<BranchMode>("all");
  const [showStashes, setShowStashes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [isPending, startTransition] = useTransition();
  const refreshRequestId = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const selectedSnapshot = useMemo(
    () =>
      snapshots.find((snapshot) => snapshot.repo.path === selectedRepoPath) ??
      snapshots[0] ??
      null,
    [selectedRepoPath, snapshots],
  );
  const graph = useMemo(
    () => buildGraph(selectedSnapshot ? [selectedSnapshot] : [], { branchMode, showStashes }),
    [branchMode, selectedSnapshot, showStashes],
  );

  const pushFailure = useCallback((reason: unknown) => {
    const summary = reason instanceof Error ? reason.message : String(reason);
    setError(summary);
  }, []);

  const refresh = useCallback(async () => {
    const requestId = refreshRequestId.current + 1;
    refreshRequestId.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const nextSnapshots = await api.scanAllRepositories();
      if (requestId !== refreshRequestId.current) return;
      startTransition(() => {
        setSnapshots(nextSnapshots);
      });
    } catch (reason) {
      if (requestId === refreshRequestId.current) {
        pushFailure(reason);
      }
    } finally {
      if (requestId === refreshRequestId.current) {
        setLoading(false);
      }
    }
  }, [pushFailure, startTransition]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!snapshots.length) {
      setSelectedNode(null);
      return;
    }

    if (
      !selectedRepoPath ||
      !snapshots.some((snapshot) => snapshot.repo.path === selectedRepoPath)
    ) {
      setSelectedRepoPath(snapshots[0].repo.path);
      setSelectedNode(null);
    }
  }, [selectedRepoPath, snapshots]);

  const selectRepository = useCallback((path: string) => {
    setSelectedRepoPath(path);
    setSelectedNode(null);
    setPreview(null);
  }, []);

  async function addRepository() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Add Git repository or workspace",
      });
      if (typeof selected !== "string") return;
      await addSelectedRepository(selected);
    } catch (reason) {
      pushFailure(reason);
    }
  }

  async function addSelectedRepository(path: string) {
    setAdding(true);
    setError(null);
    try {
      const repos = await api.addRepositories(path);
      if (repos[0]) {
        selectRepository(repos[0].path);
      }
      await refresh();
    } catch (reason) {
      pushFailure(reason);
    } finally {
      setAdding(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (reason) {
      pushFailure(reason);
    }
  }

  async function createWorktree(repoPath: string, branch: string) {
    const worktreePath = window.prompt("Worktree path");
    if (!worktreePath) return;
    await run(() => api.createWorktree(repoPath, branch, worktreePath, false));
  }

  async function confirmPreview() {
    if (!preview) return;
    if (preview.operation === "deleteWorktree" && preview.targetPath) {
      await run(() => api.deleteWorktree(preview.targetPath!, preview.riskLevel === "high"));
    }
    if (preview.operation === "deleteBranch" && preview.targetPath && selectedNode?.data.branch) {
      await run(() =>
        api.deleteBranch(
          preview.targetPath!,
          selectedNode.data.branch!,
          preview.riskLevel === "high",
        ),
      );
    }
    setPreview(null);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0) as (File & { path?: string }) | null;
    if (!file?.path) return;
    void addSelectedRepository(file.path);
  }

  return (
    <main
      className="app-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <RepoSidebar
        snapshots={snapshots}
        loading={loading || isPending}
        adding={adding}
        selectedRepoPath={selectedSnapshot?.repo.path ?? null}
        onAddRepository={addRepository}
        onRefresh={refresh}
        onSelectRepository={selectRepository}
        branchMode={branchMode}
        showStashes={showStashes}
        onBranchModeChange={setBranchMode}
        onShowStashesChange={setShowStashes}
      />
      <section className="work-area">
        {error ? <div className="error-banner">{error}</div> : null}
        {snapshots.length ? (
          <CanvasView
            graph={graph}
            selectedId={selectedNode?.id ?? null}
            onSelect={setSelectedNode}
          />
        ) : (
          <section className="empty-state">
            <p className="eyebrow">No repositories</p>
            <h2>Add a Git folder</h2>
            <p>Choose a repository directory or drop one anywhere on this window.</p>
            <button
              className="primary-action"
              onClick={addRepository}
              disabled={adding}
              aria-busy={adding}
            >
              {adding ? "Adding..." : "Add repository"}
            </button>
          </section>
        )}
      </section>
      <Inspector
        selectedNode={selectedNode}
        preview={preview}
        onOpen={(path, kind) => run(() => api.openPath(path, kind))}
        onFetch={(repoPath) => run(() => api.fetchRepository(repoPath))}
        onPull={(path) => run(() => api.pullWorktree(path))}
        onPush={(path) => run(() => api.pushBranch(path))}
        onStash={(path) => run(() => api.stashWorktree(path))}
        onCreateWorktree={createWorktree}
        onPreviewDeleteWorktree={async (path) => {
          try {
            setPreview(await api.deleteWorktreePreview(path));
          } catch (reason) {
            pushFailure(reason);
          }
        }}
        onPreviewDeleteBranch={async (repoPath, branch) => {
          try {
            setPreview(await api.deleteBranchPreview(repoPath, branch));
          } catch (reason) {
            pushFailure(reason);
          }
        }}
        onConfirmPreview={confirmPreview}
        onCancelPreview={() => setPreview(null)}
      />
    </main>
  );
}
