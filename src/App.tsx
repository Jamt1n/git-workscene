import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Bell,
  Download,
  GripVertical,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { CanvasView } from "./components/CanvasView";
import { Inspector } from "./components/Inspector";
import { RepoSidebar } from "./components/RepoSidebar";
import * as api from "./lib/api";
import { buildGraph, type BranchMode, type GitFlowNode } from "./lib/graph";
import type { RepositorySnapshot, SafetyPreview } from "./lib/types";

const AUTO_REFRESH_INTERVAL_MS = 3000;
const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 720;
const INSPECTOR_DEFAULT_WIDTH = 380;
const INSPECTOR_COLLAPSED_WIDTH = 46;
const REPOSITORY_ORDER_STORAGE_KEY = "git-workscene.repository-order.v1";

interface PreviewContext {
  nodeId: string;
  repoPath: string;
  branch?: string;
  worktreePath?: string;
}

type PendingUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

interface UpdateNotice {
  kind: "idle" | "checking" | "available" | "installing" | "ready" | "up-to-date" | "error";
  message: string;
  version?: string;
}

export default function App() {
  const [snapshots, setSnapshots] = useState<RepositorySnapshot[]>([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GitFlowNode | null>(null);
  const [preview, setPreview] = useState<SafetyPreview | null>(null);
  const [previewContext, setPreviewContext] = useState<PreviewContext | null>(null);
  const [branchMode, setBranchMode] = useState<BranchMode>("all");
  const [showStashes, setShowStashes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [adding, setAdding] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [repositoryOrder, setRepositoryOrder] = useState<string[]>(readRepositoryOrder);
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice>({
    kind: "idle",
    message: "",
  });
  const [isPending, startTransition] = useTransition();
  const refreshRequestId = useRef(0);
  const previewRequestId = useRef(0);
  const pendingUpdateRef = useRef<PendingUpdate | null>(null);
  const snapshotsRef = useRef<RepositorySnapshot[]>([]);
  const selectedRepoPathRef = useRef<string | null>(null);
  const autoRefreshBlockedRef = useRef(false);
  const autoRefreshInFlightRef = useRef(false);
  const previewBusyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const orderedSnapshots = useMemo(
    () => orderSnapshots(snapshots, repositoryOrder),
    [repositoryOrder, snapshots],
  );
  const selectedSnapshot = useMemo(
    () =>
      orderedSnapshots.find((snapshot) => snapshot.repo.path === selectedRepoPath) ??
      orderedSnapshots[0] ??
      null,
    [orderedSnapshots, selectedRepoPath],
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
        setInitialized(true);
      }
    }
  }, [pushFailure, startTransition]);

  const refreshRepository = useCallback(
    async (
      repoPath: string,
      options: { quiet?: boolean; ignoreErrors?: boolean } = {},
    ) => {
      const requestId = refreshRequestId.current + 1;
      refreshRequestId.current = requestId;
      if (!options.quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        const nextSnapshot = await api.scanRepository(repoPath);
        if (requestId !== refreshRequestId.current) return;
        startTransition(() => {
          setSnapshots((current) => {
            const exists = current.some(
              (snapshot) => snapshot.repo.path === nextSnapshot.repo.path,
            );
            if (!exists) return [nextSnapshot, ...current];
            return current.map((snapshot) =>
              snapshot.repo.path === nextSnapshot.repo.path ? nextSnapshot : snapshot,
            );
          });
        });
      } catch (reason) {
        if (requestId === refreshRequestId.current && !options.ignoreErrors) {
          pushFailure(reason);
        }
      } finally {
        if (requestId === refreshRequestId.current) {
          if (!options.quiet) {
            setLoading(false);
          }
          setInitialized(true);
        }
      }
    },
    [pushFailure, startTransition],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    snapshotsRef.current = orderedSnapshots;
  }, [orderedSnapshots]);

  useEffect(() => {
    selectedRepoPathRef.current = selectedRepoPath;
  }, [selectedRepoPath]);

  useEffect(() => {
    autoRefreshBlockedRef.current = loading || adding || previewLoading || previewBusy;
  }, [adding, loading, previewBusy, previewLoading]);

  useEffect(() => {
    previewBusyRef.current = previewBusy;
  }, [previewBusy]);

  const autoRefreshSelectedRepository = useCallback(() => {
    if (
      autoRefreshBlockedRef.current ||
      autoRefreshInFlightRef.current ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const snapshots = snapshotsRef.current;
    const repoPath = selectedRepoPathRef.current ?? snapshots[0]?.repo.path;
    if (!repoPath) return;

    autoRefreshInFlightRef.current = true;
    void refreshRepository(repoPath, { quiet: true, ignoreErrors: true }).finally(() => {
      autoRefreshInFlightRef.current = false;
    });
  }, [refreshRepository]);

  useEffect(() => {
    const refreshOnFocus = () => autoRefreshSelectedRepository();
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        autoRefreshSelectedRepository();
      }
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);
    const intervalId = window.setInterval(
      autoRefreshSelectedRepository,
      AUTO_REFRESH_INTERVAL_MS,
    );

    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.clearInterval(intervalId);
    };
  }, [autoRefreshSelectedRepository]);

  useEffect(() => {
    if (!orderedSnapshots.length) {
      setSelectedNode(null);
      cancelPreview();
      return;
    }

    if (!selectedRepoPath) {
      setSelectedRepoPath(orderedSnapshots[0].repo.path);
      return;
    }

    if (!orderedSnapshots.some((snapshot) => snapshot.repo.path === selectedRepoPath)) {
      setSelectedRepoPath(orderedSnapshots[0].repo.path);
      setSelectedNode(null);
      cancelPreview();
    }
  }, [orderedSnapshots, selectedRepoPath]);

  useEffect(() => {
    if (!selectedNode) return;
    const nextNode = graph.nodes.find((node) => node.id === selectedNode.id);
    if (nextNode !== selectedNode) {
      if (!nextNode) {
        cancelPreview();
      }
      setSelectedNode(nextNode ?? null);
    }
  }, [graph, selectedNode]);

  const selectNode = useCallback((node: GitFlowNode | null) => {
    if (previewBusyRef.current) return;
    cancelPreview();
    setSelectedNode(node);
  }, []);

  const selectRepository = useCallback(
    (path: string) => {
      setSelectedRepoPath(path);
      setSelectedNode(null);
      cancelPreview();
      void refreshRepository(path, { quiet: true, ignoreErrors: true });
    },
    [refreshRepository],
  );

  async function removeRepository(path: string) {
    const snapshot = snapshots.find((candidate) => candidate.repo.path === path);
    const label = snapshot?.repo.displayName ?? path;
    if (!window.confirm(`Remove ${label} from Git Workscene? Local files stay on disk.`)) {
      return;
    }

    setError(null);
    try {
      await api.removeRepository(path);
      setRepositoryOrder((currentOrder) =>
        persistRepositoryOrder(currentOrder.filter((candidate) => candidate !== path)),
      );
      startTransition(() => {
        setSnapshots((current) => current.filter((candidate) => candidate.repo.path !== path));
      });
      if (selectedRepoPath === path) {
        setSelectedRepoPath(null);
      }
      setSelectedNode(null);
      cancelPreview();
    } catch (reason) {
      pushFailure(reason);
    }
  }

  async function checkForUpdates() {
    pendingUpdateRef.current = null;
    setUpdateNotice({ kind: "checking", message: "Checking for updates..." });
    try {
      const update = await check();
      if (!update) {
        setUpdateNotice({ kind: "up-to-date", message: "Git Workscene is up to date." });
        return;
      }
      pendingUpdateRef.current = update;
      setUpdateNotice({
        kind: "available",
        message: update.body ? String(update.body) : "A new version is ready to install.",
        version: update.version,
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setUpdateNotice({ kind: "error", message });
    }
  }

  async function installUpdate() {
    const update = pendingUpdateRef.current;
    if (!update) {
      await checkForUpdates();
      return;
    }
    setUpdateNotice({
      kind: "installing",
      message: `Installing ${update.version}...`,
      version: update.version,
    });
    try {
      await update.downloadAndInstall();
      setUpdateNotice({
        kind: "ready",
        message: "Update installed. Restarting Git Workscene...",
        version: update.version,
      });
      await relaunch();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setUpdateNotice({ kind: "error", message, version: update.version });
    }
  }

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
        setRepositoryOrder((currentOrder) =>
          persistRepositoryOrder(
            prependRepositoryOrder(
              currentOrder,
              repos.map((repo) => repo.path),
            ),
          ),
        );
        selectRepository(repos[0].path);
      }
      await refresh();
    } catch (reason) {
      pushFailure(reason);
    } finally {
      setAdding(false);
    }
  }

  async function run(action: () => Promise<unknown>, refreshRepoPath?: string) {
    setError(null);
    try {
      await action();
      if (refreshRepoPath) {
        await refreshRepository(refreshRepoPath);
      } else {
        await refresh();
      }
      return true;
    } catch (reason) {
      pushFailure(reason);
      return false;
    }
  }

  async function loadPreview(
    pendingPreview: SafetyPreview,
    context: PreviewContext,
    request: () => Promise<SafetyPreview>,
  ) {
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    setError(null);
    setPreview(pendingPreview);
    setPreviewContext(context);
    setPreviewLoading(true);
    try {
      const nextPreview = await request();
      if (requestId === previewRequestId.current) {
        setPreview(nextPreview);
      }
    } catch (reason) {
      if (requestId === previewRequestId.current) {
        setPreview(null);
        setPreviewContext(null);
        pushFailure(reason);
      }
    } finally {
      if (requestId === previewRequestId.current) {
        setPreviewLoading(false);
      }
    }
  }

  async function createWorktree(repoPath: string, branch: string, worktreePath: string) {
    return await run(() => api.createWorktree(repoPath, branch, worktreePath, false), repoPath);
  }

  async function openPath(path: string, kind: "finder" | "terminal" | "editor") {
    setError(null);
    try {
      await api.openPath(path, kind);
      return true;
    } catch (reason) {
      pushFailure(reason);
      return false;
    }
  }

  async function confirmPreview(selectedBranches?: string[]) {
    if (!preview || !previewContext || previewLoading || previewBusy) return;
    const context = previewContext;
    setPreviewBusy(true);
    try {
      if (preview.operation === "deleteWorktree" && context.worktreePath) {
        await run(
          () =>
            api.deleteWorktree(
              context.repoPath,
              context.worktreePath!,
              preview.riskLevel === "high",
            ),
          context.repoPath,
        );
        setSelectedNode((current) => (current?.id === context.nodeId ? null : current));
      }
      if (preview.operation === "deleteBranch" && context.branch) {
        await run(
          () => api.deleteBranch(context.repoPath, context.branch!, preview.riskLevel === "high"),
          context.repoPath,
        );
        setSelectedNode((current) => (current?.id === context.nodeId ? null : current));
      }
      if (preview.operation === "cleanupMergedBranches") {
        await run(
          () =>
            api.cleanupSelectedMergedBranches(
              context.repoPath,
              selectedBranches ?? preview.branchNames,
            ),
          context.repoPath,
        );
      }
      if (preview.operation === "branchesOutsideTargets") {
        await run(
          () =>
            api.deleteSelectedBranches(
              context.repoPath,
              selectedBranches ?? preview.branchNames,
              true,
            ),
          context.repoPath,
        );
      }
      setPreview(null);
      setPreviewContext(null);
    } finally {
      setPreviewBusy(false);
    }
  }

  function cancelPreview() {
    if (previewBusyRef.current) return;
    previewRequestId.current += 1;
    setPreview(null);
    setPreviewContext(null);
    setPreviewLoading(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0) as (File & { path?: string }) | null;
    if (!file?.path) return;
    void addSelectedRepository(file.path);
  }

  function reorderRepositories(sourcePath: string, targetPath: string) {
    setRepositoryOrder((currentOrder) => {
      const currentPaths = orderSnapshots(snapshotsRef.current, currentOrder).map(
        (snapshot) => snapshot.repo.path,
      );
      const sourceIndex = currentPaths.indexOf(sourcePath);
      const targetIndex = currentPaths.indexOf(targetPath);
      if (sourceIndex === -1 || targetIndex === -1) return currentOrder;
      return persistRepositoryOrder(arrayMove(currentPaths, sourceIndex, targetIndex));
    });
  }

  function startInspectorResize(event: PointerEvent<HTMLDivElement>) {
    if (inspectorCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      setInspectorWidth(
        clamp(startWidth + startX - moveEvent.clientX, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH),
      );
    }

    function stopResize() {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
  }

  const initializing = !initialized || ((loading || isPending) && !orderedSnapshots.length);
  const shellStyle = {
    "--inspector-width": `${inspectorCollapsed ? INSPECTOR_COLLAPSED_WIDTH : inspectorWidth}px`,
  } as CSSProperties;

  return (
    <main
      className={`app-shell ${inspectorCollapsed ? "inspector-is-collapsed" : ""}`}
      style={shellStyle}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <RepoSidebar
        snapshots={orderedSnapshots}
        loading={loading || isPending}
        adding={adding}
        updateStatus={updateNotice.kind}
        selectedRepoPath={selectedSnapshot?.repo.path ?? null}
        onAddRepository={addRepository}
        onRefresh={refresh}
        onCheckForUpdates={() => void checkForUpdates()}
        onSelectRepository={selectRepository}
        onRemoveRepository={(path) => void removeRepository(path)}
        onReorderRepositories={reorderRepositories}
        branchMode={branchMode}
        showStashes={showStashes}
        onBranchModeChange={setBranchMode}
        onShowStashesChange={setShowStashes}
      />
      <section className="work-area">
        {error ? <div className="error-banner">{error}</div> : null}
        {updateNotice.kind !== "idle" ? (
          <div className={`update-banner update-banner-${updateNotice.kind}`} role="status">
            <Bell size={15} />
            <div>
              <strong>
                {updateNotice.kind === "available" && updateNotice.version
                  ? `Update ${updateNotice.version} available`
                  : updateNotice.kind === "checking"
                    ? "Checking for updates"
                    : updateNotice.kind === "installing"
                      ? "Installing update"
                      : updateNotice.kind === "ready"
                        ? "Update installed"
                        : updateNotice.kind === "error"
                          ? "Update check failed"
                          : "No update available"}
              </strong>
              <span>{updateNotice.message}</span>
            </div>
            {updateNotice.kind === "available" ? (
              <button onClick={() => void installUpdate()}>
                <Download size={14} />
                Install
              </button>
            ) : null}
            {updateNotice.kind === "checking" || updateNotice.kind === "installing" ? (
              <LoaderCircle className="loading-icon" size={15} />
            ) : (
              <button
                className="icon-button update-dismiss"
                aria-label="Dismiss update notice"
                title="Dismiss"
                onClick={() => setUpdateNotice({ kind: "idle", message: "" })}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ) : null}
        {orderedSnapshots.length ? (
          <CanvasView
            graph={graph}
            selectedId={selectedNode?.id ?? null}
            onSelect={selectNode}
          />
        ) : initializing ? (
          <section className="empty-state loading-state" aria-busy="true">
            <LoaderCircle className="loading-icon" size={22} />
            <p className="eyebrow">Loading</p>
            <h2>Loading workspace</h2>
            <p>Scanning saved repositories.</p>
          </section>
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
      <section
        className={`inspector-shell ${inspectorCollapsed ? "is-collapsed" : ""}`}
        aria-label="Inspector panel"
      >
        {inspectorCollapsed ? (
          <button
            className="inspector-rail-button"
            aria-label="Expand inspector"
            title="Expand inspector"
            onClick={() => setInspectorCollapsed(false)}
          >
            <PanelRightOpen size={18} />
            <span>Inspector</span>
          </button>
        ) : (
          <>
            <div
              className="inspector-resize-handle"
              role="separator"
              aria-label="Resize inspector"
              aria-orientation="vertical"
              onPointerDown={startInspectorResize}
            >
              <GripVertical size={14} />
            </div>
            <Inspector
              selectedNode={selectedNode}
              preview={preview}
              previewLoading={previewLoading}
              previewBusy={previewBusy}
              panelTools={
                <button
                  className="icon-button"
                  aria-label="Collapse inspector"
                  title="Collapse inspector"
                  onClick={() => setInspectorCollapsed(true)}
                >
                  <PanelRightClose size={16} />
                </button>
              }
              onOpen={openPath}
              onFetch={(repoPath) => run(() => api.fetchRepository(repoPath), repoPath)}
              onPull={(path) => run(() => api.pullWorktree(path), selectedNode?.data.repoPath)}
              onPush={(path) => run(() => api.pushBranch(path), selectedNode?.data.repoPath)}
              onStash={(path) => run(() => api.stashWorktree(path), selectedNode?.data.repoPath)}
              onCreateWorktree={createWorktree}
              onCheckoutBranch={(repoPath, branch) =>
                run(() => api.checkoutBranch(repoPath, branch), repoPath)
              }
              onFastForwardBranch={(repoPath, branch) =>
                run(() => api.fastForwardBranch(repoPath, branch), repoPath)
              }
              onPreviewDeleteWorktree={async (repoPath, path) => {
                await loadPreview(
                  pendingPreview("deleteWorktree", "Delete worktree", path, null),
                  {
                    nodeId: selectedNode?.id ?? `worktree:${path}`,
                    repoPath,
                    worktreePath: path,
                  },
                  () => api.deleteWorktreePreview(repoPath, path),
                );
              }}
              onPreviewDeleteBranch={async (repoPath, branch) => {
                await loadPreview(
                  pendingPreview("deleteBranch", "Delete branch", repoPath, branch),
                  {
                    nodeId: selectedNode?.id ?? `branch:${repoPath}:${branch}`,
                    repoPath,
                    branch,
                  },
                  () => api.deleteBranchPreview(repoPath, branch),
                );
              }}
              onPreviewCleanupMergedBranches={async (repoPath, defaultBranch) => {
                const branchLabel = defaultBranch ?? "main branch";
                await loadPreview(
                  pendingPreview(
                    "cleanupMergedBranches",
                    `Clean branches merged into ${branchLabel}`,
                    repoPath,
                    defaultBranch ?? null,
                  ),
                  {
                    nodeId: selectedNode?.id ?? `repo:${repoPath}`,
                    repoPath,
                  },
                  () => api.cleanupMergedBranchesPreview(repoPath),
                );
              }}
              onPreviewBranchesOutsideTargets={async (repoPath, defaultBranch) => {
                const branchLabel = defaultBranch ?? "main branch";
                await loadPreview(
                  pendingPreview(
                    "branchesOutsideTargets",
                    `Branches not in ${branchLabel}`,
                    repoPath,
                    defaultBranch ?? null,
                  ),
                  {
                    nodeId: selectedNode?.id ?? `repo:${repoPath}`,
                    repoPath,
                  },
                  () => api.branchesOutsideTargetsPreview(repoPath),
                );
              }}
              onLoadBranchCommits={async (repoPath, branch, offset, limit) => {
                try {
                  return await api.listBranchCommits(repoPath, branch, offset, limit);
                } catch (reason) {
                  pushFailure(reason);
                  throw reason;
                }
              }}
              onLoadWorktreeChanges={async (worktreePath) => {
                try {
                  return await api.listWorktreeChanges(worktreePath);
                } catch (reason) {
                  pushFailure(reason);
                  throw reason;
                }
              }}
              onConfirmPreview={confirmPreview}
              onCancelPreview={cancelPreview}
            />
          </>
        )}
      </section>
    </main>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readRepositoryOrder() {
  try {
    const value = window.localStorage.getItem(REPOSITORY_ORDER_STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((path): path is string => typeof path === "string" && path.length > 0);
  } catch {
    return [];
  }
}

function persistRepositoryOrder(paths: string[]) {
  const nextOrder = uniquePaths(paths);
  try {
    window.localStorage.setItem(REPOSITORY_ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
  } catch {
    return nextOrder;
  }
  return nextOrder;
}

function prependRepositoryOrder(currentOrder: string[], paths: string[]) {
  const nextPaths = uniquePaths(paths);
  const nextPathSet = new Set(nextPaths);
  return [...nextPaths, ...currentOrder.filter((path) => !nextPathSet.has(path))];
}

function orderSnapshots(snapshots: RepositorySnapshot[], order: string[]) {
  if (!order.length) return snapshots;
  const orderIndex = new Map(order.map((path, index) => [path, index]));
  return snapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((left, right) => {
      const leftIndex = orderIndex.get(left.snapshot.repo.path) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = orderIndex.get(right.snapshot.repo.path) ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.index - right.index;
    })
    .map(({ snapshot }) => snapshot);
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function pendingPreview(
  operation: SafetyPreview["operation"],
  title: string,
  targetPath: string,
  targetBranch: string | null,
): SafetyPreview {
  return {
    operation,
    riskLevel: "loading",
    title,
    facts: ["Loading safety preview..."],
    blockers: [],
    command: "Loading command preview...",
    requiresConfirmation: operation !== "branchesOutsideTargets",
    targetPath,
    targetBranch,
    branchNames: [],
  };
}
