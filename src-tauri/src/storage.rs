use crate::models::{now_string, RepositoryRecord};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct Storage {
    db_path: PathBuf,
}

impl Storage {
    pub fn open(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let storage = Self { db_path };
        storage.init()?;
        Ok(storage)
    }

    pub fn upsert_repository(&self, path: &Path) -> Result<RepositoryRecord, String> {
        let repo = RepositoryRecord::from_path(path);
        let conn = self.connect()?;

        conn.execute(
            "INSERT INTO repositories (
                path, display_name, created_at, updated_at, last_scanned_at, pinned, archived
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(path) DO UPDATE SET
                display_name = excluded.display_name,
                updated_at = excluded.updated_at,
                archived = 0",
            params![
                repo.path,
                repo.display_name,
                repo.created_at,
                repo.updated_at,
                repo.last_scanned_at,
                repo.pinned as i64,
                repo.archived as i64
            ],
        )
        .map_err(|error| error.to_string())?;

        self.get_repository(path.to_string_lossy().as_ref())
    }

    pub fn list_repositories(&self) -> Result<Vec<RepositoryRecord>, String> {
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT path, display_name, created_at, updated_at, last_scanned_at, pinned, archived
                FROM repositories
                WHERE archived = 0
                ORDER BY pinned DESC, display_name ASC",
            )
            .map_err(|error| error.to_string())?;

        let rows = stmt
            .query_map([], row_to_repository)
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn archive_repository(&self, path: &str) -> Result<(), String> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE repositories SET archived = 1, updated_at = ?1 WHERE path = ?2",
            params![now_string(), path],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn get_repository(&self, path: &str) -> Result<RepositoryRecord, String> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT path, display_name, created_at, updated_at, last_scanned_at, pinned, archived
            FROM repositories
            WHERE path = ?1",
            params![path],
            row_to_repository,
        )
        .map_err(|error| error.to_string())
    }

    fn init(&self) -> Result<(), String> {
        let conn = self.connect()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS repositories (
                path TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_scanned_at TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0
            );",
        )
        .map_err(|error| error.to_string())
    }

    fn connect(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| error.to_string())
    }
}

fn row_to_repository(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepositoryRecord> {
    let path: String = row.get(0)?;
    Ok(RepositoryRecord {
        id: path.clone(),
        path,
        display_name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        last_scanned_at: row.get(4)?,
        pinned: row.get::<_, i64>(5)? == 1,
        archived: row.get::<_, i64>(6)? == 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_lists_and_archives_repository() {
        let temp = tempfile::tempdir().unwrap();
        let storage = Storage::open(temp.path().join("registry.sqlite3")).unwrap();
        let repo_dir = temp.path().join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();

        let saved = storage.upsert_repository(&repo_dir).unwrap();
        assert_eq!(saved.path, repo_dir.to_string_lossy());

        let repos = storage.list_repositories().unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].display_name, "repo");

        storage.archive_repository(&saved.path).unwrap();
        assert!(storage.list_repositories().unwrap().is_empty());

        let restored = storage.upsert_repository(&repo_dir).unwrap();
        assert!(!restored.archived);
        assert_eq!(storage.list_repositories().unwrap().len(), 1);
    }
}
