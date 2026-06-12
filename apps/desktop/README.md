# Universal Tools Desktop

Tauri desktop app shell for the Universal Tools library. Command Index and
Repo Snapshot, and Codex Usage are ready desktop workspaces today. None of
them is the full product boundary.

Universal Tools is the app identity. Tool-specific workspaces sit inside the
library, so future utilities can be added without making the product look like
a Codex-only dashboard.

The long-term product is a toolbox for many developer utilities. Codex Usage is
one ready tool in that toolbox; rich report screens are a workspace pattern,
not the app's product boundary.

## Commands

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run tauri dev
```

Build a macOS app bundle:

```bash
npm run build:app
```

Output:

```text
target/release/bundle/macos/Universal Tools.app
```

For local release testing on macOS, ad-hoc sign and verify the generated app:

```bash
npm run release:local
```

This also runs the Rust workspace tests, embeds the ready CLI commands in the
app bundle, checks the ready desktop workspaces, checks the CLI tools with
synthetic data, verifies bundle metadata, checks release metadata consistency,
generates release notes and the Homebrew Cask, simulates a local install, and
runs the repository privacy scan.
It writes release artifacts, checksum, and manifest under:

```text
target/release/distribution/
```

Install from the repository root:

```bash
./install
```

By default this copies the app to:

```text
~/Applications/Universal Tools.app
```

To also link the embedded shell commands:

```bash
UT_LINK_CLI=1 UT_LOCAL_BIN_DIR="$HOME/.local/bin" ./install
```

The root installer builds the latest local app, verifies it, and copies it into
place. No App Store release is required for that path.

Use [RELEASE.md](RELEASE.md) as the release checklist.

Optional public distribution still needs a Developer ID certificate and Apple
notarization. This repo does not contain signing credentials.

After credentials are configured outside this repository, run:

```bash
UT_DEVELOPER_ID_APPLICATION="Developer ID Application: Name (TEAMID)" \
UT_NOTARYTOOL_PROFILE="universal-tools" \
UT_RELEASE_BASE_URL="https://github.com/HaloWorld/tools/releases/download/v0.1.0" \
npm run release:public
```

`UT_DEVELOPER_ID_APPLICATION` must match a certificate in the local keychain.
`UT_NOTARYTOOL_PROFILE` must be a notarytool keychain profile created with
`xcrun notarytool store-credentials`.
`UT_RELEASE_BASE_URL` is the public release asset URL used to generate the
Homebrew Cask. The generated Cask installs `Universal Tools.app` and links the
embedded ready commands.

After downloading the release assets, install the Cask with:

```bash
brew install --cask ./universal-tools.rb
ut-list
ut-repo-snapshot doctor
ut-codex-usage doctor
```

Direct zip installation only installs the app. The embedded commands remain
available at:

```bash
"/Applications/Universal Tools.app/Contents/MacOS/ut-list"
"/Applications/Universal Tools.app/Contents/MacOS/ut-repo-snapshot" doctor
"/Applications/Universal Tools.app/Contents/MacOS/ut-codex-usage" doctor
```

Public release artifacts include `Universal-Tools-<version>-release-notes.md`
and `universal-tools.rb`, both generated from the final release manifest.

Check public release credentials before building the app:

```bash
UT_DEVELOPER_ID_APPLICATION="Developer ID Application: Name (TEAMID)" \
UT_NOTARYTOOL_PROFILE="universal-tools" \
UT_RELEASE_BASE_URL="https://github.com/HaloWorld/tools/releases/download/v0.1.0" \
npm run check:public-prereqs
```

The app opens to the Universal Tools library. It shows the current app
version, bundle identifier, command prefix, tool areas, local safety posture,
and ready/planned tool inventory.
Opening the library does not scan any tool-specific private data. A tool reads
local data only when its workspace is opened or refreshed.

The app has one product-level entry and three ready desktop workspaces today:

- Universal Tools library: the default command, tool-area, and workspace
  inventory.
- Command Index: installed `ut-*` command catalog and install completeness
  check, available at `#command-index`.
- Repo Snapshot: counts-only Git repository status, available as
  `ut-repo-snapshot` and at `#repo-snapshot`.
- Codex Usage: local Codex usage reporting, available at `#codex-usage`.

Desktop tool entries live in `src/toolRegistry.ts`. Add future tools there
first, then add a workspace only when the tool is ready for the app surface.

## Privacy

The browser preview renders synthetic data. The packaged desktop app calls
local Rust backends from the Universal Tools shell. Today that powers Command
Index, Repo Snapshot, and Codex Usage.
