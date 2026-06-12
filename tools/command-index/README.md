# ut-list

Lists the installed Universal Tools commands with the `ut-` prefix and checks
whether every ready command is present.
It is available as both the `ut-list` command and the Command Index desktop
workspace.

Default usage:

```bash
ut-list
```

JSON output:

```bash
ut-list --json
```

Installation check:

```bash
ut-list doctor
```

This tool does not read private project files or local logs. It only inspects
the command files installed next to its own executable.
