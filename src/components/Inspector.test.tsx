import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "./Inspector";
import type { GitFlowNode } from "../lib/graph";

const handlers = {
  onOpen: vi.fn(),
  onFetch: vi.fn(),
  onPull: vi.fn(),
  onPush: vi.fn(),
  onStash: vi.fn(),
  onCreateWorktree: vi.fn(),
  onCheckoutBranch: vi.fn(),
  onFastForwardBranch: vi.fn(),
  onPreviewDeleteWorktree: vi.fn(),
  onPreviewDeleteBranch: vi.fn(),
  onPreviewCleanupMergedBranches: vi.fn(),
  onPreviewBranchesOutsideTargets: vi.fn(),
  onLoadBranchCommits: vi.fn(),
  onLoadWorktreeChanges: vi.fn(),
  onConfirmPreview: vi.fn(),
  onCancelPreview: vi.fn(),
};

const writeText = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function selectedNode(): GitFlowNode {
  return {
    id: "worktree:/tmp/repo-feature",
    type: "gitNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "worktree",
      title: "repo-feature",
      subtitle: "feature/demo",
      badges: [],
      repoPath: "/tmp/repo",
      path: "/tmp/repo-feature",
      branch: "feature/demo",
      dirtyCount: 2,
    },
  };
}

function repositoryNode(): GitFlowNode {
  return {
    id: "repo:/tmp/repo",
    type: "gitNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "repository",
      title: "repo",
      subtitle: "/tmp/repo",
      badges: [],
      repoPath: "/tmp/repo",
      path: "/tmp/repo",
      defaultBranch: "main",
    },
  };
}

function mainWorktreeNode(): GitFlowNode {
  return {
    id: "worktree:/tmp/repo",
    type: "gitNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "worktree",
      title: "repo",
      subtitle: "main",
      badges: ["main"],
      repoPath: "/tmp/repo",
      path: "/tmp/repo",
      branch: "main",
      isMainWorktree: true,
    },
  };
}

function branchNode(): GitFlowNode {
  return {
    id: "branch:/tmp/repo:feature/demo",
    type: "gitNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "branch",
      title: "feature/demo",
      subtitle: "latest change",
      badges: [],
      repoPath: "/tmp/repo",
      path: "/tmp/repo-feature",
      branch: "feature/demo",
      isActive: true,
    },
  };
}

function inactiveBranchNode(): GitFlowNode {
  const node = branchNode();
  node.data = {
    ...node.data,
    isActive: false,
    path: undefined,
  };
  return node;
}

function upstreamBranchNode(): GitFlowNode {
  const node = branchNode();
  node.data = {
    ...node.data,
    upstream: "origin/feature/demo",
  };
  return node;
}

function behindUpstreamBranchNode(): GitFlowNode {
  const node = upstreamBranchNode();
  node.data = {
    ...node.data,
    ahead: 0,
    behind: 3,
  };
  return node;
}

function divergedUpstreamBranchNode(): GitFlowNode {
  const node = behindUpstreamBranchNode();
  node.data = {
    ...node.data,
    ahead: 2,
  };
  return node;
}

function inactiveUpstreamBranchNode(): GitFlowNode {
  const node = upstreamBranchNode();
  node.data = {
    ...node.data,
    isActive: false,
    upstream: "origin/master",
  };
  return node;
}

const cleanupPreview = {
  operation: "cleanupMergedBranches",
  riskLevel: "medium",
  title: "Clean branches merged into main",
  facts: ["Latest remote target: origin/main", "Safe to delete: 2"],
  blockers: [],
  command: "git -C '/tmp/repo' fetch origin 'refs/heads/main:refs/remotes/origin/main' --prune && git -C '/tmp/repo' branch -D 'cleanup/merged' 'feature/old'",
  requiresConfirmation: true,
  targetPath: "/tmp/repo",
  targetBranch: "main",
  branchNames: ["cleanup/merged", "feature/old"],
};

const outsideBranchesPreview = {
  operation: "branchesOutsideTargets",
  riskLevel: "low",
  title: "Branches not in main",
  facts: ["Latest remote target: origin/main", "Outside main: 2"],
  blockers: [],
  command: "git -C '/tmp/repo' fetch origin",
  requiresConfirmation: false,
  targetPath: "/tmp/repo",
  targetBranch: "main",
  branchNames: ["feature/a", "feature/b"],
};

