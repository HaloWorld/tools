# tools

A public desktop toolbox for small personal utilities.

Universal Tools installs as a local macOS app. Some tools also expose optional
`ut-*` commands for shell use, but the app is the primary entry point.

## Install

Clone the repository, then run:

```bash
./install
```

The installer builds the latest app from the current checkout, verifies the
local release, and installs it here:

```text
~/Applications/Universal Tools.app
```

To install somewhere else:

```bash
UT_LOCAL_INSTALL_DIR="/Applications" ./install
```

Optional shell commands can be linked during install:

```bash
UT_LINK_CLI=1 UT_LOCAL_BIN_DIR="$HOME/.local/bin" ./install
```

The installer does not edit your shell files. If you link shell commands, add
that bin directory to Zsh or Fish yourself.

After installing the app, open:

```bash
~/Applications/Universal\ Tools.app
```

## Design Principles

- Prefix commands: every public command starts with `ut-`.
- Minimal parameters: common use should work with no arguments or a very small
  number of arguments.
- Good defaults: prefer convention and local defaults over asking the user to
  configure every run.
- Agent maintained: future changes should be easy for coding agents to inspect,
  test, and extend.
- Public-safe by default: do not commit private inputs, generated reports,
  credentials, local logs, or machine-specific state.

## Layout

```text
.
├── bin/
│   └── ut-*
├── Cargo.toml
├── crates/
│   └── <tool-name>/
├── apps/
│   └── desktop/
├── tools/
│   └── <tool-name>/
│       ├── tool.toml
│       ├── README.md
│       └── ...
├── shell/
│   ├── zsh.zsh
│   └── fish.fish
├── examples/
├── outputs/
├── tmp/
├── AGENTS.md
├── README.md
└── LICENSE
```

- `bin/`: optional executable `ut-*` commands for shell users.
- `crates/`: Rust implementations for compiled tools.
- `apps/desktop/`: Tauri desktop app shell for the Universal Tools library.
- `tools/`: per-tool notes and metadata.
- `shell/`: optional shell setup snippets.
- `examples/`: synthetic or fully anonymized sample inputs and outputs.
- `outputs/`: generated local reports. Ignored by git.
- `tmp/`: scratch files for testing or experiments. Ignored by git.

Only create `examples/` when the examples are safe to publish.

## Tools

### `ut-list`

Lists the installed Universal Tools commands.

```bash
ut-list
```

Machine-readable output:

```bash
ut-list --json
```

Installation check:

```bash
ut-list doctor
```

### `ut-repo-snapshot`

Shows a privacy-safe Git repository status snapshot for the current directory.

```bash
ut-repo-snapshot
```

Machine-readable output:

```bash
ut-repo-snapshot --json
```

Installation check:

```bash
ut-repo-snapshot doctor
```

This tool prints counts only. It does not print file paths, remote URLs, or
file names.

### `ut-codex-usage`

Shows Codex usage summaries from local Codex session files.

Default usage:

```bash
ut-codex-usage
```

The command uses `$40 = 1000 credits` as its default conversion rate and shows
estimated USD cost by default. It also caches parsed log files by content hash
in the system temporary directory, so unchanged Codex logs do not need to be
parsed again.

Human-readable output is rendered with colored terminal tables.

With explicit dates:

```bash
ut-codex-usage --from 2026-05-01 --to 2026-05-31
```

All available history:

```bash
ut-codex-usage all
```

If you want the report to line up with the Codex Profile lifetime number, pass
that number explicitly:

```bash
ut-codex-usage all --profile-total 18.4B
```

Without `--profile-total`, the command reports only usage visible in local
Codex logs. Codex Profile can include account-level usage that is not present in
local session files.

JSON output:

```bash
ut-codex-usage --json
```

Installation check:

```bash
ut-codex-usage doctor
```

The doctor check reports version, install surface, Codex directory presence,
log file count, cache location, and pricing defaults. It does not parse local
Codex logs.

Privacy note: this tool reads local Codex logs. Its output can include session
labels, file paths, and working directories from those logs. Review and
anonymize any generated report before committing it.

## Desktop App

The desktop app lives in `apps/desktop/`. It is the Universal Tools shell:
Command Index, Repo Snapshot, and Codex Usage are ready desktop workspaces
today, and future tools should get their own library entry. Add a desktop
workspace only when a tool benefits from richer browsing or comparison.

