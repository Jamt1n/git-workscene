import {
  Code2,
  Check,
  Copy,
  FolderOpen,
  GitBranch,
  GitPullRequestArrow,
  Download,
  ShieldAlert,
  Terminal,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { GitFlowNode } from "../lib/graph";
import type { SafetyPreview } from "../lib/types";

interface InspectorProps {
  selectedNode: GitFlowNode | null;
  preview: SafetyPreview | null;
  onOpen: (path: string, kind: "finder" | "terminal" | "editor") => void;
  onFetch: (repoPath: string) => void;
  onPull: (path: string) => void;
  onPush: (path: string) => void;
  onStash: (path: string) => void;
  onCreateWorktree: (repoPath: string, branch: string) => void;
  onPreviewDeleteWorktree: (path: string) => void;
  onPreviewDeleteBranch: (repoPath: string, branch: string) => void;
  onPreviewCleanupMergedBranches: (repoPath: string, targetBranch: "master" | "prerelease") => void;
  onConfirmPreview: () => void;
  onCancelPreview: () => void;
}

export function Inspector({
  selectedNode,
  preview,
  onOpen,
  onFetch,
  onPull,
  onPush,
  onStash,
  onCreateWorktree,
  onPreviewDeleteWorktree,
  onPreviewDeleteBranch,
  onPreviewCleanupMergedBranches,
  onConfirmPreview,
  onCancelPreview,
}: InspectorProps) {
  const data = selectedNode?.data;
  const [copiedField, setCopiedField] = useState<"path" | "branch" | null>(null);
  const pathValue = data ? (data.path ?? data.repoPath) : "";

  async function copyValue(field: "path" | "branch", value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
  }

  return (
    <aside className="inspector">
      <header className="panel-header">
        <p className="eyebrow">Inspector</p>
        <h2>{data?.title ?? "Select a node"}</h2>
      </header>

      {data ? (
        <>
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
          </dl>

          <div className="action-grid">
            {data.path ? (
              <>
                <button title="Reveal in Finder" onClick={() => onOpen(data.path!, "finder")}>
                  <FolderOpen size={16} />
                  <span>Finder</span>
                </button>
                <button title="Open terminal" onClick={() => onOpen(data.path!, "terminal")}>
                  <Terminal size={16} />
                  <span>Terminal</span>
                </button>
                <button title="Open editor" onClick={() => onOpen(data.path!, "editor")}>
                  <Code2 size={16} />
                  <span>Editor</span>
                </button>
              </>
            ) : null}

            <button title="Fetch" onClick={() => onFetch(data.repoPath)}>
              <Download size={16} />
              <span>Fetch</span>
            </button>

            {data.kind === "repository" ? (
              <>
                <button
                  className="danger"
                  title="Preview clean local branches merged into master"
                  onClick={() => onPreviewCleanupMergedBranches(data.repoPath, "master")}
                >
                  <Trash2 size={16} />
                  <span>Clean master</span>
                </button>
                <button
                  className="danger"
                  title="Preview clean local branches merged into prerelease"
                  onClick={() => onPreviewCleanupMergedBranches(data.repoPath, "prerelease")}
                >
                  <Trash2 size={16} />
                  <span>Clean prerelease</span>
                </button>
              </>
            ) : null}

            {data.kind === "worktree" && data.path ? (
              <>
                <button title="Pull" onClick={() => onPull(data.path!)}>
                  <GitPullRequestArrow size={16} />
                  <span>Pull</span>
                </button>
                <button title="Push" onClick={() => onPush(data.path!)}>
                  <GitBranch size={16} />
                  <span>Push</span>
                </button>
                <button title="Stash" onClick={() => onStash(data.path!)}>
                  <ShieldAlert size={16} />
                  <span>Stash</span>
                </button>
                <button
                  className="danger"
                  title="Preview delete worktree"
                  onClick={() => onPreviewDeleteWorktree(data.path!)}
                >
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              </>
            ) : null}

            {data.kind === "branch" && data.branch ? (
              <>
                <button
                  title="Create worktree"
                  onClick={() => onCreateWorktree(data.repoPath, data.branch!)}
                >
                  <GitBranch size={16} />
                  <span>Worktree</span>
                </button>
                <button
                  className="danger"
                  title="Preview delete branch"
                  onClick={() => onPreviewDeleteBranch(data.repoPath, data.branch!)}
                >
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              </>
            ) : null}
          </div>

          {Array.isArray(data.diagnostics) && data.diagnostics.length ? (
            <section className="diagnostics">
              <strong>Diagnostics</strong>
              {data.diagnostics.map((diagnostic) => (
                <p key={diagnostic}>{diagnostic}</p>
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <p className="muted">Pick a repo, worktree, or branch to see its state and actions.</p>
      )}

      {preview ? (
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
          <code>{preview.command}</code>
          <div className="preview-actions">
            <button onClick={onCancelPreview}>Cancel</button>
            <button
              className="danger"
              disabled={preview.riskLevel === "blocked"}
              onClick={onConfirmPreview}
            >
              Confirm
            </button>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
