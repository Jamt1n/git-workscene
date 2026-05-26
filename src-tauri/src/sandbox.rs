#[cfg(test)]
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::process::Command;

#[cfg(test)]
pub struct SandboxRepo {
    pub _temp: tempfile::TempDir,
    pub root: PathBuf,
    pub worktree: PathBuf,
}

#[cfg(test)]
impl SandboxRepo {
    pub fn create() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        let worktree = temp.path().join("repo-feature");

        std::fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.email", "sandbox@example.test"]);
        git(&root, &["config", "user.name", "Sandbox"]);
        std::fs::write(root.join("README.md"), "main\n").unwrap();
        git(&root, &["add", "README.md"]);
        git(&root, &["commit", "-m", "initial commit"]);
        git(&root, &["branch", "feature/demo"]);
        git(
            &root,
            &[
                "worktree",
                "add",
                worktree.to_string_lossy().as_ref(),
                "feature/demo",
            ],
        );
        std::fs::write(worktree.join("feature.txt"), "dirty\n").unwrap();

        Self {
            _temp: temp,
            root,
            worktree,
        }
    }
}

#[cfg(test)]
pub fn git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
