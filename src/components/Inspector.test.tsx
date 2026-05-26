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
        activity={[]}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/tmp/repo-feature"));

    fireEvent.click(screen.getByRole("button", { name: "Copy branch" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("feature/demo"));
  });
});
