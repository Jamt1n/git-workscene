import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  onPreviewDeleteWorktree: vi.fn(),
  onPreviewDeleteBranch: vi.fn(),
  onPreviewCleanupMergedBranches: vi.fn(),
  onConfirmPreview: vi.fn(),
  onCancelPreview: vi.fn(),
};

const writeText = vi.fn();

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
    },
  };
}

describe("Inspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    fireEvent.click(screen.getByRole("button", { name: "Clean master" }));
    expect(handlers.onPreviewCleanupMergedBranches).toHaveBeenCalledWith("/tmp/repo", "master");

    fireEvent.click(screen.getByRole("button", { name: "Clean prerelease" }));
    expect(handlers.onPreviewCleanupMergedBranches).toHaveBeenCalledWith(
      "/tmp/repo",
      "prerelease",
    );
  });
});
