# Updates and Releases

Git Workscene uses the Tauri v2 updater with GitHub Releases.

## Runtime Flow

1. The app checks `https://github.com/Jamt1n/git-workscene/releases/latest/download/latest.json`.
2. If a signed update is available, the app shows an update notice.
3. The user chooses `Install`.
4. The updater downloads, verifies, installs, and relaunches the app.

## Signing Keys

The public updater key is committed in `src-tauri/tauri.conf.json`.

The private key must stay secret. GitHub Actions expects:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Generate replacement keys only if you are willing to break updates for installs signed with the previous key:

```bash
npm run tauri signer generate -- -w ~/.tauri/git-workscene.key
```

## Release Checklist

1. Bump versions in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run local validation:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

3. Create and push a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. Open the draft GitHub Release created by the `Release` workflow.
5. Confirm the uploaded assets include `latest.json` and updater signatures.
6. Publish the release.
