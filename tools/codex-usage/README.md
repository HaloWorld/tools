# ut-codex-usage

Show Codex usage summaries from local Codex session files.

Run the repository `./install` once before using this command; it builds the
Rust binary used by the public command.

Rust source: `crates/ut-codex-usage/`.

Default usage:

```bash
ut-codex-usage
```

By default, the command reports the current month.

Costs are shown in USD by default, using `$40 = 1000 credits`. The summary also
shows the underlying credit estimate.

Human-readable output is rendered with colored terminal tables.

The command caches parsed Codex log files by content hash in the system
temporary directory. Those cache files are local-only and may contain labels or
paths from local Codex logs. They are meant to be cleared with normal
temporary-directory cleanup, such as after a reboot.

Use explicit dates when needed:

```bash
ut-codex-usage --from 2026-05-01 --to 2026-05-31
```

Report all available history:

```bash
ut-codex-usage all
```

Match a Codex Profile lifetime total:

```bash
ut-codex-usage all --profile-total 18.4B
```

The default total is based on local Codex logs only. Codex Profile can include
account-level usage that is not present in those local session files, so the two
numbers may differ unless you pass the Profile total explicitly.

Print JSON:

```bash
ut-codex-usage --json
```

Check the installation:

```bash
ut-codex-usage doctor
```

The doctor command reports version, install surface, Codex directory presence,
log file count, cache location, and pricing defaults. It does not parse local
Codex logs.

This tool reads local Codex logs. Its output can include session labels, file
paths, and working directories. Review and anonymize any generated report before
committing it.
