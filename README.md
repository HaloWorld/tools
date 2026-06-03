# tools

A public toolbox for small personal utilities.

Commands in this repository use the `ut-` prefix. Add the repository's `bin/`
directory to your shell path, then type `ut-` and press Tab to discover tools.

## Install

Clone the repository, then run:

```bash
./install
```

The installer does not edit your shell files. It checks the local setup and
prints the line to add to Zsh or Fish.

Manual setup:

```bash
export PATH="/path/to/tools/bin:$PATH"
```

Fish:

```fish
fish_add_path /path/to/tools/bin
```

After setup:

```bash
ut-<Tab>
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

- `bin/`: executable `ut-*` commands. This is the only directory that needs to
  be added to the shell path.
- `tools/`: implementation files for each tool.
- `shell/`: optional shell setup snippets.
- `examples/`: synthetic or fully anonymized sample inputs and outputs.
- `outputs/`: generated local reports. Ignored by git.
- `tmp/`: scratch files for testing or experiments. Ignored by git.

Only create `examples/` when the examples are safe to publish.

## Tools

### `ut-codex-usage`

Shows Codex usage summaries from local Codex session files.

Default usage:

```bash
ut-codex-usage
```

With explicit dates:

```bash
ut-codex-usage --from 2026-05-01 --to 2026-05-31
```

JSON output:

```bash
ut-codex-usage --json
```

Privacy note: this tool reads local Codex logs. Its output can include session
labels, file paths, and working directories from those logs. Review and
anonymize any generated report before committing it.

## Adding A Tool

1. Create `tools/<tool-name>/`.
2. Add `tools/<tool-name>/tool.toml`.
3. Add an executable command in `bin/` named `ut-<tool-name>`.
4. Make the no-argument behavior useful whenever possible.
5. Keep private inputs, generated output, and local configuration in ignored
   locations such as `outputs/`, `tmp/`, or `.local/`.
6. Update the `Tools` section above.

The implementation can be a shell script, Python script, compiled binary, or
any other executable. The public command should hide that detail from the user.

## Privacy Rules

- Do not commit credentials, tokens, cookies, API keys, private logs, raw
  exports, local reports, or machine-specific state.
- Do not commit generated reports from personal data unless they have been
  reviewed and anonymized.
- Prefer fake sample data for examples.
- If a tool needs local configuration, keep it in `.local/` or another ignored
  file.

## License

MIT. See [LICENSE](LICENSE).
