import {
  ChevronDown,
  Code2,
  Check,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitPullRequestArrow,
  Download,
  Loader2,
  ShieldAlert,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { GitFlowNode } from "../lib/graph";
import type {
  CommitListItem,
  CommitPage,
  FileChangeItem,
  SafetyPreview,
} from "../lib/types";

const commitPageSize = 30;
type ActionResult = void | boolean | Promise<void | boolean>;

interface CommitComparisonRow {
  id: string;
  local: CommitListItem | null;
  remote: CommitListItem | null;
  mismatch: boolean;
}

interface CommitInsight {
  tone: "local" | "synced" | "attention" | "missing";
  title: string;
  detail: string;
  visibleRows: CommitComparisonRow[];
  latestCommit: CommitListItem | null;
  comparisonMode: boolean;
}

interface InspectorProps {
  selectedNode: GitFlowNode | null;
  preview: SafetyPreview | null;
  previewLoading?: boolean;
  previewBusy?: boolean;
  onOpen: (path: string, kind: "finder" | "terminal" | "editor") => ActionResult;
  onFetch: (repoPath: string) => ActionResult;
  onPull: (path: string) => ActionResult;
  onPush: (path: string) => ActionResult;
  onStash: (path: string) => ActionResult;
  onCreateWorktree: (repoPath: string, branch: string, worktreePath: string) => ActionResult;
  onCheckoutBranch: (repoPath: string, branch: string) => ActionResult;
  onFastForwardBranch: (repoPath: string, branch: string) => ActionResult;
  onPreviewDeleteWorktree: (repoPath: string, path: string) => void;
  onPreviewDeleteBranch: (repoPath: string, branch: string) => void;
  onPreviewCleanupMergedBranches: (repoPath: string, defaultBranch?: string) => void;
  onPreviewBranchesOutsideTargets: (repoPath: string, defaultBranch?: string) => void;
  onLoadBranchCommits: (
    repoPath: string,
    branch: string,
    offset: number,
    limit: number,
  ) => Promise<CommitPage>;
  onLoadWorktreeChanges: (worktreePath: string) => Promise<FileChangeItem[]>;
  onConfirmPreview: (branches?: string[]) => void;
  onCancelPreview: () => void;
  panelTools?: ReactNode;
}

export function Inspector({
  selectedNode,
  preview,
  previewLoading = false,
  previewBusy = false,
  onOpen,
  onFetch,
  onPull,
  onPush,
  onStash,
  onCreateWorktree,
  onCheckoutBranch,
  onFastForwardBranch,
  onPreviewDeleteWorktree,
  onPreviewDeleteBranch,
  onPreviewCleanupMergedBranches,
  onPreviewBranchesOutsideTargets,
  onLoadBranchCommits,
  onLoadWorktreeChanges,
  onConfirmPreview,
  onCancelPreview,
  panelTools,
}: InspectorProps) {
  const data = selectedNode?.data;
  const branchListPreview =
    preview?.operation === "cleanupMergedBranches" ||
    preview?.operation === "branchesOutsideTargets"
      ? preview
      : null;
  const [copiedField, setCopiedField] = useState<"path" | "branch" | null>(null);
  const [commitPanelOpen, setCommitPanelOpen] = useState(false);
  const [commitRows, setCommitRows] = useState<CommitComparisonRow[]>([]);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [hasMoreCommits, setHasMoreCommits] = useState(true);
  const [changesPanelOpen, setChangesPanelOpen] = useState(false);
  const [fileChanges, setFileChanges] = useState<FileChangeItem[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [createWorktreeDraft, setCreateWorktreeDraft] = useState<{
    repoPath: string;
    branch: string;
    path: string;
  } | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const canInspectChanges = Boolean(
    data?.path && (data.kind === "worktree" || (data.kind === "branch" && data.isActive)),
  );
  const changesKey = canInspectChanges && data?.path ? data.path : "";
  const dirtyCount = Number(data?.dirtyCount ?? 0);
  const commitKey =
    data?.kind === "branch" && data.branch
      ? [
          data.repoPath,
          data.branch,
          data.upstream ?? "",
          data.ahead ?? 0,
          data.behind ?? 0,
          data.lastCommitSha ?? "",
          data.upstreamTipSha ?? "",
        ].join("\0")
      : "";
  const changesKeyRef = useRef(changesKey);
  const changesLoadingKeyRef = useRef<string | null>(null);
  const commitKeyRef = useRef(commitKey);
  const commitLoadingKeyRef = useRef<string | null>(null);
  const actionNoticeTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const pathValue = data ? (data.path ?? data.repoPath) : "";

  useEffect(() => {
    commitKeyRef.current = commitKey;
    commitLoadingKeyRef.current = null;
    setCommitPanelOpen(Boolean(commitKey));
    setCommitRows([]);
    setCommitError(null);
    setCommitLoading(false);
    setHasMoreCommits(true);
    if (commitKey) {
      void loadBranchCommits(0);
    }
  }, [commitKey]);

  useEffect(() => {
    changesKeyRef.current = changesKey;
    changesLoadingKeyRef.current = null;
    setFileChanges([]);
    setChangesError(null);
    setChangesLoading(false);
    setChangesPanelOpen(Boolean(changesKey && dirtyCount > 0));
    if (changesKey && dirtyCount > 0) {
      void loadWorktreeChanges();
    }
  }, [changesKey, dirtyCount]);

  useEffect(() => {
    setCreateWorktreeDraft(null);
  }, [selectedNode?.id]);

  useEffect(
    () => () => {
      if (actionNoticeTimerRef.current) {
        window.clearTimeout(actionNoticeTimerRef.current);
      }
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  async function copyValue(field: "path" | "branch", value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopiedField(null), 1500);
  }

  async function runAction(actionId: string, successMessage: string, action: () => ActionResult) {
    if (activeAction) return false;
    if (actionNoticeTimerRef.current) {
      window.clearTimeout(actionNoticeTimerRef.current);
    }
    setActionNotice(null);
    setActiveAction(actionId);
    try {
      const result = await action();
      if (result !== false) {
        setActionNotice(successMessage);
        actionNoticeTimerRef.current = window.setTimeout(() => setActionNotice(null), 2200);
        return true;
      }
      return false;
    } catch {
      // The parent action owns error presentation; keep the inspector button state tidy.
      return false;
    } finally {
      setActiveAction(null);
    }
  }

  async function loadBranchCommits(offset: number) {
    if (!data?.branch || !commitKey || commitLoadingKeyRef.current === commitKey) return;

    const requestKey = commitKey;
    const repoPath = data.repoPath;
    const branch = data.branch;
    const upstream = typeof data.upstream === "string" ? data.upstream : null;
    commitLoadingKeyRef.current = requestKey;
    setCommitLoading(true);
    setCommitError(null);

    try {
      const [localPage, remotePage] = await Promise.all([
        onLoadBranchCommits(repoPath, branch, offset, commitPageSize),
        upstream ? onLoadBranchCommits(repoPath, upstream, offset, commitPageSize) : null,
      ]);
      if (commitKeyRef.current !== requestKey) return;
      const rows = compareCommits(localPage.commits, remotePage?.commits ?? [], Boolean(upstream));
      setCommitRows((current) => (offset === 0 ? rows : [...current, ...rows]));
      setHasMoreCommits(localPage.hasMore || Boolean(remotePage?.hasMore));
    } catch (reason) {
      if (commitKeyRef.current !== requestKey) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setCommitError(message);
    } finally {
      if (commitKeyRef.current === requestKey) {
        commitLoadingKeyRef.current = null;
        setCommitLoading(false);
      }
    }
  }

  async function loadWorktreeChanges() {
    if (!changesKey || changesLoadingKeyRef.current === changesKey) return;

    const requestKey = changesKey;
    changesLoadingKeyRef.current = requestKey;
    setChangesLoading(true);
    setChangesError(null);

    try {
      const changes = await onLoadWorktreeChanges(requestKey);
      if (changesKeyRef.current !== requestKey) return;
      setFileChanges(changes);
    } catch (reason) {
      if (changesKeyRef.current !== requestKey) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setChangesError(message);
    } finally {
      if (changesKeyRef.current === requestKey) {
        changesLoadingKeyRef.current = null;
        setChangesLoading(false);
      }
    }
  }

  function toggleChangesPanel() {
    const nextOpen = !changesPanelOpen;
    setChangesPanelOpen(nextOpen);
    if (nextOpen && !fileChanges.length && !changesLoading) {
      void loadWorktreeChanges();
    }
  }

  function toggleCommitPanel() {
    const nextOpen = !commitPanelOpen;
    setCommitPanelOpen(nextOpen);
    if (nextOpen && commitRows.length === 0 && !commitLoading) {
      void loadBranchCommits(0);
    }
  }

  function openCreateWorktreeDialog(repoPath: string, branch: string) {
    setCreateWorktreeDraft({
      repoPath,
      branch,
      path: defaultWorktreePath(repoPath, branch),
    });
  }

  async function confirmCreateWorktree() {
    if (!createWorktreeDraft) return;
    const worktreePath = createWorktreeDraft.path.trim();
    if (!worktreePath) return;

    const created = await runAction(
      "create-worktree",
      `Created worktree for ${createWorktreeDraft.branch}`,
      () =>
        onCreateWorktree(
          createWorktreeDraft.repoPath,
          createWorktreeDraft.branch,
          worktreePath,
        ),
    );
    if (created) {
      setCreateWorktreeDraft(null);
    }
  }

  const actionsDisabled = Boolean(activeAction);
  const checkoutActionId = data?.branch ? `checkout:${data.branch}` : "checkout";
  const checkoutBusy = activeAction === checkoutActionId;
  const fastForwardActionId = data?.branch ? `fast-forward:${data.branch}` : "fast-forward";
  const fastForwardBusy = activeAction === fastForwardActionId;
  const showFastForward =
    data?.kind === "branch" &&
    Boolean(data.branch && data.upstream && Number(data.behind ?? 0) > 0);
  const fastForwardBlocked = Number(data?.ahead ?? 0) > 0;
  const fetchSuccessMessage =
    data?.kind === "branch" && data.upstream
      ? "Fetched remote refs; local branch is unchanged"
      : "Fetched remote refs";
  const commitInsight =
    data?.kind === "branch" && data.branch && (commitRows.length || !commitLoading)
      ? summarizeCommitInsight(data, commitRows, hasMoreCommits)
      : null;

  return (
    <>
      <aside className="inspector">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Inspector</p>
          <h2>{data?.title ?? "Select a node"}</h2>
        </div>
        {panelTools ? <div className="panel-tools">{panelTools}</div> : null}
      </header>

      {data ? (
        <div
          className={`inspector-content ${
            data.kind === "branch" && data.branch ? "with-commits" : ""
          }`}
        >
          <dl className="detail-list">
            <div>
              <dt>Type</dt>
              <dd>{data.kind}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd>
                <button
                  className="copy-value"
                  aria-label="Copy path"
                  title="Copy path"
                  onClick={() => void copyValue("path", pathValue)}
                >
                  <span>{pathValue}</span>
                  {copiedField === "path" ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </dd>
            </div>
            {data.branch ? (
              <div>
                <dt>Branch</dt>
                <dd>
                  <button
                    className="copy-value"
                    aria-label="Copy branch"
                    title="Copy branch"
                    onClick={() => void copyValue("branch", data.branch!)}
                  >
                    <span>{data.branch}</span>
                    {copiedField === "branch" ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </dd>
              </div>
            ) : null}
            {data.kind === "branch" ? (
              <div>
                <dt>State</dt>
                <dd>{branchStateLabel(data)}</dd>
              </div>
            ) : null}
          </dl>

          {changesKey ? (
            <FileChangesPanel
              open={changesPanelOpen}
              dirtyCount={dirtyCount}
              changes={fileChanges}
              loading={changesLoading}
              error={changesError}
              onToggle={toggleChangesPanel}
              onReload={() => void loadWorktreeChanges()}
            />
          ) : null}

          <div className="action-grid">
            {data.path ? (
              <>
                <button
                  title="Reveal in Finder"
                  disabled={actionsDisabled}
                  onClick={() =>
                    void runAction("open:finder", "Opened in Finder", () =>
                      onOpen(data.path!, "finder"),
                    )
                  }
                >
                  <FolderOpen size={16} />
                  <span>Finder</span>
                </button>
                <button
                  title="Open terminal"
                  disabled={actionsDisabled}
                  onClick={() =>
                    void runAction("open:terminal", "Terminal opened", () =>
                      onOpen(data.path!, "terminal"),
                    )
                  }
                >
                  <Terminal size={16} />
                  <span>Terminal</span>
                </button>
                <button
                  title="Open editor"
                  disabled={actionsDisabled}
                  onClick={() =>
                    void runAction("open:editor", "Editor opened", () =>
                      onOpen(data.path!, "editor"),
                    )
                  }
                >
                  <Code2 size={16} />
                  <span>Editor</span>
                </button>
              </>
            ) : null}

            <button
              title="Fetch"
              disabled={actionsDisabled}
              onClick={() =>
                void runAction("fetch", fetchSuccessMessage, () => onFetch(data.repoPath))
              }
            >
              {activeAction === "fetch" ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              <span>{activeAction === "fetch" ? "Fetching..." : "Fetch"}</span>
            </button>

            {data.kind === "repository" ? (
              <>
                <button
                  className="danger"
                  title={`Preview clean local branches merged into ${data.defaultBranch ?? "the main branch"}`}
                  disabled={actionsDisabled}
                  onClick={() => onPreviewCleanupMergedBranches(data.repoPath, data.defaultBranch)}
                >
                  <Trash2 size={16} />
                  <span>Clean {data.defaultBranch ?? "branch"}</span>
                </button>
                <button
                  title={`List local branches not in ${data.defaultBranch ?? "the main branch"}`}
                  disabled={actionsDisabled}
                  onClick={() => onPreviewBranchesOutsideTargets(data.repoPath, data.defaultBranch)}
                >
                  <GitBranch size={16} />
                  <span>Unmerged</span>
                </button>
              </>
            ) : null}

            {data.kind === "worktree" && data.path ? (
              <>
                <button
                  title="Pull"
                  disabled={actionsDisabled}
                  onClick={() =>
                    void runAction("pull", "Pulled latest changes", () => onPull(data.path!))
                  }
                >
                  {activeAction === "pull" ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <GitPullRequestArrow size={16} />
                  )}
                  <span>{activeAction === "pull" ? "Pulling..." : "Pull"}</span>
                </button>
                <button
                  title="Push"
                  disabled={actionsDisabled}
                  onClick={() =>
                    void runAction("push", "Pushed branch", () => onPush(data.path!))
                  }
                >
                  {activeAction === "push" ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <GitBranch size={16} />
                  )}
                  <span>{activeAction === "push" ? "Pushing..." : "Push"}</span>
                </button>
                <button
                  title="Stash"
                  disabled={actionsDisabled}
                  onClick={() =>
                    void runAction("stash", "Stashed worktree changes", () => onStash(data.path!))
                  }
                >
                  {activeAction === "stash" ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <ShieldAlert size={16} />
                  )}
                  <span>{activeAction === "stash" ? "Stashing..." : "Stash"}</span>
                </button>
                {!data.isMainWorktree ? (
                  <button
                    className="danger"
                    title="Preview delete worktree"
                    disabled={actionsDisabled}
                    onClick={() => onPreviewDeleteWorktree(data.repoPath, data.path!)}
                  >
                    <Trash2 size={16} />
                    <span>Delete</span>
                  </button>
                ) : null}
              </>
            ) : null}

            {data.kind === "branch" && data.branch ? (
              <>
                {data.isActive && data.path ? (
                  <button
                    title="Pull current worktree"
                    disabled={actionsDisabled}
                    onClick={() =>
                      void runAction("pull", "Pulled latest changes", () => onPull(data.path!))
                    }
                  >
                    {activeAction === "pull" ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <GitPullRequestArrow size={16} />
                    )}
                    <span>{activeAction === "pull" ? "Pulling..." : "Pull"}</span>
                  </button>
                ) : null}
                <button
                  className={data.isActive ? "success" : ""}
                  title={data.isActive ? "This branch is already checked out" : "Checkout branch"}
                  disabled={actionsDisabled || data.isActive}
                  aria-busy={checkoutBusy}
                  onClick={() =>
                    void runAction(checkoutActionId, `Checked out ${data.branch}`, () =>
                      onCheckoutBranch(data.repoPath, data.branch!),
                    )
                  }
                >
                  {checkoutBusy ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  <span>
                    {checkoutBusy ? "Switching..." : data.isActive ? "Current" : "Checkout"}
                  </span>
                </button>
                {showFastForward ? (
                  <button
                    title={
                      fastForwardBlocked
                        ? "Branch has local commits; update is not a safe fast-forward"
                        : `Update local ${data.branch} to ${data.upstream}`
                    }
                    disabled={actionsDisabled || fastForwardBlocked}
                    aria-busy={fastForwardBusy}
                    onClick={() =>
                      void runAction(fastForwardActionId, `Updated local ${data.branch}`, () =>
                        onFastForwardBranch(data.repoPath, data.branch!),
                      )
                    }
                  >
                    {fastForwardBusy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <GitPullRequestArrow size={16} />
                    )}
                    <span>{fastForwardBusy ? "Updating..." : "Update local"}</span>
                  </button>
                ) : null}
                <button
                  title="Create worktree"
                  disabled={actionsDisabled}
                  onClick={() => openCreateWorktreeDialog(data.repoPath, data.branch!)}
                >
                  <GitBranch size={16} />
                  <span>Worktree</span>
                </button>
                <button
                  className="danger"
                  title="Preview delete branch"
                  disabled={actionsDisabled}
                  onClick={() => onPreviewDeleteBranch(data.repoPath, data.branch!)}
                >
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              </>
            ) : null}
          </div>

          {actionNotice ? (
            <div className="action-feedback" role="status">
              <Check size={14} />
              <span>{actionNotice}</span>
            </div>
          ) : null}

          {Array.isArray(data.diagnostics) && data.diagnostics.length ? (
            <section className="diagnostics">
              <strong>Diagnostics</strong>
              {data.diagnostics.map((diagnostic) => (
                <p key={diagnostic}>{diagnostic}</p>
              ))}
            </section>
          ) : null}

          {data.kind === "worktree" && data.isMainWorktree ? (
            <section className="diagnostics">
              <strong>Main working tree</strong>
              <p>Use the project list trash button to remove this repository from Git Workscene.</p>
            </section>
          ) : null}

          {data.kind === "branch" && data.branch ? (
            <section className={`commit-panel ${commitPanelOpen ? "is-open" : ""}`}>
              <button
                className="commit-panel-toggle"
                aria-expanded={commitPanelOpen}
                onClick={toggleCommitPanel}
              >
                <GitCommit size={16} />
                <span>Commits</span>
                {commitLoading ? (
                  <Loader2 className="spin" size={14} />
                ) : (
                  <ChevronDown className="commit-chevron" size={16} />
                )}
              </button>
              {commitPanelOpen ? (
                <div className="commit-list">
                  {commitInsight ? (
                    <CommitSummaryCard
                      insight={commitInsight}
                      upstream={data.upstream}
                      showLatest={!commitInsight.visibleRows.length}
                    />
                  ) : null}
                  {commitInsight?.visibleRows.length ? (
                    <div className="commit-diff-list">
                      {commitInsight.visibleRows.map((row) =>
                        commitInsight.comparisonMode ? (
                          <CommitCompareRow row={row} key={row.id} />
                        ) : (
                          <CommitTimelineRow commit={row.local} key={row.id} />
                        ),
                      )}
                    </div>
                  ) : null}
                  {!commitLoading && !commitRows.length && !commitError ? (
                    <p className="muted">No commits.</p>
                  ) : null}
                  {commitLoading ? <p className="muted">Loading...</p> : null}
                  {commitError ? <p className="commit-error">{commitError}</p> : null}
                  {hasMoreCommits && !commitLoading && commitRows.length ? (
                    <button
                      className="commit-load-more"
                      onClick={() => void loadBranchCommits(commitRows.length)}
                    >
                      Load more
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : (
        <p className="muted">Pick a repo, worktree, or branch to see its state and actions.</p>
      )}

      </aside>

      {preview && !branchListPreview ? (
        <SafetyPreviewModal
          preview={preview}
          loading={previewLoading}
          busy={previewBusy}
          onCancel={onCancelPreview}
          onConfirm={() => onConfirmPreview()}
        />
      ) : null}

      {branchListPreview ? (
        <BranchListModal
          preview={branchListPreview}
          loading={previewLoading}
          busy={previewBusy}
          onCancel={onCancelPreview}
          onConfirm={onConfirmPreview}
        />
      ) : null}

      {createWorktreeDraft ? (
        <CreateWorktreeModal
          draft={createWorktreeDraft}
          busy={activeAction === "create-worktree"}
          onChangePath={(path) =>
            setCreateWorktreeDraft((current) => (current ? { ...current, path } : current))
          }
          onCancel={() => setCreateWorktreeDraft(null)}
          onConfirm={() => void confirmCreateWorktree()}
        />
      ) : null}
    </>
  );
}

function CreateWorktreeModal({
  draft,
  busy,
  onChangePath,
  onCancel,
  onConfirm,
}: {
  draft: { branch: string; path: string };
  busy: boolean;
  onChangePath: (path: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm();
  }

  return (
    <section
      className="cleanup-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-worktree-title"
    >
      <form className="cleanup-modal worktree-create-modal" onSubmit={submit}>
        <header className="cleanup-modal-header">
          <div>
            <p className="eyebrow">Worktree</p>
            <h2 id="create-worktree-title">Create worktree</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close create worktree"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </header>

        <div className="cleanup-modal-body worktree-create-body">
          <label className="worktree-field">
            <span>Branch</span>
            <code>{draft.branch}</code>
          </label>
          <label className="worktree-field">
            <span>Worktree path</span>
            <input
              autoFocus
              value={draft.path}
              disabled={busy}
              onChange={(event) => onChangePath(event.target.value)}
            />
          </label>
        </div>

        <footer className="cleanup-modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-modal-action"
            type="submit"
            disabled={busy || !draft.path.trim()}
            aria-busy={busy}
          >
            {busy ? <Loader2 className="spin" size={14} /> : <GitBranch size={14} />}
            <span>{busy ? "Creating..." : "Create worktree"}</span>
          </button>
        </footer>
      </form>
    </section>
  );
}

function defaultWorktreePath(repoPath: string, branch: string) {
  const normalizedRepoPath = repoPath.replace(/\/+$/, "");
  const slashIndex = normalizedRepoPath.lastIndexOf("/");
  const parentPath = slashIndex >= 0 ? normalizedRepoPath.slice(0, slashIndex) : "";
  const repoName = slashIndex >= 0 ? normalizedRepoPath.slice(slashIndex + 1) : normalizedRepoPath;
  const branchSlug =
    branch
      .replace(/^origin\//, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "worktree";
  const worktreeName = `${repoName}-${branchSlug}`;
  return parentPath ? `${parentPath}/${worktreeName}` : worktreeName;
}

function SafetyPreviewModal({
  preview,
  loading,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: SafetyPreview;
  loading: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      className="cleanup-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-preview-title"
    >
      <div className={`cleanup-modal safety-preview-modal preview-${preview.riskLevel}`}>
        <header className="cleanup-modal-header">
          <div>
            <p className="eyebrow">Safety preview</p>
            <h2 id="safety-preview-title">{preview.title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close safety preview"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </header>

        <div className="cleanup-modal-body">
          <section className={`preview preview-${preview.riskLevel}`}>
            <div className="preview-title">
              <ShieldAlert size={16} />
              <strong>{preview.title}</strong>
            </div>
            <ul>
              {preview.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            {preview.blockers.length ? (
              <div className="blockers">
                {preview.blockers.map((blocker) => (
                  <p key={blocker}>{blocker}</p>
                ))}
              </div>
            ) : null}
            {loading ? (
              <div className="preview-loading-row">
                <Loader2 className="spin" size={14} />
                <span>Preparing safety preview...</span>
              </div>
            ) : null}
            <code>{preview.command}</code>
          </section>
        </div>

        <footer className="cleanup-modal-actions">
          <button disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="danger"
            disabled={preview.riskLevel === "blocked" || loading || busy}
            onClick={onConfirm}
          >
            {loading ? "Loading..." : busy ? "Working..." : "Confirm"}
          </button>
        </footer>
      </div>
    </section>
  );
}

function FileChangesPanel({
  open,
  dirtyCount,
  changes,
  loading,
  error,
  onToggle,
  onReload,
}: {
  open: boolean;
  dirtyCount: number;
  changes: FileChangeItem[];
  loading: boolean;
  error: string | null;
  onToggle: () => void;
  onReload: () => void;
}) {
  const summary = summarizeFileChanges(changes);
  const changeCount = dirtyCount || changes.length;

  return (
    <section className={`file-changes-panel ${open ? "is-open" : ""}`}>
      <button
        className="file-changes-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <FileText size={16} />
        <span>
          <strong>File Changes</strong>
          <small>{changeCount ? "Dirty working tree" : "No local edits"}</small>
        </span>
        <b>{formatFileChangeCount(changeCount)}</b>
        {loading ? (
          <Loader2 className="spin" size={14} />
        ) : (
          <ChevronDown className="commit-chevron" size={16} />
        )}
      </button>

      {open ? (
        <div className="file-change-body">
          {summary.length ? (
            <div className="file-change-summary" aria-label="File change summary">
              {summary.map((item) => (
                <span className={`file-change-summary-${item.tone}`} key={item.tone}>
                  <b>{item.count}</b>
                  {item.label}
                </span>
              ))}
            </div>
          ) : null}

          <div className="file-change-list">
            {changes.map((change) => (
              <FileChangeRow change={change} key={`${change.status}:${change.path}`} />
            ))}
            {!loading && !changes.length && !error ? (
              <p className="muted">No local file changes.</p>
            ) : null}
            {loading ? <p className="muted">Loading changes...</p> : null}
            {error ? (
              <div className="file-change-error">
                <p>{error}</p>
                <button onClick={onReload}>Retry</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FileChangeRow({ change }: { change: FileChangeItem }) {
  const label = changeLabel(change);
  const pathParts = filePathParts(change.path);

  return (
    <article className={`file-change-item file-change-${changeTone(change)}`}>
      <span className="file-change-marker" aria-hidden="true" />
      <div>
        <div className="file-change-meta">
          <span>{label}</span>
          <small>{change.status}</small>
        </div>
        <strong title={change.path}>
          {pathParts.directory ? (
            <span className="file-change-directory">{pathParts.directory}/</span>
          ) : null}
          {pathParts.name}
        </strong>
        {change.previousPath ? <p>from {change.previousPath}</p> : null}
      </div>
    </article>
  );
}

function changeTone(change: FileChangeItem) {
  const status = change.status.toLowerCase();
  if (status.includes("conflict")) return "conflict";
  if (status.includes("deleted")) return "deleted";
  if (status.includes("untracked")) return "untracked";
  if (status.includes("added") || status.includes("copied")) return "added";
  if (status.includes("renamed")) return "renamed";
  return "changed";
}

function changeLabel(change: FileChangeItem) {
  const tone = changeTone(change);
  if (tone === "conflict") return "Conflict";
  if (tone === "deleted") return "Deleted";
  if (tone === "untracked") return "Untracked";
  if (tone === "added") return "Added";
  if (tone === "renamed") return "Renamed";
  return "Modified";
}

function summarizeFileChanges(changes: FileChangeItem[]) {
  const counts = new Map<string, number>();
  changes.forEach((change) => {
    const tone = changeTone(change);
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  });

  return [
    { tone: "conflict", label: "conflict" },
    { tone: "changed", label: "modified" },
    { tone: "added", label: "added" },
    { tone: "deleted", label: "deleted" },
    { tone: "renamed", label: "renamed" },
    { tone: "untracked", label: "untracked" },
  ]
    .map((item) => ({ ...item, count: counts.get(item.tone) ?? 0 }))
    .filter((item) => item.count > 0);
}

function formatFileChangeCount(count: number) {
  if (!count) return "Clean";
  return `${count} file${count === 1 ? "" : "s"} changed`;
}

function filePathParts(path: string) {
  const slashIndex = path.lastIndexOf("/");
  if (slashIndex === -1) {
    return { directory: "", name: path };
  }
  return {
    directory: path.slice(0, slashIndex),
    name: path.slice(slashIndex + 1),
  };
}

function BranchListModal({
  preview,
  loading,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: SafetyPreview;
  loading: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (branches?: string[]) => void;
}) {
  const branchKey = preview.branchNames.join("\0");
  const [selection, setSelection] = useState({
    key: branchKey,
    branches: preview.branchNames,
  });
  const isCleanup = preview.operation === "cleanupMergedBranches";
  const facts = preview.facts.filter(
    (fact) => !fact.startsWith("Delete: ") && !fact.startsWith("... and "),
  );
  const listTitle = isCleanup
    ? "Branches to delete"
    : `Branches not in ${preview.targetBranch ?? "main branch"}`;
  const loadingText = isCleanup
    ? "Fetching latest target and calculating safe branches..."
    : `Fetching latest ${preview.targetBranch ?? "main branch"} and checking local branches...`;
  const emptyText = isCleanup
    ? "No local branches are safe to delete."
    : `Every local branch is already in ${preview.targetBranch ?? "the main branch"}.`;
  const selectedBranches =
    selection.key === branchKey ? selection.branches : preview.branchNames;
  const selectedBranchSet = new Set(selectedBranches);
  const selectedCount = selectedBranches.length;
  const allSelected =
    preview.branchNames.length > 0 && selectedCount === preview.branchNames.length;
  const canDeleteSelected = loading || preview.branchNames.length > 0;

  useEffect(() => {
    setSelection({
      key: branchKey,
      branches: preview.branchNames,
    });
  }, [branchKey]);

  function toggleBranch(branch: string) {
    setSelection((current) => {
      const branches = current.key === branchKey ? current.branches : preview.branchNames;
      return {
        key: branchKey,
        branches: branches.includes(branch)
          ? branches.filter((candidate) => candidate !== branch)
          : [...branches, branch],
      };
    });
  }

  function toggleAll() {
    setSelection({
      key: branchKey,
      branches: allSelected ? [] : preview.branchNames,
    });
  }

  return (
    <section
      className="cleanup-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cleanup-modal-title"
    >
      <div className={`cleanup-modal preview-${preview.riskLevel}`}>
        <header className="cleanup-modal-header">
          <div>
            <p className="eyebrow">{isCleanup ? "Confirm cleanup" : "Branch audit"}</p>
            <h2 id="cleanup-modal-title">{preview.title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close cleanup preview"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </header>

        <div className="cleanup-modal-body">
          <div className="cleanup-facts">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </div>

          <section className="cleanup-branch-list">
            <div>
              <strong>{listTitle}</strong>
              <span>
                {loading ? "..." : `${selectedCount}/${preview.branchNames.length}`}
              </span>
            </div>
            {!loading && preview.branchNames.length ? (
              <div className="cleanup-selection-bar">
                <label>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={busy}
                    onChange={toggleAll}
                  />
                  Select all
                </label>
                <button
                  type="button"
                  disabled={busy || selectedCount === 0}
                  onClick={() => setSelection({ key: branchKey, branches: [] })}
                >
                  Clear
                </button>
              </div>
            ) : null}
            {loading ? (
              <div className="preview-loading-row">
                <Loader2 className="spin" size={14} />
                <span>{loadingText}</span>
              </div>
            ) : preview.branchNames.length ? (
              <ul>
                {preview.branchNames.map((branch) => (
                  <li key={branch}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedBranchSet.has(branch)}
                        disabled={busy}
                        onChange={() => toggleBranch(branch)}
                      />
                      <code>{branch}</code>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{emptyText}</p>
            )}
          </section>

          {preview.blockers.length ? (
            <div className="blockers">
              {preview.blockers.map((blocker) => (
                <p key={blocker}>{blocker}</p>
              ))}
            </div>
          ) : null}

          <code className="cleanup-command">{preview.command}</code>
        </div>

        <footer className="cleanup-modal-actions">
          {canDeleteSelected ? (
            <>
              <button disabled={busy} onClick={onCancel}>
                {preview.requiresConfirmation ? "Cancel" : "Close"}
              </button>
              <button
                className="danger"
                disabled={
                  preview.riskLevel === "blocked" ||
                  loading ||
                  busy ||
                  selectedCount === 0
                }
                onClick={() => onConfirm(selectedBranches)}
              >
                {loading ? "Loading..." : busy ? "Working..." : "Delete selected"}
              </button>
            </>
          ) : (
            <button disabled={busy} onClick={onCancel}>
              Close
            </button>
          )}
        </footer>
      </div>
    </section>
  );
}

function compareCommits(
  localCommits: CommitListItem[],
  remoteCommits: CommitListItem[],
  hasRemote: boolean,
): CommitComparisonRow[] {
  const rowCount = Math.max(localCommits.length, hasRemote ? remoteCommits.length : 0);
  return Array.from({ length: rowCount }, (_, index) => {
    const local = localCommits[index] ?? null;
    const remote = hasRemote ? remoteCommits[index] ?? null : null;
    const mismatch = hasRemote && local?.sha !== remote?.sha;

    return {
      id: `${local?.sha ?? "local-empty"}:${remote?.sha ?? "remote-empty"}:${index}`,
      local,
      remote,
      mismatch,
    };
  });
}

function summarizeCommitInsight(
  data: GitFlowNode["data"],
  rows: CommitComparisonRow[],
  hasMore: boolean,
): CommitInsight {
  const upstream = typeof data.upstream === "string" ? data.upstream : "";
  const hasUpstream = Boolean(upstream);
  const latestCommit = rows.find((row) => row.local)?.local ?? null;
  const mismatchRows = hasUpstream ? rows.filter((row) => row.mismatch) : [];
  const ahead = Number(data.ahead ?? 0);
  const behind = Number(data.behind ?? 0);
  const remoteMissing = hasUpstream && rows.length > 0 && !rows.some((row) => row.remote);

  if (!hasUpstream) {
    return {
      tone: "local",
      title: "Local branch",
      detail: "No remote tracking branch configured.",
      visibleRows: rows,
      latestCommit,
      comparisonMode: false,
    };
  }

  if (remoteMissing) {
    return {
      tone: "missing",
      title: "Remote ref missing",
      detail: `${upstream} is not available locally. Fetch or clean stale upstream config.`,
      visibleRows: rows,
      latestCommit,
      comparisonMode: false,
    };
  }

  if (!mismatchRows.length && rows.length) {
    return {
      tone: "synced",
      title: ahead || behind ? `Tracking ${ahead} ahead / ${behind} behind` : "In sync",
      detail: trackingDetail(upstream, ahead, behind, rows.length, hasMore),
      visibleRows: rows,
      latestCommit,
      comparisonMode: false,
    };
  }

  const divergenceDetail =
    ahead === 0 && behind > 0
      ? `Fetch updated ${upstream}; use Update local to move this branch forward.`
      : `Showing ${mismatchRows.length} differing commit row${
          mismatchRows.length === 1 ? "" : "s"
        } against ${upstream}.`;

  return {
    tone: "attention",
    title: ahead || behind ? `${ahead} ahead / ${behind} behind` : "Commit divergence",
    detail: divergenceDetail,
    visibleRows: mismatchRows,
    latestCommit,
    comparisonMode: true,
  };
}

function trackingDetail(
  upstream: string,
  ahead: number,
  behind: number,
  rowCount: number,
  hasMore: boolean,
) {
  if (ahead === 0 && behind > 0) {
    return `Fetch updated ${upstream}; use Update local to move this branch forward.`;
  }
  if (hasMore) return `Latest ${rowCount} commits match ${upstream}.`;
  return `Local history matches ${upstream}.`;
}

function branchStateLabel(data: GitFlowNode["data"]) {
  const upstream = typeof data.upstream === "string" ? data.upstream : "";
  if (data.isActive && upstream) return `active in worktree · tracks ${upstream}`;
  if (data.isActive) return "active in worktree";
  if (upstream) return `tracks ${upstream}`;
  return "local only";
}

function CommitSummaryCard({
  insight,
  upstream,
  showLatest,
}: {
  insight: CommitInsight;
  upstream?: string;
  showLatest: boolean;
}) {
  return (
    <section className={`commit-summary-card commit-summary-${insight.tone}`}>
      <div>
        <span>{upstream ? `Tracking ${upstream}` : "Commits"}</span>
        <strong>{insight.title}</strong>
        <p>{insight.detail}</p>
      </div>
      {showLatest && insight.latestCommit ? (
        <div className="commit-summary-latest">
          <span>Latest local</span>
          <code>{insight.latestCommit.shortSha}</code>
          <strong>{insight.latestCommit.subject}</strong>
          <p>
            {insight.latestCommit.authorName} · {insight.latestCommit.relativeTime}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function CommitCompareRow({ row }: { row: CommitComparisonRow }) {
  return (
    <article className={`commit-compare-row ${row.mismatch ? "is-mismatch" : ""}`}>
      <CommitCell commit={row.local} label="Local" />
      <CommitCell commit={row.remote} label="Remote" />
    </article>
  );
}

function CommitTimelineRow({ commit }: { commit: CommitListItem | null }) {
  if (!commit) return null;

  return (
    <article className="commit-timeline-row">
      <code>{commit.shortSha}</code>
      <strong>{commit.subject}</strong>
      <p>
        {commit.authorName} · {commit.relativeTime}
      </p>
    </article>
  );
}

function CommitCell({
  commit,
  label,
}: {
  commit: CommitListItem | null;
  label: "Local" | "Remote";
}) {
  if (!commit) {
    return (
      <div className="commit-cell is-empty">
        <span>{label}</span>
        <strong>—</strong>
        <p>No commit at this row.</p>
      </div>
    );
  }

  return (
    <div className="commit-cell">
      <span>{label}</span>
      <div>
        <code>{commit.shortSha}</code>
        <strong>{commit.subject}</strong>
      </div>
      <p>
        {commit.authorName} · {commit.relativeTime}
      </p>
    </div>
  );
}
