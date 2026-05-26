import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { snapshotFixture } from "./test/fixtures";

const openMock = vi.fn();
const addRepositoriesMock = vi.fn();
const scanAllRepositoriesMock = vi.fn();
const cleanupMergedBranchesPreviewMock = vi.fn();
const cleanupMergedBranchesMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("./lib/api", () => ({
  addRepositories: (...args: unknown[]) => addRepositoriesMock(...args),
  scanAllRepositories: (...args: unknown[]) => scanAllRepositoriesMock(...args),
  openPath: vi.fn(),
  fetchRepository: vi.fn(),
  pullWorktree: vi.fn(),
  pushBranch: vi.fn(),
  stashWorktree: vi.fn(),
  createWorktree: vi.fn(),
  deleteWorktreePreview: vi.fn(),
  deleteBranchPreview: vi.fn(),
  cleanupMergedBranchesPreview: (...args: unknown[]) => cleanupMergedBranchesPreviewMock(...args),
  deleteWorktree: vi.fn(),
  deleteBranch: vi.fn(),
  cleanupMergedBranches: (...args: unknown[]) => cleanupMergedBranchesMock(...args),
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
    const branchCount = graph.nodes.filter((node) => node.data.kind === "branch").length;
    const stashCount = graph.nodes.filter((node) => node.data.kind === "stash").length;
    return (
      <div data-testid="canvas-view">
        <button onClick={() => repo && onSelect(repo)}>Select repo node</button>
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
    openMock.mockResolvedValue(null);
    cleanupMergedBranchesPreviewMock.mockResolvedValue({
      operation: "cleanupMergedBranches",
      riskLevel: "medium",
      title: "Clean branches merged into master",
      facts: ["Target branch: master", "Safe to delete: 1", "Delete: cleanup/merged"],
      blockers: [],
      command: "git branch -D cleanup/merged",
      requiresConfirmation: true,
      targetPath: "/tmp/repo",
      targetBranch: "master",
      branchNames: ["cleanup/merged"],
    });
    cleanupMergedBranchesMock.mockResolvedValue({});
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

    render(<App />);

    expect(await screen.findByTestId("canvas-view")).toHaveTextContent("newer");

    fireEvent.click(screen.getByRole("button", { name: /older/ }));

    expect(screen.getByTestId("canvas-view")).toHaveTextContent("older");
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
    fireEvent.click(screen.getByRole("button", { name: "Clean master" }));

    await waitFor(() => {
      expect(cleanupMergedBranchesPreviewMock).toHaveBeenCalledWith("/tmp/repo", "master");
    });
    expect(await screen.findByText("Clean branches merged into master")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(cleanupMergedBranchesMock).toHaveBeenCalledWith("/tmp/repo", "master");
    });
  });
});
