# ut-codex-usage

Show Codex usage summaries from local Codex session files.

Default usage:

```bash
ut-codex-usage
```

By default, the command reports the current month.

Use explicit dates when needed:

```bash
ut-codex-usage --from 2026-05-01 --to 2026-05-31
```

Print JSON:

```bash
ut-codex-usage --json
```

This tool reads local Codex logs. Its output can include session labels, file
paths, and working directories. Review and anonymize any generated report before
committing it.
