import type { ActivityEntry } from "../lib/types";

interface ActivityLogProps {
  entries: ActivityEntry[];
}

export function ActivityLog({ entries }: ActivityLogProps) {
  return (
    <aside className="activity-log">
      <p className="eyebrow">Activity</p>
      {entries.length ? (
        entries.slice(0, 6).map((entry) => (
          <div key={entry.id} className={`activity-row ${entry.ok ? "ok" : "failed"}`}>
            <strong>{entry.operation}</strong>
            <span>{entry.summary}</span>
            {entry.command ? <code>{entry.command}</code> : null}
          </div>
        ))
      ) : (
        <p className="muted">No operations yet.</p>
      )}
    </aside>
  );
}
