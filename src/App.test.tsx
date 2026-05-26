import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { snapshotFixture } from "./test/fixtures";

const openMock = vi.fn();
const addRepositoryMock = vi.fn();
const scanAllRepositoriesMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("./lib/api", () => ({
  addRepository: (...args: unknown[]) => addRepositoryMock(...args),
  scanAllRepositories: (...args: unknown[]) => scanAllRepositoriesMock(...args),
  openPath: vi.fn(),
  fetchRepository: vi.fn(),
  pullWorktree: vi.fn(),
  pushBranch: vi.fn(),
  stashWorktree: vi.fn(),
  createWorktree: vi.fn(),
  deleteWorktreePreview: vi.fn(),
  deleteBranchPreview: vi.fn(),
  deleteWorktree: vi.fn(),
  deleteBranch: vi.fn(),
}));

vi.mock("./components/CanvasView", () => ({
  CanvasView: () => <div data-testid="canvas-view">canvas</div>,
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openMock.mockResolvedValue(null);
    addRepositoryMock.mockResolvedValue({
      id: "/tmp/repo",
      path: "/tmp/repo",
      displayName: "repo",
      createdAt: "1",
      updatedAt: "1",
      lastScannedAt: null,
      pinned: false,
      archived: false,
    });
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
        title: "Add Git repository",
      });
      expect(addRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
    expect(await screen.findByTestId("canvas-view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    expect(screen.getByText("Added repo")).toBeInTheDocument();
  });

  it("shows dialog permission failures instead of failing silently", async () => {
    openMock.mockRejectedValue(new Error("dialog permission denied"));

    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "Add repository" });
    fireEvent.click(addButtons[0]);

    expect(await screen.findAllByText("dialog permission denied")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    expect(await screen.findAllByText("dialog permission denied")).toHaveLength(2);
    expect(addRepositoryMock).not.toHaveBeenCalled();
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
      expect(addRepositoryMock).toHaveBeenCalledWith("/tmp/repo");
    });
    expect(await screen.findByTestId("canvas-view")).toBeInTheDocument();
  });
});
