# Universal Tools macOS Release

This checklist keeps the desktop app release repeatable without storing Apple
credentials in the repository.

## Local Release Check

Run from `apps/desktop/`:

```bash
npm run release:local
```

Expected outputs:

- `target/release/bundle/macos/Universal Tools.app`
- `target/release/distribution/Universal-Tools-<version>-macos-<arch>.zip`
- `target/release/distribution/Universal-Tools-<version>-macos-<arch>.zip.sha256`
- `target/release/distribution/Universal-Tools-<version>-macos-<arch>.manifest.json`
- `target/release/distribution/Universal-Tools-<version>-release-notes.md`
- `target/release/distribution/universal-tools.rb`

The command must pass:

- Rust workspace tests
- frontend build
- frontend assets embedded into the app executable
- Tauri app bundle build
- UI contract check for default Tool Library entry, lazy tool data access,
  skip link, and readable planned entries
- workspace contract check for Command Index, Repo Snapshot, and Codex Usage
  in both source and built frontend assets
- accessibility check for WCAG AA color contrast, visible focus states, skip
  link, and reduced-motion-safe transitions
- CLI tool check with synthetic, publish-safe usage data
- embedded ready commands inside the app bundle
- ad-hoc local signing
- codesign verification
- macOS bundle metadata check
- CSP release check
- Tauri capability check for narrow app permissions
- GitHub Actions workflow check for local release validation
- release metadata consistency check
- ready command catalog consistency check across desktop inventory, `ut-list`,
  public `bin/` commands, tool metadata, embed script, and release manifest
- zip packaging, extracted app verification, SHA256 verification, and manifest
  generation
- Homebrew Cask generation from the local release zip checksum
- Homebrew Cask binary links for the embedded ready commands
- release notes generation from the release manifest
- release notes must document both Homebrew Cask install and direct app install
- direct app install command smoke check for `ut-list`,
  `ut-repo-snapshot doctor`, and `ut-codex-usage doctor`
- simulated local install into a temporary Applications directory, including
  optional `ut-*` command links
- release artifact consistency check across zip, checksum, manifest, and
  Homebrew Cask, including a fresh zip extraction, app bundle verification, and
  Homebrew Cask syntax plus release notes verification
- release manifest signing check; local builds may be ad-hoc signed, public
  builds must be Developer ID signed and include a Team ID
- simulated Homebrew command-link check for `ut-list` and every embedded ready
  command
- release scripts select only the current app version's manifest, so stale
  artifacts from another version cannot be used for Cask or notes generation
- zip cleanliness check that rejects `._*`, `.DS_Store`, and `__MACOSX`
- repository privacy scan

## Local Install

From the repository root, install the latest local app on this Mac:

```bash
./install
```

Default install location:

```text
~/Applications/Universal Tools.app
```

To install into another directory:

```bash
UT_LOCAL_INSTALL_DIR="/Applications" ./install
```

To link the embedded shell commands at the same time:

```bash
UT_LINK_CLI=1 UT_LOCAL_BIN_DIR="$HOME/.local/bin" ./install
```

The installer does not edit shell files. If CLI links are enabled, add the bin
directory to Zsh or Fish yourself.

The lower-level desktop script remains available from `apps/desktop/`:

```bash
npm run install:local
```

To validate the install path without touching the real Applications folder:

```bash
npm run check:install
```

That command installs into a temporary directory, links the embedded `ut-*`
commands into a temporary bin directory, and checks `ut-list`,
`ut-repo-snapshot`, and `ut-codex-usage`.

## Optional Public Release

Configure credentials outside this repository:

```bash
xcrun notarytool store-credentials universal-tools
```

Then run from `apps/desktop/`:

```bash
UT_DEVELOPER_ID_APPLICATION="Developer ID Application: Name (TEAMID)" \
UT_NOTARYTOOL_PROFILE="universal-tools" \
UT_RELEASE_BASE_URL="https://github.com/HaloWorld/tools/releases/download/v0.1.0" \
npm run release:public
```

`UT_RELEASE_BASE_URL` must be the HTTPS URL of the GitHub Release asset
directory for the current app version, such as `/releases/download/v0.1.0`.
It must match this repository's `origin` remote, and the matching git tag, such
as `v0.1.0`, must exist and point to the commit being released. The generated
Homebrew Cask URL is checked before release finishes.

To check public release credentials before building the app:

```bash
UT_DEVELOPER_ID_APPLICATION="Developer ID Application: Name (TEAMID)" \
UT_NOTARYTOOL_PROFILE="universal-tools" \
UT_RELEASE_BASE_URL="https://github.com/HaloWorld/tools/releases/download/v0.1.0" \
npm run check:public-prereqs
```

The public release script must pass:

- public release prerequisite check before the app build
- clean git worktree check before signing and notarization
- release URL, repository origin, and git tag consistency check before signing
  and notarization
- Rust workspace tests
- embedded ready commands inside the app bundle
- frontend assets embedded into the app executable
- Developer ID signing with hardened runtime
- UI contract check for default Tool Library entry, lazy tool data access,
  skip link, and readable planned entries
- workspace contract check for Command Index, Repo Snapshot, and Codex Usage
  in both source and built frontend assets
- accessibility check for WCAG AA color contrast, visible focus states, skip
  link, and reduced-motion-safe transitions
- CLI tool check with synthetic, publish-safe usage data
- codesign verification
- Tauri capability check for narrow app permissions
- ready command catalog consistency check across desktop inventory, `ut-list`,
  public `bin/` commands, tool metadata, embed script, and release manifest
- zip packaging
- Apple notarization
- stapling
- Gatekeeper assessment
- final bundle check in public mode
- final zip packaging, extracted app verification, SHA256 verification, and
  manifest generation
- Homebrew Cask generation
- Homebrew Cask binary links for the embedded ready commands
- release notes generation from the release manifest
- release notes must document both Homebrew Cask install and direct app install
- direct app install command smoke check for `ut-list`,
  `ut-repo-snapshot doctor`, and `ut-codex-usage doctor`
- release artifact consistency check across zip, checksum, manifest, and
  Homebrew Cask, including a fresh zip extraction, app bundle verification, and
  Homebrew Cask URL, syntax, and release notes verification
- release manifest signing check; local builds may be ad-hoc signed, public
  builds must be Developer ID signed and include a Team ID
- simulated Homebrew command-link check for `ut-list` and every embedded ready
  command
- release scripts select only the current app version's manifest, so stale
  artifacts from another version cannot be used for Cask or notes generation
- zip cleanliness check that rejects `._*`, `.DS_Store`, and `__MACOSX`
- repository privacy scan

## Publish Artifacts

Upload only the files in `target/release/distribution/`:

- `Universal-Tools-<version>-macos-<arch>.zip`
- `Universal-Tools-<version>-macos-<arch>.zip.sha256`
- `Universal-Tools-<version>-macos-<arch>.manifest.json`
- `Universal-Tools-<version>-release-notes.md`
- `universal-tools.rb`

Do not upload local reports, raw Codex logs, private exports, or ignored
workspace data.
