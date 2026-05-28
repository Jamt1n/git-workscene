import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { snapshotFixture } from "./test/fixtures";

const dndKitMock = vi.hoisted(() => ({
  onDragEnd: null as null | ((event: { active: { id: string }; over: { id: string } | null }) => void),
}));
const openMock = vi.fn();
const checkUpdateMock = vi.fn();
const relaunchMock = vi.fn();
const addRepositoriesMock = vi.fn();
const scanAllRepositoriesMock = vi.fn();
const scanRepositoryMock = vi.fn();
const removeRepositoryMock = vi.fn();
const deleteWorktreePreviewMock = vi.fn();
const deleteWorktreeMock = vi.fn();
const deleteBranchPreviewMock = vi.fn();
const deleteBranchMock = vi.fn();
const cleanupMergedBranchesPreviewMock = vi.fn();
const cleanupMergedBranchesMock = vi.fn();
const cleanupSelectedMergedBranchesMock = vi.fn();
const deleteSelectedBranchesMock = vi.fn();
const branchesOutsideTargetsPreviewMock = vi.fn();
const listBranchCommitsMock = vi.fn();
const listWorktreeChangesMock = vi.fn();
const checkoutBranchMock = vi.fn();
const fastForwardBranchMock = vi.fn();
const createWorktreeMock = vi.fn();
const pullWorktreeMock = vi.fn();
const confirmMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkUpdateMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

vi.mock("@dnd-kit/core", async () => {
  const React = await import("react");
  return {
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => void;
    }) => {
      dndKitMock.onDragEnd = onDragEnd;
      return React.createElement("div", { "data-testid": "dnd-context" }, children);
    },
    PointerSensor: vi.fn(),
    closestCenter: vi.fn(),
    useSensor: vi.fn((sensor, options) => ({ sensor, options })),
    useSensors: vi.fn((...sensors) => sensors),
  };
});

vi.mock("@dnd-kit/sortable", async () => {
  const React = await import("react");
  return {
    SortableContext: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useSortable: ({ id }: { id: string }) => ({
      attributes: { "data-sortable-id": id },
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
    verticalListSortingStrategy: {},
    arrayMove: <T,>(items: T[], from: number, to: number) => {
      const next = items.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    },
  };
});

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => "",
    },
  },
}));

vi.mock("./lib/api", () => ({
  addRepositories: (...args: unknown[]) => addRepositoriesMock(...args),
  removeRepository: (...args: unknown[]) => removeRepositoryMock(...args),
  scanAllRepositories: (...args: unknown[]) => scanAllRepositoriesMock(...args),
  scanRepository: (...args: unknown[]) => scanRepositoryMock(...args),
  openPath: vi.fn(),
  fetchRepository: vi.fn(),
  pullWorktree: (...args: unknown[]) => pullWorktreeMock(...args),
  pushBranch: vi.fn(),
  stashWorktree: vi.fn(),
  createWorktree: (...args: unknown[]) => createWorktreeMock(...args),
  deleteWorktreePreview: (...args: unknown[]) => deleteWorktreePreviewMock(...args),
  deleteBranchPreview: (...args: unknown[]) => deleteBranchPreviewMock(...args),
  cleanupMergedBranchesPreview: (...args: unknown[]) => cleanupMergedBranchesPreviewMock(...args),
  branchesOutsideTargetsPreview: (...args: unknown[]) =>
    branchesOutsideTargetsPreviewMock(...args),
  deleteWorktree: (...args: unknown[]) => deleteWorktreeMock(...args),
  deleteBranch: (...args: unknown[]) => deleteBranchMock(...args),
  checkoutBranch: (...args: unknown[]) => checkoutBranchMock(...args),
  fastForwardBranch: (...args: unknown[]) => fastForwardBranchMock(...args),
  cleanupMergedBranches: (...args: unknown[]) => cleanupMergedBranchesMock(...args),
  cleanupSelectedMergedBranches: (...args: unknown[]) =>
    cleanupSelectedMergedBranchesMock(...args),
  deleteSelectedBranches: (...args: unknown[]) => deleteSelectedBranchesMock(...args),
  listBranchCommits: (...args: unknown[]) => listBranchCommitsMock(...args),
  listWorktreeChanges: (...args: unknown[]) => listWorktreeChangesMock(...args),
}));