const deleteBranchPreview = {
  operation: "deleteBranch",
  riskLevel: "high",
  title: "Delete branch",
  facts: ["Branch: feature/demo", "Merged to default: false"],
  blockers: [],
  command: "git -C '/tmp/repo' branch -D 'feature/demo'",
  requiresConfirmation: true,
  targetPath: "/tmp/repo",
  targetBranch: null,
  branchNames: [],
};

describe("Inspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.onLoadBranchCommits.mockResolvedValue({
      commits: [
        {
          sha: "abc123",
          shortSha: "abc123",
          subject: "latest change",
          authorName: "Ava",
          committedAt: "100",
          relativeTime: "2 hours ago",
        },
      ],
      hasMore: false,
    });
    handlers.onLoadWorktreeChanges.mockResolvedValue([
      {
        path: "src/App.tsx",
        previousPath: null,
        indexStatus: "None",
        worktreeStatus: "Modified",
        status: "Working modified",
      },
      {
        path: "notes/todo.md",
        previousPath: null,
        indexStatus: "Untracked",
        worktreeStatus: "Untracked",
        status: "Untracked",
      },
    ]);
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies path and branch values from detail fields", async () => {
    render(
      <Inspector
        selectedNode={selectedNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/tmp/repo-feature"));

    fireEvent.click(screen.getByRole("button", { name: "Copy branch" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("feature/demo"));
  });

  it("previews merged branch cleanup from repository actions", () => {
    render(
      <Inspector
        selectedNode={repositoryNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clean main" }));
    expect(handlers.onPreviewCleanupMergedBranches).toHaveBeenCalledWith("/tmp/repo", "main");
    expect(screen.queryByRole("button", { name: "Clean prerelease" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unmerged" }));
    expect(handlers.onPreviewBranchesOutsideTargets).toHaveBeenCalledWith("/tmp/repo", "main");
  });

  it("previews worktree delete with the owning repository path", () => {
    render(
      <Inspector
        selectedNode={selectedNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(handlers.onPreviewDeleteWorktree).toHaveBeenCalledWith(
      "/tmp/repo",
      "/tmp/repo-feature",
    );
  });

  it("shows file changes for dirty worktrees", async () => {
    render(
      <Inspector
        selectedNode={selectedNode()}
        preview={null}
        {...handlers}
      />,
    );

    expect(screen.getByRole("button", { name: /File Changes/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await waitFor(() => {
      expect(handlers.onLoadWorktreeChanges).toHaveBeenCalledWith("/tmp/repo-feature");
    });
    expect(screen.getByRole("button", { name: /2 files changed/ })).toBeInTheDocument();
    const summary = screen.getByLabelText("File change summary");
    expect(within(summary).getByText("modified")).toBeInTheDocument();
    expect(within(summary).getByText("untracked")).toBeInTheDocument();
    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/")).toBeInTheDocument();
    expect(screen.getByText("Working modified")).toBeInTheDocument();
    expect(screen.getByText("todo.md")).toBeInTheDocument();
    expect(screen.getByText("notes/")).toBeInTheDocument();
    expect(screen.getAllByText("Untracked").length).toBeGreaterThan(0);
  });

  it("loads file changes for active branch worktrees", async () => {
    const node = branchNode();
    node.data = {
      ...node.data,
      path: "/tmp/repo-feature",
      dirtyCount: 1,
    };

    render(
      <Inspector
        selectedNode={node}
        preview={null}
        {...handlers}
      />,
    );

    await waitFor(() => {
      expect(handlers.onLoadWorktreeChanges).toHaveBeenCalledWith("/tmp/repo-feature");
    });
    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Commits/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("does not offer worktree deletion for the main working tree", () => {
    render(
      <Inspector
        selectedNode={mainWorktreeNode()}
        preview={null}
        {...handlers}
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText("Main working tree")).toBeInTheDocument();
  });

  it("shows branch cleanup preview as a confirmation modal", () => {
    render(
      <Inspector
        selectedNode={repositoryNode()}
        preview={cleanupPreview}
        {...handlers}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Clean branches merged into main" });
    expect(within(dialog).getByText("Latest remote target: origin/main")).toBeInTheDocument();
    expect(within(dialog).getByText("cleanup/merged")).toBeInTheDocument();
    expect(within(dialog).getByText("feature/old")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "cleanup/merged" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "feature/old" })).toBeChecked();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "feature/old" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete selected" }));

    expect(handlers.onConfirmPreview).toHaveBeenCalledWith(["cleanup/merged"]);
  });

  it("shows branches outside the main branch as a read-only modal", () => {
    render(
      <Inspector
        selectedNode={repositoryNode()}
        preview={outsideBranchesPreview}
        {...handlers}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Branches not in main",
    });
    expect(within(dialog).getByText("Branch audit")).toBeInTheDocument();
    expect(within(dialog).getByText("feature/a")).toBeInTheDocument();
    expect(within(dialog).getByText("feature/b")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "feature/a" })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Delete selected" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(within(dialog).getByRole("button", { name: "Delete selected" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(handlers.onCancelPreview).toHaveBeenCalled();
  });

  it("shows delete branch preview as a modal above the commit panel", () => {
    render(
      <Inspector
        selectedNode={branchNode()}
        preview={deleteBranchPreview}
        {...handlers}
      />,
    );

    expect(screen.getByRole("button", { name: /Commits/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const dialog = screen.getByRole("dialog", { name: "Delete branch" });
    expect(within(dialog).getByText("Safety preview")).toBeInTheDocument();
    expect(within(dialog).getByText("Branch: feature/demo")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(handlers.onConfirmPreview).toHaveBeenCalledWith();
  });

  it("shows current state instead of checkout for an active branch", () => {
    render(
      <Inspector
        selectedNode={branchNode()}
        preview={null}
        {...handlers}
      />,
    );

    const current = screen.getByRole("button", { name: "Current" });
    expect(current).toBeDisabled();
    expect(handlers.onCheckoutBranch).not.toHaveBeenCalled();
  });

  it("checks out the selected local branch with immediate feedback", async () => {
    const checkout = deferred<boolean>();
    handlers.onCheckoutBranch.mockReturnValueOnce(checkout.promise);
    render(
      <Inspector
        selectedNode={inactiveBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(handlers.onCheckoutBranch).toHaveBeenCalledWith("/tmp/repo", "feature/demo");
    expect(screen.getByRole("button", { name: "Switching..." })).toBeDisabled();

    checkout.resolve(true);

    expect(await screen.findByText("Checked out feature/demo")).toBeInTheDocument();
  });

  it("pulls an active branch through its worktree", async () => {
    const pull = deferred<boolean>();
    handlers.onPull.mockReturnValueOnce(pull.promise);
    render(
      <Inspector
        selectedNode={branchNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pull" }));

    expect(handlers.onPull).toHaveBeenCalledWith("/tmp/repo-feature");
    expect(screen.getByRole("button", { name: "Pulling..." })).toBeDisabled();

    pull.resolve(true);

    expect(await screen.findByText("Pulled latest changes")).toBeInTheDocument();
  });

  it("makes fetch feedback clear for tracked branches", async () => {
    const fetch = deferred<boolean>();
    handlers.onFetch.mockReturnValueOnce(fetch.promise);
    render(
      <Inspector
        selectedNode={behindUpstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));

    expect(handlers.onFetch).toHaveBeenCalledWith("/tmp/repo");
    expect(screen.getByRole("button", { name: "Fetching..." })).toBeDisabled();

    fetch.resolve(true);

    expect(
      await screen.findByText("Fetched remote refs; local branch is unchanged"),
    ).toBeInTheDocument();
  });

  it("opens a create worktree dialog with immediate feedback", async () => {
    const createWorktree = deferred<boolean>();
    handlers.onCreateWorktree.mockReturnValueOnce(createWorktree.promise);
    render(
      <Inspector
        selectedNode={inactiveBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Worktree" }));

    const dialog = screen.getByRole("dialog", { name: "Create worktree" });
    expect(within(dialog).getByText("feature/demo")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Worktree path")).toHaveValue("/tmp/repo-feature-demo");

    fireEvent.change(within(dialog).getByLabelText("Worktree path"), {
      target: { value: "/tmp/repo-task" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create worktree" }));

    expect(handlers.onCreateWorktree).toHaveBeenCalledWith(
      "/tmp/repo",
      "feature/demo",
      "/tmp/repo-task",
    );
    expect(within(dialog).getByRole("button", { name: "Creating..." })).toBeDisabled();

    createWorktree.resolve(true);

    expect(await screen.findByText("Created worktree for feature/demo")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Create worktree" })).not.toBeInTheDocument();
    });
  });

  it("keeps the create worktree dialog open when creation fails", async () => {
    handlers.onCreateWorktree.mockResolvedValueOnce(false);
    render(
      <Inspector
        selectedNode={inactiveBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Worktree" }));
    const dialog = screen.getByRole("dialog", { name: "Create worktree" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create worktree" }));

    await waitFor(() => {
      expect(handlers.onCreateWorktree).toHaveBeenCalled();
    });
    expect(screen.getByRole("dialog", { name: "Create worktree" })).toBeInTheDocument();
    expect(screen.queryByText("Created worktree for feature/demo")).not.toBeInTheDocument();
  });

  it("fast-forwards a tracked branch that is only behind", async () => {
    const fastForward = deferred<boolean>();
    handlers.onFastForwardBranch.mockReturnValueOnce(fastForward.promise);
    render(
      <Inspector
        selectedNode={behindUpstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update local" }));

    expect(handlers.onFastForwardBranch).toHaveBeenCalledWith("/tmp/repo", "feature/demo");
    expect(screen.getByRole("button", { name: "Updating..." })).toBeDisabled();

    fastForward.resolve(true);

    expect(await screen.findByText("Updated local feature/demo")).toBeInTheDocument();
  });

  it("does not fast-forward a branch with local commits", () => {
    render(
      <Inspector
        selectedNode={divergedUpstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    expect(screen.getByRole("button", { name: "Update local" })).toBeDisabled();
  });

  it("shows the tracking target for inactive tracked branches", async () => {
    render(
      <Inspector
        selectedNode={inactiveUpstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    expect(screen.getByText("tracks origin/master")).toBeInTheDocument();
    expect(await screen.findByText("Tracking origin/master")).toBeInTheDocument();
    expect(handlers.onLoadBranchCommits).toHaveBeenCalledWith(
      "/tmp/repo",
      "origin/master",
      0,
      30,
    );
  });

  it("opens and loads branch commits by default for branch nodes", async () => {
    render(
      <Inspector
        selectedNode={branchNode()}
        preview={null}
        {...handlers}
      />,
    );

    expect(screen.getByText("active in worktree")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Commits/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Commits/ }).closest(".inspector-content"),
    ).toHaveClass("with-commits");

    await waitFor(() => {
      expect(handlers.onLoadBranchCommits).toHaveBeenCalledWith(
        "/tmp/repo",
        "feature/demo",
        0,
        30,
      );
    });
    expect(await screen.findByText("latest change")).toBeInTheDocument();
    expect(screen.getByText("Ava · 2 hours ago")).toBeInTheDocument();
  });

  it("compares local and remote branch commits side by side", async () => {
    handlers.onLoadBranchCommits.mockImplementation(
      async (_repoPath: string, branch: string) => ({
        commits: [
          {
            sha: branch.startsWith("origin/") ? "remote-sha" : "local-sha",
            shortSha: branch.startsWith("origin/") ? "remote" : "local",
            subject: branch.startsWith("origin/") ? "remote tip" : "local tip",
            authorName: branch.startsWith("origin/") ? "Remote" : "Local",
            committedAt: "100",
            relativeTime: "now",
          },
        ],
        hasMore: false,
      }),
    );

    render(
      <Inspector
        selectedNode={upstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    await waitFor(() => {
      expect(handlers.onLoadBranchCommits).toHaveBeenCalledWith(
        "/tmp/repo",
        "feature/demo",
        0,
        30,
      );
      expect(handlers.onLoadBranchCommits).toHaveBeenCalledWith(
        "/tmp/repo",
        "origin/feature/demo",
        0,
        30,
      );
    });

    expect(await screen.findByText("local tip")).toBeInTheDocument();
    expect(screen.getByText("remote tip")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 1 differing commit row against origin/feature/demo."),
    ).toBeInTheDocument();
    expect(screen.getByText("local tip").closest(".commit-compare-row")).toHaveClass(
      "is-mismatch",
    );
  });

  it("does not show divergence while commit comparison is still loading", async () => {
    const commits = deferred<{
      commits: Array<{
        sha: string;
        shortSha: string;
        subject: string;
        authorName: string;
        committedAt: string;
        relativeTime: string;
      }>;
      hasMore: boolean;
    }>();
    handlers.onLoadBranchCommits.mockReturnValue(commits.promise);

    render(
      <Inspector
        selectedNode={upstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    await waitFor(() => {
      expect(handlers.onLoadBranchCommits).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Commit divergence")).not.toBeInTheDocument();
    expect(document.querySelector(".commit-summary-attention")).not.toBeInTheDocument();

    commits.resolve({
      commits: [
        {
          sha: "same-sha",
          shortSha: "same",
          subject: "same tip",
          authorName: "Ava",
          committedAt: "100",
          relativeTime: "now",
        },
      ],
      hasMore: false,
    });

    expect(await screen.findByText("In sync")).toBeInTheDocument();
  });

  it("reloads commit comparison when refreshed tracking metadata changes", async () => {
    let phase: "before" | "after" = "before";
    handlers.onLoadBranchCommits.mockImplementation(
      async (_repoPath: string, branch: string) => {
        const remote = branch.startsWith("origin/");
        const sha = phase === "before" && !remote ? "local-before" : "remote-tip";
        return {
          commits: [
            {
              sha,
              shortSha: sha,
              subject: phase === "before" && !remote ? "old local tip" : "updated tip",
              authorName: "Ava",
              committedAt: "100",
              relativeTime: "now",
            },
          ],
          hasMore: false,
        };
      },
    );
    const initialNode = behindUpstreamBranchNode();
    initialNode.data = {
      ...initialNode.data,
      lastCommitSha: "local-before",
      upstreamTipSha: "remote-tip",
    };
    const { rerender } = render(
      <Inspector
        selectedNode={initialNode}
        preview={null}
        {...handlers}
      />,
    );

    expect(await screen.findByText("old local tip")).toBeInTheDocument();
    expect(screen.getByText("updated tip")).toBeInTheDocument();
    expect(screen.getByText("old local tip").closest(".commit-compare-row")).toHaveClass(
      "is-mismatch",
    );

    phase = "after";
    const refreshedNode = behindUpstreamBranchNode();
    refreshedNode.data = {
      ...refreshedNode.data,
      ahead: 0,
      behind: 0,
      lastCommitSha: "remote-tip",
      upstreamTipSha: "remote-tip",
    };
    rerender(
      <Inspector
        selectedNode={refreshedNode}
        preview={null}
        {...handlers}
      />,
    );

    expect(await screen.findByText("In sync")).toBeInTheDocument();
    expect(screen.getByText("Local history matches origin/feature/demo.")).toBeInTheDocument();
    expect(screen.queryByText("old local tip")).not.toBeInTheDocument();
    expect(document.querySelector(".commit-compare-row")).not.toBeInTheDocument();
    expect(handlers.onLoadBranchCommits).toHaveBeenCalledTimes(4);
  });

  it("explains that a behind branch needs a local update after fetch", async () => {
    handlers.onLoadBranchCommits.mockImplementation(
      async (_repoPath: string, branch: string) => ({
        commits: [
          {
            sha: branch.startsWith("origin/") ? "remote-sha" : "local-sha",
            shortSha: branch.startsWith("origin/") ? "remote" : "local",
            subject: branch.startsWith("origin/") ? "remote tip" : "local tip",
            authorName: "Ava",
            committedAt: "100",
            relativeTime: "now",
          },
        ],
        hasMore: false,
      }),
    );

    render(
      <Inspector
        selectedNode={behindUpstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    expect(await screen.findByText("0 ahead / 3 behind")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Fetch updated origin/feature/demo; use Update local to move this branch forward.",
      ),
    ).toBeInTheDocument();
  });

  it("shows matching local commits as a readable timeline", async () => {
    handlers.onLoadBranchCommits.mockResolvedValue({
      commits: [
        {
          sha: "same-sha",
          shortSha: "same",
          subject: "same tip",
          authorName: "Ava",
          committedAt: "100",
          relativeTime: "now",
        },
      ],
      hasMore: false,
    });

    render(
      <Inspector
        selectedNode={upstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    expect(await screen.findByText("In sync")).toBeInTheDocument();
    expect(screen.getByText("Local history matches origin/feature/demo.")).toBeInTheDocument();
    expect(screen.getByText("same tip")).toBeInTheDocument();
    expect(screen.queryByText("Latest local")).not.toBeInTheDocument();
    expect(screen.queryByText("Remote")).not.toBeInTheDocument();
    expect(document.querySelector(".commit-compare-row")).not.toBeInTheDocument();
  });

  it("loads more matching commit pages into the local timeline", async () => {
    handlers.onLoadBranchCommits.mockImplementation(
      async (_repoPath: string, _branch: string, offset: number) => ({
        commits: [
          {
            sha: offset === 0 ? "same-sha-1" : "same-sha-2",
            shortSha: offset === 0 ? "same1" : "same2",
            subject: offset === 0 ? "same tip" : "same follow-up",
            authorName: "Ava",
            committedAt: offset === 0 ? "100" : "90",
            relativeTime: offset === 0 ? "now" : "1 hour ago",
          },
        ],
        hasMore: offset === 0,
      }),
    );

    render(
      <Inspector
        selectedNode={upstreamBranchNode()}
        preview={null}
        {...handlers}
      />,
    );

    expect(await screen.findByText("Latest 1 commits match origin/feature/demo.")).toBeInTheDocument();
    expect(screen.getByText("same tip")).toBeInTheDocument();
    expect(screen.queryByText(/matching commit row/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("Local history matches origin/feature/demo.")).toBeInTheDocument();
    });
    expect(screen.getByText("same follow-up")).toBeInTheDocument();
    expect(handlers.onLoadBranchCommits).toHaveBeenCalledWith(
      "/tmp/repo",
      "feature/demo",
      1,
      30,
    );
    expect(handlers.onLoadBranchCommits).toHaveBeenCalledWith(
      "/tmp/repo",
      "origin/feature/demo",
      1,
      30,
    );
    expect(document.querySelector(".commit-compare-row")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("loads the next commit page from the commit panel", async () => {
    handlers.onLoadBranchCommits
      .mockResolvedValueOnce({
        commits: [
          {
            sha: "abc123",
            shortSha: "abc123",
            subject: "latest change",
            authorName: "Ava",
            committedAt: "100",
            relativeTime: "2 hours ago",
          },
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        commits: [
          {
            sha: "def456",
            shortSha: "def456",
            subject: "follow-up",
            authorName: "Ben",
            committedAt: "90",
            relativeTime: "3 hours ago",
          },
        ],
        hasMore: false,
      });

    render(
      <Inspector
        selectedNode={branchNode()}
        preview={null}
        {...handlers}
      />,
    );

    await screen.findByText("latest change");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(handlers.onLoadBranchCommits).toHaveBeenLastCalledWith(
        "/tmp/repo",
        "feature/demo",
        1,
        30,
      );
    });
    expect(await screen.findByText("follow-up")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("does not auto-load commit pages while scrolling the inspector", async () => {
    handlers.onLoadBranchCommits
      .mockResolvedValueOnce({
        commits: [
          {
            sha: "abc123",
            shortSha: "abc123",
            subject: "latest change",
            authorName: "Ava",
            committedAt: "100",
            relativeTime: "2 hours ago",
          },
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        commits: [
          {
            sha: "def456",
            shortSha: "def456",
            subject: "follow-up",
            authorName: "Ben",
            committedAt: "90",
            relativeTime: "3 hours ago",
          },
        ],
        hasMore: false,
      });

    render(
      <Inspector
        selectedNode={branchNode()}
        preview={null}
        {...handlers}
      />,
    );

    await screen.findByText("latest change");
    const scrollContainer = screen
      .getByRole("button", { name: /Commits/ })
      .closest(".inspector-content") as HTMLElement;
    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 960 });
    Object.defineProperty(scrollContainer, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scrollContainer, "scrollHeight", { configurable: true, value: 1000 });

    fireEvent.scroll(scrollContainer);

    expect(handlers.onLoadBranchCommits).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    expect(screen.queryByText("follow-up")).not.toBeInTheDocument();
  });
});