The app opens at the Universal Tools library, not at a single tool report. The
library shows ready tools, planned tool slots, tool areas, the shared `ut-`
command prefix, the app release profile, and the local safety posture. Codex
Usage is one module inside that library.

The product direction is not "Codex Usage plus extras." It is a local toolbox
for many small utilities. Rich desktop views are available when a tool needs
them, but every tool keeps its own purpose, command, and workspace boundary.

Run the app during development:

```bash
npm run tauri dev
```

Build a macOS app bundle directly:

```bash
npm run build:app
```

The app bundle is generated under `target/release/bundle/macos/`.

For local release testing on macOS:

```bash
npm run release:local
```

That command runs the Rust workspace tests, builds the app, embeds the ready
CLI commands in the app bundle, ad-hoc signs it for local testing, verifies the
bundle, checks the three ready workspaces, checks the CLI tools with synthetic
data, checks macOS and release metadata, creates a release zip with a SHA256
checksum, manifest, release notes, and Homebrew Cask, simulates a local install,
and runs the repository privacy scan.

Local release artifacts are written under `target/release/distribution/`.

Install from the repo root:

```bash
./install
```

By default this builds the latest local app and copies `Universal Tools.app`
to `~/Applications`. To install somewhere else:

```bash
UT_LOCAL_INSTALL_DIR="/Applications" ./install
```

To also link the optional embedded `ut-*` commands into a bin directory:

```bash
UT_LINK_CLI=1 UT_LOCAL_BIN_DIR="$HOME/.local/bin" ./install
```

The installer does not edit shell files. Add the bin directory to Zsh or Fish
yourself if you choose to link CLI commands this way.

GitHub Actions runs the same local release check on macOS for pushes and pull
requests. The CI artifact is for validation only.

Optional public distribution can use Developer ID signing and Apple
notarization later. Signing credentials are intentionally not stored in this
public repository.

After those credentials are configured on the release machine:

```bash
UT_DEVELOPER_ID_APPLICATION="Developer ID Application: Name (TEAMID)" \
UT_NOTARYTOOL_PROFILE="universal-tools" \
UT_RELEASE_BASE_URL="https://github.com/HaloWorld/tools/releases/download/v0.1.0" \
npm run release:public
```

The public release flow also writes a Homebrew Cask file named
`universal-tools.rb` from the final zip checksum. The Cask installs
`Universal Tools.app` and links the embedded ready commands.

After downloading release assets, Homebrew users can install both the app and
the linked commands with:

```bash
brew install --cask ./universal-tools.rb
ut-list
ut-codex-usage doctor
```

Direct zip installation installs the app only. The embedded CLI commands can
still be run from the app bundle:

```bash
"/Applications/Universal Tools.app/Contents/MacOS/ut-list"
"/Applications/Universal Tools.app/Contents/MacOS/ut-codex-usage" doctor
```

The desktop app opens to Universal Tools: command inventory, tool areas,
workspaces, app version, bundle identifier, command prefix, local safety
status, and ready/planned tools. Codex Usage can be opened from the library or
at `#codex-usage`. Command Index can be opened from the library or at
`#command-index`; it lists installed commands and checks whether every ready
tool command is present. The browser preview uses synthetic demo data. The
packaged desktop app reads local data through Rust tool backends only after a
specific tool workspace is opened or refreshed.

See `apps/desktop/RELEASE.md` for the macOS release checklist.

## Adding A Tool

1. Create `tools/<tool-name>/`.
2. Add `tools/<tool-name>/tool.toml`.
3. Add an executable command in `bin/` named `ut-<tool-name>`.
4. Make the no-argument behavior useful whenever possible.
5. Keep private inputs, generated output, and local configuration in ignored
   locations such as `outputs/`, `tmp/`, or `.local/`.
6. Update the `Tools` section above.
7. Add the tool to `apps/desktop/src/toolRegistry.ts` with its own workspace
   route if it should have an app workspace.

Prefer Rust for tools intended to become self-contained binaries. The public
command should hide implementation details from the user.

## Privacy Rules

- Do not commit credentials, tokens, cookies, API keys, private logs, raw
  exports, local reports, or machine-specific state.
- Do not commit generated reports from personal data unless they have been
  reviewed and anonymized.
- Prefer fake sample data for examples.
- If a tool needs local configuration, keep it in `.local/` or another ignored
  file.
- Run `scripts/privacy-scan.sh` before publishing release changes.

## License

MIT. See [LICENSE](LICENSE).
