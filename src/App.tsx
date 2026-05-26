import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CanvasView } from "./components/CanvasView";
import { Inspector } from "./components/Inspector";
import { RepoSidebar } from "./components/RepoSidebar";
import * as api from "./lib/api";
import { buildGraph, type GitFlowNode } from "./lib/graph";
import type {
  ActivityEntry,
  CommandResult,
  RepositorySnapshot,
  SafetyPreview,
} from "./lib/types";

export default function App() {
  const [snapshots, setSnapshots] = useState<RepositorySnapshot[]>([]);
  const [selectedNode, setSelectedNode] = useState<GitFlowNode | null>(null);
  const [preview, setPreview] = useState<SafetyPreview | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const graph = useMemo(() => buildGraph(snapshots), [snapshots]);

  const pushActivity = useCallback((operation: string, result: CommandResult) => {
    setActivity((entries) => [
      {
        id: `${Date.now()}:${operation}`,
        operation,
        summary: result.summary,
        command: result.command,
        ok: result.ok,
        createdAt: new Date().toISOString(),
      },
      ...entries,
    ]);
  }, []);

  const pushFailure = useCallback((operation: string, reason: unknown) => {
    const summary = reason instanceof Error ? reason.message : String(reason);
    setActivity((entries) => [
      {
        id: `${Date.now()}:${operation}`,
        operation,
        summary,
        ok: false,
        createdAt: new Date().toISOString(),
      },
      ...entries,
    ]);
    setError(summary);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshots(await api.scanAllRepositories());
    } catch (reason) {
      pushFailure("refresh", reason);
    } finally {
      setLoading(false);
    }
  }, [pushFailure]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addRepository() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Add Git repository",
      });
      if (typeof selected !== "string") return;
      await run("add repository", async () => {
        const repo = await api.addRepository(selected);
        return {
          ok: true,
          summary: `Added ${repo.displayName}`,
          command: `add_repository ${repo.path}`,
          changedPaths: [repo.path],
        };
      });
    } catch (reason) {
      pushFailure("open folder dialog", reason);
    }
  }

  async function run(operation: string, action: () => Promise<CommandResult>) {
    setError(null);
    try {
      const result = await action();
      pushActivity(operation, result);
      await refresh();
    } catch (reason) {
      pushFailure(operation, reason);
    }
  }

  async function createWorktree(repoPath: string, branch: string) {
    const worktreePath = window.prompt("Worktree path");
    if (!worktreePath) return;
    await run("create worktree", () =>
      api.createWorktree(repoPath, branch, worktreePath, false),
    );
  }

  async function confirmPreview() {
    if (!preview) return;
    if (preview.operation === "deleteWorktree" && preview.targetPath) {
      await run("delete worktree", () =>
        api.deleteWorktree(preview.targetPath!, preview.riskLevel === "high"),
      );
    }
    if (preview.operation === "deleteBranch" && preview.targetPath && selectedNode?.data.branch) {
      await run("delete branch", () =>
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
    run("add repository", async () => {
      const repo = await api.addRepository(file.path!);
      return {
        ok: true,
        summary: `Added ${repo.displayName}`,
        command: `add_repository ${repo.path}`,
        changedPaths: [repo.path],
      };
    });
  }

  return (
    <main
      className="app-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <RepoSidebar
        snapshots={snapshots}
        loading={loading}
        onAddRepository={addRepository}
        onRefresh={refresh}
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
            <button className="primary-action" onClick={addRepository}>
              Add repository
            </button>
          </section>
        )}
      </section>
      <Inspector
        selectedNode={selectedNode}
        preview={preview}
        activity={activity}
        onOpen={(path, kind) => run("open path", () => api.openPath(path, kind))}
        onFetch={(repoPath) => run("fetch", () => api.fetchRepository(repoPath))}
        onPull={(path) => run("pull", () => api.pullWorktree(path))}
        onPush={(path) => run("push", () => api.pushBranch(path))}
        onStash={(path) => run("stash", () => api.stashWorktree(path))}
        onCreateWorktree={createWorktree}
        onPreviewDeleteWorktree={async (path) => {
          try {
            setPreview(await api.deleteWorktreePreview(path));
          } catch (reason) {
            pushFailure("preview delete worktree", reason);
          }
        }}
        onPreviewDeleteBranch={async (repoPath, branch) => {
          try {
            setPreview(await api.deleteBranchPreview(repoPath, branch));
          } catch (reason) {
            pushFailure("preview delete branch", reason);
          }
        }}
        onConfirmPreview={confirmPreview}
        onCancelPreview={() => setPreview(null)}
      />
    </main>
  );
}
