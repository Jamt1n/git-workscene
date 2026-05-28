# Contributing

Thanks for helping make Git Workscene better.

## Development Setup

```bash
npm ci
npm run tauri dev
```

Before opening a pull request, run:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Pull Request Guidelines

- Keep changes focused on one user-visible problem.
- Add or update tests for Git behavior, safety previews, and UI interactions.
- Avoid changing destructive Git behavior without adding safety coverage.
- Include screenshots or short recordings for UI changes when possible.

## Release Changes

Release builds are handled by GitHub Actions. Update `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` together when bumping versions.
