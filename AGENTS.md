# AGENTS.md

This is a public toolbox repository. Keep it safe to publish and easy to use
from common shells.

## User-Facing Style

When reporting results to the maintainer, use simple direct Chinese. Explain
what changed and whether it was verified. Avoid unnecessary implementation
detail unless the user asks for it.

## Tool Design

- Public commands must use the `ut-` prefix and live in `bin/`.
- Prefer one command per tool. Do not introduce subcommand trees like
  `tools something`.
- Common use should work with no arguments or a very small number of arguments.
- Prefer strong defaults over many flags. Add a flag only when the need is
  frequent and hard to infer.
- Keep the command name stable after publication.
- A tool may be implemented in shell, Python, a compiled binary, or another
  runtime. The public `ut-*` command should hide that detail.

## Layout

- `bin/`: executable `ut-*` commands used from Zsh, Fish, and other shells.
- `tools/<tool-name>/`: implementation files and per-tool notes.
- `tools/<tool-name>/tool.toml`: short metadata for agents and maintainers.
- `shell/`: optional shell setup snippets.
- `examples/`: only synthetic or fully anonymized examples.
- `outputs/`, `reports/`, `tmp/`, `.local/`: local-only data, ignored by git.

## Privacy

This repository is public. Never commit private data, credentials, local logs,
raw personal exports, generated personal reports, cookies, tokens, machine-local
state, or real user paths in examples.

If a tool reads private local data, document that clearly in its README and keep
generated output out of git by default.

## Maintenance

- Keep changes narrow and easy to review.
- Preserve existing user-facing command names unless the user asks for a rename.
- Update the root README when adding, renaming, or removing a public command.
- Update the per-tool README or `tool.toml` when behavior changes.
- Verify the actual `ut-*` command, not only the implementation file.
- Before reporting completion, run a privacy-oriented scan for obvious local
  paths or secret-looking strings when files were added or moved.

## Completion Bar

A change is done only when the intended command runs, the README matches the
current behavior, ignored local-output paths are still ignored, and no obvious
private information was introduced.