vi.mock("./components/CanvasView", () => ({
  CanvasView: ({
    graph,
    onSelect,
  }: {
    graph: { nodes: Array<{ data: { kind: string; title: string } }> };
    onSelect: (node: unknown) => void;
  }) => {
    const repo = graph.nodes.find((node) => node.data.kind === "repository");
    const worktree = graph.nodes.find((node) => node.data.kind === "worktree");
    const branches = graph.nodes.filter((node) => node.data.kind === "branch");
    const branch = branches[0];
    const branchCount = graph.nodes.filter((node) => node.data.kind === "branch").length;
    const stashCount = graph.nodes.filter((node) => node.data.kind === "stash").length;
    return (
        <div data-testid="canvas-view">
        <button onClick={() => repo && onSelect(repo)}>Select repo node</button>
        <button onClick={() => worktree && onSelect(worktree)}>Select worktree node</button>
        <button onClick={() => branch && onSelect(branch)}>Select branch node</button>
        {branches.map((branchNode) => (
          <button
            key={branchNode.data.title}
            onClick={() => onSelect(branchNode)}
          >
            Select branch {branchNode.data.title}
          </button>
        ))}
        {repo?.data.title ?? "canvas"} branches:{branchCount} stashes:{stashCount}
      </div>
    );
  },
}));

function namedSnapshot(displayName: string, path: string, createdAt: string) {
  const snapshot = snapshotFixture();
  snapshot.repo = {
    ...snapshot.repo,
    id: path,
    path,
    displayName,
    createdAt,
  };
  snapshot.worktrees = snapshot.worktrees.map((worktree) => ({
    ...worktree,
    path: `${path}-feature`,
  }));
  snapshot.localBranches = snapshot.localBranches.map((branch) => ({
    ...branch,
    worktreePath: `${path}-feature`,
  }));
  return snapshot;
}

