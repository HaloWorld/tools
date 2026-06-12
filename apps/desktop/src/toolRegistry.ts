import { Activity, ClipboardList, Database, FileSearch, GitBranch, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const TOOL_PREFIX = "ut-";

export type WorkspaceKey = "library" | "command-index" | "repo-snapshot" | "codex-usage" | "codex-usage-glass-spike" | "glass-lab";

export const toolAreas = [
  {
    label: "Command surface",
    value: "ut-list ready",
    detail: "The shared command catalog for every Universal Tools utility.",
  },
  {
    label: "Project hygiene",
    value: "Repo Snapshot ready",
    detail: "Repository status, ignored output checks, and release readiness.",
  },
  {
    label: "Usage analytics",
    value: "Codex Usage ready",
    detail: "Local usage and cost analysis for tools that write structured logs.",
  },
  {
    label: "Report workspace",
    value: "Local Reports planned",
    detail: "Private report views without cloud sync or committed output.",
  },
  {
    label: "Local diagnostics",
    value: "Log Inspector planned",
    detail: "Structured views over local logs without publishing raw data.",
  },
] as const;

export type ToolAreaLabel = (typeof toolAreas)[number]["label"];

export type ToolCatalogItem = {
  icon: LucideIcon;
  title: string;
  category: ToolAreaLabel;
  meta: string;
  command: string;
  surface: string;
  state: "Ready" | "Planned";
  workspace?: WorkspaceKey;
  disabled?: boolean;
};

export const toolCatalog: ToolCatalogItem[] = [
  {
    icon: ClipboardList,
    title: "Command Index",
    category: "Command surface",
    meta: "Installed ut-* command catalog",
    command: "ut-list",
    surface: "CLI + Desktop",
    state: "Ready",
    workspace: "command-index",
  },
  {
    icon: GitBranch,
    title: "Repo Snapshot",
    category: "Project hygiene",
    meta: "Counts-only Git status",
    command: "ut-repo-snapshot",
    surface: "CLI + Desktop",
    state: "Ready",
    workspace: "repo-snapshot",
  },
  {
    icon: Activity,
    title: "Codex Usage",
    category: "Usage analytics",
    meta: "Token, cost, cache",
    command: "ut-codex-usage",
    surface: "CLI + Desktop",
    state: "Ready",
    workspace: "codex-usage",
  },
  {
    icon: Database,
    title: "Local Reports",
    category: "Report workspace",
    meta: "Private report views",
    command: "ut-reports",
    surface: "Desktop",
    state: "Planned",
    disabled: true,
  },
  {
    icon: FileSearch,
    title: "Log Inspector",
    category: "Local diagnostics",
    meta: "Structured views over local logs",
    command: "ut-log-inspect",
    surface: "CLI + Desktop",
    state: "Planned",
    disabled: true,
  },
  {
    icon: Terminal,
    title: "Script Runner",
    category: "Command surface",
    meta: "Opinionated shortcuts for common scripts",
    command: "ut-run",
    surface: "CLI",
    state: "Planned",
    disabled: true,
  },
];

export const readyToolCount = toolCatalog.filter((tool) => tool.state === "Ready").length;
export const plannedToolCount = toolCatalog.filter((tool) => tool.state === "Planned").length;
export const toolCategoryCount = toolAreas.length;
