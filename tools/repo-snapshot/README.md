# ut-repo-snapshot

Shows a privacy-safe Git repository status snapshot for the current directory.

Default usage:

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

This tool prints counts only. It does not print file paths, remote URLs, or file
names, so the default output is safer to paste into issue comments or release
notes.