function repoRecord(displayName: string, path: string) {
  return {
    id: path,
    path,
    displayName,
    createdAt: "1",
    updatedAt: "1",
    lastScannedAt: null,
    pinned: false,
    archived: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dndKitMock.onDragEnd = null;
    window.localStorage.clear();
    confirmMock.mockReturnValue(true);
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: confirmMock,
    });
    openMock.mockResolvedValue(null);
    checkUpdateMock.mockResolvedValue(null);
    relaunchMock.mockResolvedValue(undefined);
    cleanupMergedBranchesPreviewMock.mockResolvedValue({
      operation: "cleanupMergedBranches",
      riskLevel: "medium",
      title: "Clean branches merged into main",
      facts: ["Latest remote target: origin/main", "Safe to delete: 1", "Delete: cleanup/merged"],
      blockers: [],
      command:
        "git -C '/tmp/repo' fetch origin 'refs/heads/main:refs/remotes/origin/main' --prune && git -C '/tmp/repo' branch -D 'cleanup/merged'",
      requiresConfirmation: true,
      targetPath: "/tmp/repo",
      targetBranch: "main",
      branchNames: ["cleanup/merged"],
    });
    cleanupMergedBranchesMock.mockResolvedValue({});
    cleanupSelectedMergedBranchesMock.mockResolvedValue({});
    deleteSelectedBranchesMock.mockResolvedValue({});
    branchesOutsideTargetsPreviewMock.mockResolvedValue({
      operation: "branchesOutsideTargets",
      riskLevel: "low",
      title: "Branches not in main",
      facts: ["Latest remote target: origin/main", "Outside main: 1"],
      blockers: [],
      command: "git -C '/tmp/repo' fetch origin",
      requiresConfirmation: false,
      targetPath: "/tmp/repo",
      targetBranch: "main",
      branchNames: ["feature/outside"],
    });
    deleteWorktreePreviewMock.mockResolvedValue({
      operation: "deleteWorktree",
      riskLevel: "high",
      title: "Delete worktree",
      facts: ["Path: /tmp/repo-feature", "Branch: feature/demo"],
      blockers: [],
      command: "git -C '/tmp/repo' worktree remove '/tmp/repo-feature'",
      requiresConfirmation: true,
      targetPath: "/tmp/repo-feature",
      targetBranch: null,
      branchNames: [],
    });
    deleteWorktreeMock.mockResolvedValue({});
    deleteBranchPreviewMock.mockResolvedValue({
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
    });
    deleteBranchMock.mockResolvedValue({});
    checkoutBranchMock.mockResolvedValue({});
    fastForwardBranchMock.mockResolvedValue({});
    createWorktreeMock.mockResolvedValue({});
    pullWorktreeMock.mockResolvedValue({});
    listBranchCommitsMock.mockResolvedValue({ commits: [], hasMore: false });
    listWorktreeChangesMock.mockResolvedValue([]);
    addRepositoriesMock.mockResolvedValue([{
      id: "/tmp/repo",
      path: "/tmp/repo",
      displayName: "repo",
      createdAt: "1",
      updatedAt: "1",
      lastScannedAt: null,
      pinned: false,
      archived: false,
    }]);
    scanAllRepositoriesMock.mockResolvedValue([]);
    scanRepositoryMock.mockResolvedValue(snapshotFixture());
  });

  it("shows initialization loading before the first repository scan resolves", async () => {
    const pendingScan = deferred<ReturnType<typeof snapshotFixture>[]>();
    scanAllRepositoriesMock.mockReturnValue(pendingScan.promise);

    render(<App />);

    expect(screen.getByText("Loading workspace")).toBeInTheDocument();
    expect(screen.queryByText("Add a Git folder")).not.toBeInTheDocument();

    pendingScan.resolve([]);

    expect(await screen.findByText("Add a Git folder")).toBeInTheDocument();
  });

  it("opens the directory dialog and adds the selected repository", async () => {
    openMock.mockResolvedValue("/tmp/repo");
    scanAllRepositoriesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([snapshotFixture()]);

    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "Add repository" });
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledWith({
        directory: true,
        multiple: false,
        title: "Add Git repository or workspace",
      });
      expect(addRepositoriesMock).toHaveBeenCalledWith("/tmp/repo");
    });
    expect(await screen.findByTestId("canvas-view")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-view")).toHaveTextContent("repo");
  });

  it("shows dialog permission failures instead of failing silently", async () => {
    openMock.mockRejectedValue(new Error("dialog permission denied"));

    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "Add repository" });
    fireEvent.click(addButtons[0]);

    expect(await screen.findAllByText("dialog permission denied")).toHaveLength(1);
    expect(addRepositoriesMock).not.toHaveBeenCalled();
  });

  it("shows adding state while repository import is pending", async () => {
    const pendingAdd = deferred<ReturnType<typeof repoRecord>[]>();
    openMock.mockResolvedValue("/tmp/repo");
    addRepositoriesMock.mockReturnValue(pendingAdd.promise);

    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "Add repository" });
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Adding..." }).length).toBeGreaterThan(0);
    });
    screen.getAllByRole("button", { name: "Adding..." }).forEach((button) => {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
    });

    pendingAdd.resolve([repoRecord("repo", "/tmp/repo")]);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Add repository" }).length).toBeGreaterThan(0);
    });
  });

  it("adds a dropped repository path", async () => {
    scanAllRepositoriesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([snapshotFixture()]);

    const { container } = render(<App />);
    const file = new File([""], "repo");
    Object.defineProperty(file, "path", { value: "/tmp/repo" });

    fireEvent.drop(container.querySelector(".app-shell")!, {
      dataTransfer: {
        files: {
          item: () => file,
        },
      },
    });

    await waitFor(() => {
      expect(addRepositoriesMock).toHaveBeenCalledWith("/tmp/repo");
    });
    expect(await screen.findByTestId("canvas-view")).toBeInTheDocument();
  });

  it("adds a workspace folder and focuses the first discovered repository", async () => {
    const alpha = namedSnapshot("alpha", "/tmp/work/alpha", "1");
    const beta = namedSnapshot("beta", "/tmp/work/beta", "2");
    openMock.mockResolvedValue("/tmp/work");
    addRepositoriesMock.mockResolvedValue([
      repoRecord("alpha", "/tmp/work/alpha"),
      repoRecord("beta", "/tmp/work/beta"),
    ]);
    scanAllRepositoriesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([beta, alpha]);

    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "Add repository" });
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(addRepositoriesMock).toHaveBeenCalledWith("/tmp/work");
    });
    await waitFor(() => {
      expect(screen.getByTestId("canvas-view")).toHaveTextContent("alpha");
    });
  });

  it("focuses the canvas on the selected repository", async () => {
    const newer = namedSnapshot("newer", "/tmp/newer", "2");
    const older = namedSnapshot("older", "/tmp/older", "1");
    scanAllRepositoriesMock.mockResolvedValue([newer, older]);
    scanRepositoryMock.mockImplementation(async (path: string) =>
      path === "/tmp/older" ? older : newer,
    );

    render(<App />);

    expect(await screen.findByTestId("canvas-view")).toHaveTextContent("newer");

    fireEvent.click(screen.getByRole("button", { name: "Select older" }));

    await waitFor(() => {
      expect(screen.getByTestId("canvas-view")).toHaveTextContent("older");
    });
  });

  it("reorders repositories by dragging the whole project card", async () => {
    const newer = namedSnapshot("newer", "/tmp/newer", "2");
    const older = namedSnapshot("older", "/tmp/older", "1");
    scanAllRepositoriesMock.mockResolvedValue([newer, older]);
    const { container } = render(<App />);

    await screen.findByRole("button", { name: "Select newer" });
    const repoList = container.querySelector(".repo-list") as HTMLElement;

    expect(screen.queryByRole("button", { name: "Drag older" })).not.toBeInTheDocument();
    dndKitMock.onDragEnd?.({
      active: { id: "/tmp/older" },
      over: { id: "/tmp/newer" },
    });

    await waitFor(() => {
      const selectButtons = within(repoList).getAllByRole("button", { name: /^Select / });
      expect(selectButtons.map((button) => button.textContent)).toEqual([
        expect.stringContaining("older"),
        expect.stringContaining("newer"),
      ]);
    });
    expect(window.localStorage.getItem("git-workscene.repository-order.v1")).toBe(
      JSON.stringify(["/tmp/older", "/tmp/newer"]),
    );
  });

  it("collapses and expands the inspector panel", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    expect(screen.getByRole("heading", { name: "Select a node" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse inspector" }));

    expect(screen.getByRole("button", { name: "Expand inspector" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Select a node" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand inspector" }));

    expect(screen.getByRole("heading", { name: "Select a node" })).toBeInTheDocument();
  });

  it("resizes the inspector panel by dragging the separator", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);
    const { container } = render(<App />);

    await screen.findByTestId("canvas-view");
    const shell = container.querySelector(".app-shell")!;

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize inspector" }), {
      clientX: 100,
    });
    fireEvent.pointerMove(document, { clientX: 20 });
    fireEvent.pointerUp(document);

    expect(shell).toHaveStyle("--inspector-width: 460px");
  });

  it("auto refreshes the selected repository when external git state changes", async () => {
    const initial = snapshotFixture();
    const updated = snapshotFixture();
    updated.localBranches.push({
      ...updated.localBranches[0],
      name: "feature/external",
      fullRef: "refs/heads/feature/external",
      worktreePath: null,
      createdAt: "40",
    });
    scanAllRepositoriesMock.mockResolvedValue([initial]);
    scanRepositoryMock.mockResolvedValue(updated);

    render(<App />);

    expect(await screen.findByTestId("canvas-view")).toHaveTextContent("branches:1");
    scanRepositoryMock.mockClear();

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
      expect(screen.getByTestId("canvas-view")).toHaveTextContent("branches:2");
    });
  });

  it("filters repositories by name and path", async () => {
    const alpha = namedSnapshot("alpha", "/tmp/work/alpha", "1");
    const beta = namedSnapshot("beta", "/tmp/work/beta", "2");
    scanAllRepositoriesMock.mockResolvedValue([beta, alpha]);

    render(<App />);

    expect(await screen.findByRole("button", { name: "Select alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select beta" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter repos"), {
      target: { value: "alpha" },
    });

    expect(screen.getByRole("button", { name: "Select alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select beta" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter repos"), {
      target: { value: "/tmp/work/beta" },
    });

    expect(screen.queryByRole("button", { name: "Select alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select beta" })).toBeInTheDocument();
  });

  it("checks for updates and installs an available release", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkUpdateMock.mockResolvedValue({
      version: "0.2.0",
      body: "Smoother branch management",
      date: "2026-05-28",
      downloadAndInstall,
    });
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("Update 0.2.0 available")).toBeInTheDocument();
    expect(screen.getByText("Smoother branch management")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalled();
      expect(relaunchMock).toHaveBeenCalled();
    });
  });

  it("shows an up-to-date notice when no update is available", async () => {
    checkUpdateMock.mockResolvedValue(null);
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("No update available")).toBeInTheDocument();
    expect(screen.getByText("Git Workscene is up to date.")).toBeInTheDocument();
  });

  it("keeps aggregate repository statistics out of the sidebar", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);
    const { container } = render(<App />);

    await screen.findByTestId("canvas-view");

    expect(container.querySelector(".nav-groups")).not.toBeInTheDocument();
    expect(screen.queryByText("Repositories")).not.toBeInTheDocument();
  });

  it("removes a repository from the project list without rescanning everything", async () => {
    const alpha = namedSnapshot("alpha", "/tmp/work/alpha", "1");
    const beta = namedSnapshot("beta", "/tmp/work/beta", "2");
    scanAllRepositoriesMock.mockResolvedValue([beta, alpha]);
    removeRepositoryMock.mockResolvedValue(undefined);

    render(<App />);

    expect(await screen.findByRole("button", { name: "Select alpha" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove alpha" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        "Remove alpha from Git Workscene? Local files stay on disk.",
      );
      expect(removeRepositoryMock).toHaveBeenCalledWith("/tmp/work/alpha");
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Select alpha" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Select beta" })).toBeInTheDocument();
    expect(scanAllRepositoriesMock).toHaveBeenCalledTimes(1);
  });

  it("switches branch visibility and toggles stashes", async () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/hidden",
      fullRef: "refs/heads/feature/hidden",
      upstream: null,
      worktreePath: null,
      createdAt: "99",
    });
    scanAllRepositoriesMock.mockResolvedValue([snapshot]);

    render(<App />);

    expect(await screen.findByTestId("canvas-view")).toHaveTextContent("branches:2");
    expect(screen.getByTestId("canvas-view")).toHaveTextContent("stashes:0");

    fireEvent.click(screen.getByRole("button", { name: "Focused" }));

    expect(screen.getByTestId("canvas-view")).toHaveTextContent("branches:1");

    fireEvent.click(screen.getByRole("checkbox", { name: /Stashes/ }));

    expect(screen.getByTestId("canvas-view")).toHaveTextContent("stashes:1");
  });

  it("previews and confirms merged branch cleanup from the inspector", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select repo node" }));
    fireEvent.click(screen.getByRole("button", { name: "Clean main" }));

    await waitFor(() => {
      expect(cleanupMergedBranchesPreviewMock).toHaveBeenCalledWith("/tmp/repo");
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Clean branches merged into main",
    });
    expect(dialog).toHaveTextContent("Latest remote target: origin/main");
    expect(dialog).toHaveTextContent("cleanup/merged");

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      expect(cleanupSelectedMergedBranchesMock).toHaveBeenCalledWith("/tmp/repo", [
        "cleanup/merged",
      ]);
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
  });

  it("opens cleanup confirmation immediately while preview is loading", async () => {
    const pendingCleanup = deferred<Awaited<ReturnType<typeof cleanupMergedBranchesPreviewMock>>>();
    cleanupMergedBranchesPreviewMock.mockReturnValue(pendingCleanup.promise);
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select repo node" }));
    fireEvent.click(screen.getByRole("button", { name: "Clean main" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Clean branches merged into main",
    });
    expect(dialog).toHaveTextContent("Fetching latest target and calculating safe branches");
    expect(within(dialog).getByRole("button", { name: "Loading..." })).toBeDisabled();

    pendingCleanup.resolve({
      operation: "cleanupMergedBranches",
      riskLevel: "medium",
      title: "Clean branches merged into main",
      facts: ["Latest remote target: origin/main", "Safe to delete: 1"],
      blockers: [],
      command:
        "git -C '/tmp/repo' fetch origin 'refs/heads/main:refs/remotes/origin/main' --prune && git -C '/tmp/repo' branch -D 'cleanup/merged'",
      requiresConfirmation: true,
      targetPath: "/tmp/repo",
      targetBranch: "main",
      branchNames: ["cleanup/merged"],
    });

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Delete selected" })).toBeEnabled();
    });
    expect(dialog).toHaveTextContent("cleanup/merged");
  });

  it("checks out a selected branch and refreshes the repository", async () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/checkout-target",
      fullRef: "refs/heads/feature/checkout-target",
      createdAt: "40",
      worktreePath: null,
    });
    scanAllRepositoriesMock.mockResolvedValue([snapshot]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select branch node" }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(checkoutBranchMock).toHaveBeenCalledWith("/tmp/repo", "feature/checkout-target");
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
  });

  it("pulls the selected active branch worktree and refreshes the repository", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select branch node" }));
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));

    await waitFor(() => {
      expect(pullWorktreeMock).toHaveBeenCalledWith("/tmp/repo-feature");
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
  });

  it("fast-forwards a behind tracked branch and refreshes the repository", async () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches[0] = {
      ...snapshot.localBranches[0],
      ahead: 0,
      behind: 3,
      worktreePath: null,
    };
    scanAllRepositoriesMock.mockResolvedValue([snapshot]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select branch node" }));
    fireEvent.click(await screen.findByRole("button", { name: "Update local" }));

    await waitFor(() => {
      expect(fastForwardBranchMock).toHaveBeenCalledWith("/tmp/repo", "feature/demo");
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
  });

  it("lists branches outside the main branch from the inspector", async () => {
    const pendingPreview = deferred<Awaited<ReturnType<typeof branchesOutsideTargetsPreviewMock>>>();
    branchesOutsideTargetsPreviewMock.mockReturnValue(pendingPreview.promise);
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select repo node" }));
    fireEvent.click(screen.getByRole("button", { name: "Unmerged" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Branches not in main",
    });
    expect(dialog).toHaveTextContent("Fetching latest main");

    pendingPreview.resolve({
      operation: "branchesOutsideTargets",
      riskLevel: "low",
      title: "Branches not in main",
      facts: ["Latest remote target: origin/main", "Outside main: 1"],
      blockers: [],
      command: "git -C '/tmp/repo' fetch origin",
      requiresConfirmation: false,
      targetPath: "/tmp/repo",
      targetBranch: "main",
      branchNames: ["feature/outside"],
    });

    await waitFor(() => {
      expect(branchesOutsideTargetsPreviewMock).toHaveBeenCalledWith("/tmp/repo");
      expect(dialog).toHaveTextContent("feature/outside");
      expect(within(dialog).getByRole("button", { name: "Delete selected" })).toBeEnabled();
      expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    });
  });

  it("deletes selected unmerged branches from the audit modal", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select repo node" }));
    fireEvent.click(screen.getByRole("button", { name: "Unmerged" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Branches not in main",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      expect(deleteSelectedBranchesMock).toHaveBeenCalledWith(
        "/tmp/repo",
        ["feature/outside"],
        true,
      );
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
  });

  it("previews and confirms worktree delete from the owning repository", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select worktree node" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteWorktreePreviewMock).toHaveBeenCalledWith("/tmp/repo", "/tmp/repo-feature");
    });

    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(deleteWorktreeMock).toHaveBeenCalledWith("/tmp/repo", "/tmp/repo-feature", true);
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
  });

  it("previews and confirms branch delete from the inspector", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select branch node" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete branch" });
    expect(dialog).toHaveTextContent("Branch: feature/demo");
    expect(deleteBranchPreviewMock).toHaveBeenCalledWith("/tmp/repo", "feature/demo");

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(deleteBranchMock).toHaveBeenCalledWith("/tmp/repo", "feature/demo", true);
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
  });

  it("resets branch preview state when selecting another branch", async () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/other",
      fullRef: "refs/heads/feature/other",
      createdAt: "40",
      worktreePath: null,
    });
    scanAllRepositoriesMock.mockResolvedValue([snapshot]);
    deleteBranchPreviewMock.mockImplementation(async (_repoPath: string, branch: string) => ({
      operation: "deleteBranch",
      riskLevel: "high",
      title: "Delete branch",
      facts: [`Branch: ${branch}`, "Merged to default: false"],
      blockers: [],
      command: `git -C '/tmp/repo' branch -D '${branch}'`,
      requiresConfirmation: true,
      targetPath: "/tmp/repo",
      targetBranch: branch,
      branchNames: [],
    }));

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select branch feature/demo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("dialog", { name: "Delete branch" })).toHaveTextContent(
      "Branch: feature/demo",
    );

    fireEvent.click(screen.getByRole("button", { name: "Select branch feature/other" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete branch" })).not.toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete branch" });
    expect(dialog).toHaveTextContent("Branch: feature/other");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(deleteBranchMock).toHaveBeenCalledWith("/tmp/repo", "feature/other", true);
      expect(deleteBranchMock).not.toHaveBeenCalledWith("/tmp/repo", "feature/demo", true);
    });
  });

  it("ignores stale branch preview results after selection changes", async () => {
    const snapshot = snapshotFixture();
    snapshot.localBranches.push({
      ...snapshot.localBranches[0],
      name: "feature/other",
      fullRef: "refs/heads/feature/other",
      createdAt: "40",
      worktreePath: null,
    });
    const pendingDeletePreview = deferred<Awaited<ReturnType<typeof deleteBranchPreviewMock>>>();
    scanAllRepositoriesMock.mockResolvedValue([snapshot]);
    deleteBranchPreviewMock.mockImplementation((_repoPath: string, branch: string) => {
      if (branch === "feature/demo") return pendingDeletePreview.promise;
      return Promise.resolve({
        operation: "deleteBranch",
        riskLevel: "high",
        title: "Delete branch",
        facts: [`Branch: ${branch}`, "Merged to default: false"],
        blockers: [],
        command: `git -C '/tmp/repo' branch -D '${branch}'`,
        requiresConfirmation: true,
        targetPath: "/tmp/repo",
        targetBranch: branch,
        branchNames: [],
      });
    });

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select branch feature/demo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("dialog", { name: "Delete branch" })).toHaveTextContent(
      "Loading safety preview",
    );

    fireEvent.click(screen.getByRole("button", { name: "Select branch feature/other" }));
    pendingDeletePreview.resolve({
      operation: "deleteBranch",
      riskLevel: "high",
      title: "Delete branch",
      facts: ["Branch: feature/demo", "Merged to default: false"],
      blockers: [],
      command: "git -C '/tmp/repo' branch -D 'feature/demo'",
      requiresConfirmation: true,
      targetPath: "/tmp/repo",
      targetBranch: "feature/demo",
      branchNames: [],
    });

    await waitFor(() => {
      expect(screen.queryByText("Branch: feature/demo")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Delete branch" })).not.toBeInTheDocument();
    });
  });

  it("creates a worktree from the inspector dialog and refreshes the repository", async () => {
    scanAllRepositoriesMock.mockResolvedValue([snapshotFixture()]);

    render(<App />);

    await screen.findByTestId("canvas-view");
    fireEvent.click(screen.getByRole("button", { name: "Select branch node" }));
    fireEvent.click(await screen.findByRole("button", { name: "Worktree" }));

    const dialog = await screen.findByRole("dialog", { name: "Create worktree" });
    fireEvent.change(within(dialog).getByLabelText("Worktree path"), {
      target: { value: "/tmp/repo-task" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create worktree" }));

    await waitFor(() => {
      expect(createWorktreeMock).toHaveBeenCalledWith(
        "/tmp/repo",
        "feature/demo",
        "/tmp/repo-task",
        false,
      );
      expect(scanRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
  });
});
