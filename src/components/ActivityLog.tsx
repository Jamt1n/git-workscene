import type { ActivityEntry } from "../lib/types";

interface ActivityLogProps {
  entries: ActivityEntry[];
  limit?: number;
  showHeader?: boolean;
}

export function ActivityLog({ entries, limit = 8, showHeader = true }: ActivityLogProps) {
  return (
    <section className="activity-log">
      {showHeader ? <p className="eyebrow">Activity</p> : null}
      {entries.length ? (
        entries.slice(0, limit).map((entry) => (
          <div key={entry.id} className={`activity-row ${entry.ok ? "ok" : "failed"}`}>
            <strong>{entry.operation}</strong>
            <span>{entry.summary}</span>
            {entry.command ? <code>{entry.command}</code> : null}
          </div>
        ))
      ) : (
        <p className="muted">No operations yet.</p>
      )}
    </section>
  );
}
