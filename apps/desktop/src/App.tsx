import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Clock3,
  DollarSign,
  Gauge,
  GitBranch,
  Layers3,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { plannedToolCount, readyToolCount, toolCategoryCount, TOOL_PREFIX, toolCatalog } from "./toolRegistry";
import type { ToolCatalogItem, WorkspaceKey } from "./toolRegistry";

type UsageSummary = {
  input_tokens: number;
  cached_input_tokens: number;
  uncached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  raw_total_tokens: number;
  cli_display_total: number;
  credits: number;
  usd: number;
};

type UsageRow = {
  key: string;
  label?: string;
  model?: string;
  day?: string;
  week?: string;
  raw_total_tokens: number;
  input_tokens: number;
  cached_input_tokens: number;
  uncached_input_tokens: number;
  output_tokens: number;
  usd: number;
};

type ProfileComparison = {
  profile_total: number;
  local_basis_total: number;
  local_coverage: number;
  unavailable_total: number;
};

type UsageReport = {
  summary: UsageSummary;
  profile_comparison?: ProfileComparison;
  top_days: UsageRow[];
  top_weeks: UsageRow[];
  top_models: UsageRow[];
  top_sessions: UsageRow[];
  top_tasks: UsageRow[];
  cache: {
    used: boolean;
    file_hits: number;
    file_misses: number;
    files_seen: number;
  };
  scan_stats: {
    sessions_seen: number;
    token_events_counted: number;
    files_failed: number;
  };
};

type AppMetadata = {
  productName: string;
  version: string;
  bundleIdentifier: string;
};

type CommandInfo = {
  name: string;
  description: string;
  surface: string;
  ready: boolean;
};

type CommandIndexReport = {
  tool: string;
  version: string;
  command_count: number;
  commands: CommandInfo[];
};

type RepoStatusCounts = {
  staged: number;
  modified: number;
  deleted: number;
  renamed: number;
  untracked: number;
  conflicted: number;
};

type RepoSnapshotReport = {
  tool: string;
  version: string;
  git_available: boolean;
  inside_work_tree: boolean;
  branch_state: "attached" | "detached_or_unknown" | "unknown";
  has_upstream: boolean;
  ahead: number;
  behind: number;
  dirty: boolean;
  counts: RepoStatusCounts;
  privacy: string;
};

declare const __APP_PRODUCT_NAME__: string;
declare const __APP_VERSION__: string;
declare const __APP_BUNDLE_IDENTIFIER__: string;

const PROFILE_TOTAL_STORAGE_KEY = "ut.codexUsage.profileTotal";
const demoMetadata: AppMetadata = {
  productName: __APP_PRODUCT_NAME__,
  version: __APP_VERSION__,
  bundleIdentifier: __APP_BUNDLE_IDENTIFIER__,
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const isTauri = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

const workspaceFromHash = (): WorkspaceKey => {
  if (typeof window === "undefined") return "library";
  if (window.location.hash === "#glass-lab") return "glass-lab";
  if (window.location.hash === "#codex-usage-glass-spike") return "codex-usage-glass-spike";
  if (window.location.hash === "#command-index") return "command-index";
  if (window.location.hash === "#repo-snapshot") return "repo-snapshot";
  if (window.location.hash === "#codex-usage") return "codex-usage";
  return "library";
};

const writeWorkspaceHash = (workspace: WorkspaceKey) => {
  if (typeof window === "undefined") return;
  const nextHash =
    workspace === "glass-lab"
      ? "#glass-lab"
      : workspace === "codex-usage-glass-spike"
        ? "#codex-usage-glass-spike"
      : workspace === "command-index"
      ? "#command-index"
      : workspace === "repo-snapshot"
        ? "#repo-snapshot"
        : workspace === "codex-usage"
          ? "#codex-usage"
          : "";
  if (window.location.hash === nextHash) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
};

const compactNumber = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const fullNumber = (value: number) => new Intl.NumberFormat("en").format(Math.round(value));

const money = (value: number) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);

const storedProfileTotal = () => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PROFILE_TOTAL_STORAGE_KEY) ?? "";
};

const saveProfileTotal = (value: string) => {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(PROFILE_TOTAL_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(PROFILE_TOTAL_STORAGE_KEY);
  }
};

const isValidProfileTotal = (value: string) => {
  const text = value.trim().replace(/[_,]/g, "");
  return text === "" || /^[0-9]+(?:\.[0-9]+)?[kKmMbBtT]?$/.test(text);
};

const formatScanTime = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(value)
    : "Not run";

const formatDuration = (durationMs: number | null) => {
  if (durationMs === null) return "waiting";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
};

const workspaceRouteLabel = (workspace?: WorkspaceKey) => {
  if (!workspace || workspace === "library") return "Not assigned";
  return `#${workspace}`;
};

const dataAccessLabel = (workspace?: WorkspaceKey) => {
  if (workspace === "codex-usage" || workspace === "codex-usage-glass-spike") return "Reads local logs on open";
  if (workspace === "repo-snapshot") return "Reads current repo on open";
  if (workspace === "command-index") return "Reads app bundle only";
  return "No local read";
};

const plural = (value: number, singular: string, pluralLabel = `${singular}s`) =>
  `${value} ${value === 1 ? singular : pluralLabel}`;

const usageDay = (day: string, raw: number, usd: number): UsageRow => ({
  key: day,
  day,
  raw_total_tokens: raw,
  input_tokens: Math.round(raw * 0.977),
  cached_input_tokens: Math.round(raw * 0.928),
  uncached_input_tokens: Math.round(raw * 0.049),
  output_tokens: Math.round(raw * 0.023),
  usd,
});

const usageSession = (key: string, label: string, raw: number, output: number, usd: number): UsageRow => ({
  key,
  label,
  raw_total_tokens: raw,
  input_tokens: raw - output,
  cached_input_tokens: Math.round((raw - output) * 0.92),
  uncached_input_tokens: Math.round((raw - output) * 0.08),
  output_tokens: output,
  usd,
});

const demoReport = (): UsageReport => ({
  summary: {
    input_tokens: 18_335_398_876,
    cached_input_tokens: 17_534_558_796,
    uncached_input_tokens: 800_840_080,
    output_tokens: 64_601_124,
    reasoning_output_tokens: 26_378_349,
    raw_total_tokens: 18_400_000_000,
    cli_display_total: 865_441_204,
    credits: 252_547.42,
    usd: 10_101.9,
  },
  profile_comparison: {
    profile_total: 18_400_000_000,
    local_basis_total: 15_786_738_830,
    local_coverage: 0.858,
    unavailable_total: 2_613_261_170,
  },
  top_days: [
    usageDay("2026-05-27", 380_000_000, 174),
    usageDay("2026-05-28", 520_000_000, 241),
    usageDay("2026-05-29", 610_000_000, 288),
    usageDay("2026-05-30", 440_000_000, 201),
    usageDay("2026-05-31", 790_000_000, 366),
    usageDay("2026-06-01", 1_450_000_000, 742),
    usageDay("2026-06-02", 920_000_000, 451),
    usageDay("2026-06-03", 1_180_000_000, 611),
    usageDay("2026-06-04", 760_000_000, 336),
    usageDay("2026-06-05", 880_000_000, 418),
    usageDay("2026-06-06", 690_000_000, 329),
    usageDay("2026-06-07", 1_020_000_000, 498),
    usageDay("2026-06-08", 560_000_000, 263),
    usageDay("2026-06-09", 1_280_000_000, 652),
  ],
  top_weeks: [],
  top_models: [
    usageSession("gpt-5.4", "gpt-5.4", 12_100_000_000, 80_000_000, 6_620),
    usageSession("gpt-5.4-mini", "gpt-5.4-mini", 4_100_000_000, 30_000_000, 2_120),
    usageSession("gpt-5.3-codex", "gpt-5.3-codex", 2_200_000_000, 20_000_000, 1_360),
  ].map((row) => ({ ...row, model: row.label })),
  top_sessions: [
    usageSession("session-a", "Refactor usage reporting into Rust core", 1_420_000_000, 30_000_000, 688),
    usageSession("session-b", "Build desktop dashboard shell", 920_000_000, 24_000_000, 411),
    usageSession("session-c", "Reconcile profile lifetime totals", 790_000_000, 18_000_000, 386),
    usageSession("session-d", "Tune file-hash cache behavior", 620_000_000, 16_000_000, 294),
    usageSession("session-e", "Shape Universal Tools design system", 540_000_000, 14_000_000, 255),
    usageSession("session-f", "Validate CLI and app output parity", 410_000_000, 12_000_000, 198),
  ],
  top_tasks: [],
  cache: {
    used: true,
    file_hits: 2993,
    file_misses: 1,
    files_seen: 2994,
  },
  scan_stats: {
    sessions_seen: 1685,
    token_events_counted: 121183,
    files_failed: 0,
  },
});

const demoCommandReport = (): CommandIndexReport => ({
  tool: "ut-list",
  version: __APP_VERSION__,
  command_count: 3,
  commands: [
    {
      name: "ut-list",
      description: "Installed Universal Tools command catalog",
      surface: "CLI + Desktop",
      ready: true,
    },
    {
      name: "ut-repo-snapshot",
      description: "Privacy-safe Git repository status snapshot",
      surface: "CLI + Desktop",
      ready: true,
    },
    {
      name: "ut-codex-usage",
      description: "Codex usage summaries from local session logs",
      surface: "CLI + Desktop",
      ready: true,
    },
  ],
});

const demoRepoSnapshot = (): RepoSnapshotReport => ({
  tool: "ut-repo-snapshot",
  version: __APP_VERSION__,
  git_available: true,
  inside_work_tree: true,
  branch_state: "attached",
  has_upstream: true,
  ahead: 0,
  behind: 0,
  dirty: true,
  counts: {
    staged: 1,
    modified: 3,
    deleted: 0,
    renamed: 0,
    untracked: 2,
    conflicted: 0,
  },
  privacy: "counts only; file paths and remote URLs are not printed",
});

function ToolNavItem({
  icon: Icon,
  title,
  meta,
  command,
  state,
  active,
  disabled,
  onSelect,
}: Omit<ToolCatalogItem, "category"> & { active?: boolean; onSelect?: () => void }) {
  return (
    <button className={`navItem ${active ? "active" : ""}`} disabled={disabled} onClick={onSelect} aria-current={active ? "page" : undefined}>
      <Icon size={18} aria-hidden="true" />
      <span>
        <strong>{title}</strong>
        <small>{meta}</small>
        <small className="navCommand">{command}</small>
      </span>
      <em>{state}</em>
    </button>
  );
}

function ToolLibrarySummary() {
  return (
    <section className="suiteCard" aria-label="Universal Tools library status">
      <div>
        <span>Universal Tools</span>
        <strong>
          {readyToolCount} ready, {plannedToolCount} planned
        </strong>
      </div>
      <dl>
        <div>
          <dt>Prefix</dt>
          <dd>{TOOL_PREFIX}</dd>
        </div>
        <div>
          <dt>Ready</dt>
          <dd>{readyToolCount}</dd>
        </div>
      </dl>
    </section>
  );
}

function ToolAreaSummary() {
  return (
    <div className="libraryEssentials" aria-label="Universal Tools library essentials">
      <div>
        <span>Ready now</span>
        <strong>{plural(readyToolCount, "workspace")}</strong>
      </div>
      <div>
        <span>Future slots</span>
        <strong>{plural(plannedToolCount, "planned tool")}</strong>
      </div>
      <div>
        <span>Coverage</span>
        <strong>{plural(toolCategoryCount, "domain")}</strong>
      </div>
    </div>
  );
}

function LibraryWorkspace({
  metadata,
  onOpenWorkspace,
  surface,
}: {
  metadata: AppMetadata;
  onOpenWorkspace: (workspace: WorkspaceKey) => void;
  surface: string;
}) {
  return (
    <section className="libraryWorkspace" aria-label="Universal Tools library">
      <div className="libraryMain">
        <Panel icon={Boxes} title="Tool inventory" meta={`${toolCatalog.length} entries`} className="libraryPanel libraryInventoryPanel">
          <div className="libraryFocus">
            <div>
              <strong>Open a ready workspace</strong>
              <span>Library view does not scan private tool data. A tool reads local data only after you open or refresh it.</span>
            </div>
            <ToolAreaSummary />
          </div>
          <div className="toolRows">
            {toolCatalog.map((tool) => {
              const Icon = tool.icon;
              const canOpen = tool.state === "Ready" && Boolean(tool.workspace);
              return (
                <article className={`toolRow ${canOpen ? "ready" : ""}`} key={tool.title}>
                  <Icon size={18} aria-hidden="true" />
                  <div>
                    <strong>{tool.title}</strong>
                    <span>{tool.meta}</span>
                  </div>
                  <code>{tool.command}</code>
                  <span>{dataAccessLabel(tool.workspace)}</span>
                  {canOpen && tool.workspace ? (
                    <button className="secondaryButton" onClick={() => onOpenWorkspace(tool.workspace!)} aria-label={`Open ${tool.title}`}>
                      Open
                    </button>
                  ) : (
                    <em>{tool.state}</em>
                  )}
                  <div className="toolDetailTray" aria-hidden="true">
                    <dl>
                      <div>
                        <dt>Status</dt>
                        <dd>{tool.state}</dd>
                      </div>
                      <div>
                        <dt>Workspace</dt>
                        <dd>{workspaceRouteLabel(tool.workspace)}</dd>
                      </div>
                      <div>
                        <dt>Surface</dt>
                        <dd>{tool.surface}</dd>
                      </div>
                      <div>
                        <dt>Action</dt>
                        <dd>{canOpen ? "Open workspace" : "Planned"}</dd>
                      </div>
                    </dl>
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>
      </div>

      <aside className="libraryAside" aria-label="Universal Tools release profile">
        <Panel icon={ShieldCheck} title="Library guardrails" meta="Local first">
          <div className="healthList">
            <HealthRow label="Private data" value="Local only" />
            <HealthRow label="Tool scans" value="On open" />
            <HealthRow label="Generated reports" value="Ignored" />
            <HealthRow label="App surface" value={surface} />
          </div>
        </Panel>

        <Panel icon={CheckCircle2} title="Add tools" meta={metadata.version}>
          <div className="plainList">
            <p>Each utility gets one stable `ut-*` command and one library row.</p>
            <p>Desktop workspaces are only for tools that need richer browsing.</p>
          </div>
        </Panel>
      </aside>
    </section>
  );
}

function StatusItem({ label, value, tone }: { label: string; value: string; tone?: "accent" | "ok" | "warn" }) {
  return (
    <div className={`statusItem ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value, sublabel, tone }: { label: string; value: string; sublabel?: string; tone?: "accent" | "blue" | "warn" }) {
  return (
    <article className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sublabel ? <small>{sublabel}</small> : null}
    </article>
  );
}

function Panel({
  icon: Icon,
  title,
  meta,
  children,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panelHead">
        <div>
          <Icon size={17} aria-hidden="true" />
          <h2>{title}</h2>
        </div>
        {meta ? <span>{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function TrendBars({ rows }: { rows: UsageRow[] }) {
  const sorted = [...rows].sort((a, b) => a.key.localeCompare(b.key)).slice(-18);
  const max = Math.max(...sorted.map((row) => row.raw_total_tokens), 1);

  if (sorted.length === 0) {
    return <div className="inlineEmpty">No daily activity found in local logs.</div>;
  }

  return (
    <div className="trend" role="list" aria-label="Daily token activity">
      {sorted.map((row, index) => (
        <div
          className="trendItem"
          key={row.key}
          role="listitem"
          tabIndex={0}
          aria-label={`${row.key}: ${fullNumber(row.raw_total_tokens)} tokens, ${money(row.usd)}`}
          title={`${row.key}: ${fullNumber(row.raw_total_tokens)} tokens`}
        >
          <div className="barTrack">
            <div
              className="barFill"
              style={
                {
                  height: `${Math.max(7, (row.raw_total_tokens / max) * 100)}%`,
                  "--bar-delay": `${80 + index * 16}ms`,
                } as React.CSSProperties
              }
            />
            <div className="barDetail" aria-hidden="true">
              <strong>{compactNumber(row.raw_total_tokens)}</strong>
              <span>{money(row.usd)}</span>
            </div>
          </div>
          <span>{row.key.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function ModelShare({ rows, total }: { rows: UsageRow[]; total: number }) {
  if (rows.length === 0) {
    return <div className="inlineEmpty">No model rows available.</div>;
  }

  return (
    <div className="modelList" role="list">
      {rows.slice(0, 5).map((row, index) => {
        const percent = total > 0 ? (row.raw_total_tokens / total) * 100 : 0;
        return (
          <div
            className="modelRow"
            key={row.key}
            role="listitem"
            tabIndex={0}
            aria-label={`${row.model ?? row.key}: ${percent.toFixed(1)}%, ${fullNumber(row.raw_total_tokens)} tokens`}
          >
            <div>
              <strong>{row.model ?? row.key}</strong>
              <span>{compactNumber(row.raw_total_tokens)} tokens</span>
            </div>
            <div className="shareTrack" aria-hidden="true">
              <div
                style={
                  {
                    width: `${Math.min(percent, 100)}%`,
                    "--share-delay": `${90 + index * 28}ms`,
                  } as React.CSSProperties
                }
              />
            </div>
            <em>{percent.toFixed(1)}%</em>
            <small className="modelDetail" aria-hidden="true">
              {fullNumber(row.raw_total_tokens)} tokens
            </small>
          </div>
        );
      })}
    </div>
  );
}

function UsageTable({ rows }: { rows: UsageRow[] }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Session</th>
            <th>Tokens</th>
            <th>Cached</th>
            <th>Output</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="emptyCell">
                No sessions matched this scan.
              </td>
            </tr>
          ) : (
            rows.slice(0, 8).map((row, index) => (
              <tr key={row.key} className={index === 0 ? "selectedRow" : ""}>
                <td title={row.label ?? row.key}>{row.label ?? row.key}</td>
                <td>{compactNumber(row.raw_total_tokens)}</td>
                <td>{compactNumber(row.cached_input_tokens)}</td>
                <td>{compactNumber(row.output_tokens)}</td>
                <td>{money(row.usd)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CommandTable({ commands }: { commands: CommandInfo[] }) {
  return (
    <div className="tableWrap">
      <table className="commandTable">
        <thead>
          <tr>
            <th>Command</th>
            <th>Description</th>
            <th>Surface</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {commands.length === 0 ? (
            <tr>
              <td colSpan={4} className="emptyCell">
                No installed Universal Tools commands found.
              </td>
            </tr>
          ) : (
            commands.map((command, index) => (
              <tr key={command.name} className={index === 0 ? "selectedRow" : ""}>
                <td>
                  <code>{command.name}</code>
                </td>
                <td>{command.description}</td>
                <td>{command.surface}</td>
                <td>{command.ready ? "Ready" : "Unavailable"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CommandIndexWorkspace({ report }: { report: CommandIndexReport }) {
  const expectedCommandNames = toolCatalog.filter((tool) => tool.state === "Ready").map((tool) => tool.command);
  const installedCommandNames = new Set(report.commands.map((command) => command.name));
  const missingCommandNames = expectedCommandNames.filter((command) => !installedCommandNames.has(command));
  const desktopCommands = report.commands.filter((command) => command.surface.includes("Desktop")).length;
  const cliCommands = report.commands.filter((command) => command.surface.includes("CLI")).length;
  const installStatus = missingCommandNames.length === 0 ? "Complete" : "Incomplete";

  return (
    <section className="workspaceGrid">
      <div className="analysisColumn">
        <section className="summaryBand" aria-label="Command index summary">
          <Metric label="Ready commands" value={String(report.command_count)} sublabel="Installed ut-* commands" tone="accent" />
          <Metric label="Expected commands" value={String(expectedCommandNames.length)} sublabel="Ready tools in catalog" />
          <Metric label="Install status" value={installStatus} sublabel={missingCommandNames.length === 0 ? "No missing commands" : "Check app bundle"} tone={missingCommandNames.length === 0 ? undefined : "warn"} />
          <Metric label="Desktop surface" value={String(desktopCommands)} sublabel={`${cliCommands} shell commands`} />
        </section>

        <Panel icon={ClipboardList} title="Installed commands" meta={`${report.command_count} commands`} className="tablePanel">
          <CommandTable commands={report.commands} />
        </Panel>
      </div>

      <aside className="inspectorColumn" aria-label="Command index diagnostics">
        <Panel icon={CheckCircle2} title="Install check" meta="Ready">
          <div className="healthList">
            <HealthRow label="Command prefix" value={TOOL_PREFIX} />
            <HealthRow label="Installed commands" value={String(report.command_count)} />
            <HealthRow label="Expected commands" value={String(expectedCommandNames.length)} />
            <HealthRow label="Missing commands" value={missingCommandNames.length === 0 ? "None" : missingCommandNames.join(", ")} ok={missingCommandNames.length === 0} />
            <HealthRow label="Private data" value="Not read" />
            <HealthRow label="Source" value="App bundle" />
          </div>
        </Panel>

        <Panel icon={ShieldCheck} title="Shell use" meta="After install">
          <div className="plainList">
            <p>Run `ut-list` to confirm which Universal Tools commands are linked in the shell.</p>
            <p>Run any command with `--help` before using it in scripts.</p>
          </div>
        </Panel>
      </aside>
    </section>
  );
}

function RepoSnapshotWorkspace({ report }: { report: RepoSnapshotReport }) {
  const changedTotal =
    report.counts.staged +
    report.counts.modified +
    report.counts.deleted +
    report.counts.renamed +
    report.counts.untracked +
    report.counts.conflicted;
  const gitStatus = !report.git_available
    ? "Git unavailable"
    : !report.inside_work_tree
      ? "Not a repo"
      : report.dirty
        ? "Dirty"
        : "Clean";
  const syncStatus =
    report.ahead > 0 && report.behind > 0
      ? "Diverged"
      : report.ahead > 0
        ? "Ahead"
        : report.behind > 0
          ? "Behind"
          : report.has_upstream
            ? "Synced"
            : "No upstream";

  return (
    <section className="workspaceGrid">
      <div className="analysisColumn">
        <section className="summaryBand" aria-label="Repository snapshot summary">
          <Metric label="Repository" value={gitStatus} sublabel={report.inside_work_tree ? "Current directory" : "Open inside a Git repo"} tone={report.dirty ? "warn" : "accent"} />
          <Metric label="Changed files" value={String(changedTotal)} sublabel="Counts only" />
          <Metric label="Sync state" value={syncStatus} sublabel={`${report.ahead} ahead, ${report.behind} behind`} />
          <Metric label="Privacy" value="Pathless" sublabel="No filenames or remotes" tone="accent" />
        </section>

        <Panel icon={GitBranch} title="Working tree" meta={report.dirty ? "Changes found" : "Clean"} className="tablePanel">
          <div className="repoCountGrid">
            <Metric label="Staged" value={String(report.counts.staged)} />
            <Metric label="Modified" value={String(report.counts.modified)} />
            <Metric label="Deleted" value={String(report.counts.deleted)} />
            <Metric label="Renamed" value={String(report.counts.renamed)} />
            <Metric label="Untracked" value={String(report.counts.untracked)} />
            <Metric label="Conflicted" value={String(report.counts.conflicted)} tone={report.counts.conflicted > 0 ? "warn" : undefined} />
          </div>
        </Panel>
      </div>

      <aside className="inspectorColumn" aria-label="Repository snapshot diagnostics">
        <Panel icon={CheckCircle2} title="Snapshot health" meta={report.git_available ? "Git found" : "Git missing"}>
          <div className="healthList">
            <HealthRow label="Git available" value={report.git_available ? "Yes" : "No"} ok={report.git_available} />
            <HealthRow label="Inside repository" value={report.inside_work_tree ? "Yes" : "No"} ok={report.inside_work_tree} />
            <HealthRow label="Branch state" value={report.branch_state === "attached" ? "Attached" : "Detached or unknown"} />
            <HealthRow label="Upstream" value={report.has_upstream ? "Configured" : "Not set"} />
            <HealthRow label="Conflicts" value={String(report.counts.conflicted)} ok={report.counts.conflicted === 0} />
          </div>
        </Panel>

        <Panel icon={ShieldCheck} title="Privacy" meta="Counts only">
          <div className="plainList">
            <p>No filenames, file paths, remote URLs, or branch names are shown.</p>
            <p>{report.privacy}</p>
          </div>
        </Panel>
      </aside>
    </section>
  );
}

function HealthRow({ label, value, ok = true }: { label: string; value: string; ok?: boolean }) {
  return (
    <p className="healthRow">
      <span>
        {ok ? <CheckCircle2 size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
        {label}
      </span>
      <strong>{value}</strong>
    </p>
  );
}

function LoadingState() {
  return (
    <section className="statePanel loadingState" aria-live="polite">
      <div>
        <RefreshCw size={18} aria-hidden="true" />
        <strong>Scanning local logs</strong>
        <span>Building the report from local Codex session files.</span>
      </div>
      <div className="skeletonRows" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="statePanel">
      <div>
        <Search size={18} aria-hidden="true" />
        <strong>No local report yet</strong>
        <span>Refresh the report after Codex has written local session logs.</span>
      </div>
    </section>
  );
}

function CommandIndexEmptyState() {
  return (
    <section className="statePanel">
      <div>
        <Search size={18} aria-hidden="true" />
        <strong>No command index yet</strong>
        <span>Refresh commands to read the installed Universal Tools command catalog.</span>
      </div>
    </section>
  );
}

function RepoSnapshotEmptyState() {
  return (
    <section className="statePanel">
      <div>
        <Search size={18} aria-hidden="true" />
        <strong>No repository snapshot yet</strong>
        <span>Refresh status to read counts for the current Git repository.</span>
      </div>
    </section>
  );
}

function GlassMaterialLab() {
  const bars = [42, 52, 37, 68, 58, 78, 49, 61, 44, 72];
  const rows = [
    ["Shell", "Clear edge", "Stable"],
    ["Panel", "Attached layer", "Neutral"],
    ["Inset", "Pressed plate", "Quiet"],
    ["Control", "Raised object", "Ready"],
  ];

  return (
    <section className="glassLab" aria-label="Glass material lab">
      <div className="glassLabScene" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="glassLabHeader">
        <div>
          <span>Hidden material lab</span>
          <h1>Liquid glass primitives</h1>
          <p>Static calibration surface for Universal Tools glass materials. This page does not read local data and is not part of the product navigation.</p>
        </div>
        <div className="glassLabHeaderActions" aria-label="Lab status">
          <span className="labReadyBadge">Ready</span>
          <button className="labPrimaryButton" type="button">
            Preview material
          </button>
        </div>
      </header>

      <section className="glassObjectHero" aria-label="GlassObjectHero material sample">
        <div className="objectHeroPlate">
          <div className="objectHeroBackdrop" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>

          <div className="objectHeroTop">
            <span className="objectMark">UT</span>
            <div className="objectHeroLabel">
              <span>GlassObjectHero</span>
              <strong>Control material board</strong>
            </div>
            <div className="objectHeroStatus">
              <span className="objectReadyBadge">Ready</span>
              <button className="objectCircleButton" type="button" aria-label="Add sample">
                +
              </button>
            </div>
          </div>

          <div className="objectControlBoard">
            <div className="objectControlStack">
              <label className="objectSearch">
                <Search size={16} aria-hidden="true" />
                <input value="Search tools..." readOnly aria-label="Glass search input sample" />
              </label>

              <div className="objectControlRow primaryRow">
                <button className="objectCapsule primary" type="button">
                  Open lab
                </button>
                <button className="objectCapsule secondary" type="button">
                  Pin material
                </button>
                <button className="objectCapsule neutral" type="button">
                  Local profile
                </button>
              </div>

              <div className="objectControlRow secondaryRow">
                <span className="objectToggleChip">
                  <span aria-hidden="true" />
                  Local only
                </span>
                <div className="objectSegmented" aria-label="Glass segmented control sample">
                  <button className="current" type="button">
                    Shell
                  </button>
                  <button type="button">Panel</button>
                  <button type="button">Control</button>
                </div>
              </div>
            </div>

            <aside className="objectInviteCard" aria-label="Glass status card sample">
              <span>Invite member</span>
              <strong>Material review</strong>
              <small>2 primitives need tuning</small>
              <button className="objectCapsule compact" type="button">
                Review
              </button>
            </aside>

            <button className="objectCircleButton plus objectFloatingPlus" type="button" aria-label="Add tool">
              +
            </button>
          </div>
        </div>
      </section>

      <section className="labStressSection" aria-label="Product density stress test">
        <div className="labStressIntro">
          <span>Product density stress test</span>
          <h2>Same material under real tool density</h2>
          <p>Metric plates, charts, tables, and small controls stay here so the glass system can be judged before moving back to product screens.</p>
        </div>

        <section className="labGlassShell" aria-label="GlassShell sample">
        <div className="labShellTop">
          <div>
            <span>GlassShell</span>
            <h2>Continuous transparent base</h2>
            <p>Large shell with clear rim, inner highlight, bottom lowlight, and soft contact shadow.</p>
          </div>
          <div className="labControlGroup" aria-label="GlassControl samples">
            <label>
              Profile total
              <input value="18.4B" readOnly aria-label="Glass input sample" />
            </label>
            <span className="labReadyBadge">Ready</span>
            <span className="labChip">Local</span>
          </div>
        </div>

        <div className="labGrid">
          <section className="labGlassPanel" aria-label="GlassPanel sample">
            <div className="labPanelHead">
              <span>GlassPanel</span>
              <strong>Attached floating layer</strong>
            </div>
            <div className="labInsetGrid" aria-label="GlassInset samples">
              <div className="labGlassInset">
                <span>Lifetime</span>
                <strong>18.4B</strong>
                <small>Inset metric plate</small>
              </div>
              <div className="labGlassInset">
                <span>Cache</span>
                <strong>100%</strong>
                <small>Very soft divider</small>
              </div>
              <div className="labGlassInset">
                <span>Coverage</span>
                <strong>85.8%</strong>
                <small>Amber only for value</small>
              </div>
            </div>
          </section>

          <section className="labGlassPanel" aria-label="Chart bar sample">
            <div className="labPanelHead">
              <span>Chart bar sample</span>
              <strong>Neutral glass bars</strong>
            </div>
            <div className="labChart" role="img" aria-label="Neutral glass bar sample with one highlighted bar">
              {bars.map((height, index) => (
                <span className={index === 5 ? "current" : ""} key={`${height}-${index}`} style={{ "--bar-height": `${height}%` } as CSSProperties} />
              ))}
            </div>
          </section>

          <section className="labGlassPanel labTablePanel" aria-label="Table sample">
            <div className="labPanelHead">
              <span>Table sample</span>
              <strong>Weak row separation</strong>
            </div>
            <div className="labTable">
              {rows.map(([name, detail, state]) => (
                <div className="labTableRow" key={name}>
                  <strong>{name}</strong>
                  <span>{detail}</span>
                  <em>{state}</em>
                </div>
              ))}
            </div>
          </section>

          <section className="labGlassPanel labObjectPanel" aria-label="GlassButton sample">
            <div className="labPanelHead">
              <span>GlassButton</span>
              <strong>Raised amber capsule</strong>
            </div>
            <button className="labPrimaryButton large" type="button">
              Refresh report
            </button>
            <p>Amber is reserved for the primary action and active status. The shadow comes from contact, not glow.</p>
          </section>
        </div>
      </section>
      </section>
    </section>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceKey>(workspaceFromHash);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [commandReport, setCommandReport] = useState<CommandIndexReport | null>(null);
  const [repoReport, setRepoReport] = useState<RepoSnapshotReport | null>(null);
  const [profileTotal, setProfileTotal] = useState(storedProfileTotal);
  const [loading, setLoading] = useState(false);
  const [commandLoading, setCommandLoading] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [commandUpdated, setCommandUpdated] = useState<Date | null>(null);
  const [repoUpdated, setRepoUpdated] = useState<Date | null>(null);
  const [scanDurationMs, setScanDurationMs] = useState<number | null>(null);
  const [commandDurationMs, setCommandDurationMs] = useState<number | null>(null);
  const [repoDurationMs, setRepoDurationMs] = useState<number | null>(null);
  const [appMetadata, setAppMetadata] = useState<AppMetadata>(demoMetadata);

  const refresh = async () => {
    const trimmedProfileTotal = profileTotal.trim();
    if (!isValidProfileTotal(trimmedProfileTotal)) {
      setError("Profile total should look like 18.4B, 18400000000, or 18_400_000_000.");
      setLoading(false);
      return;
    }

    const started = performance.now();
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<UsageReport>("codex_usage_report", {
        request: {
          profileTotal: trimmedProfileTotal || null,
          top: 18,
        },
      });
      setReport(result);
      setLastUpdated(new Date());
      setScanDurationMs(Math.max(0, Math.round(performance.now() - started)));
      saveProfileTotal(trimmedProfileTotal);
    } catch (err) {
      if (!isTauri()) {
        setReport(demoReport());
        setLastUpdated(new Date());
        setScanDurationMs(Math.max(0, Math.round(performance.now() - started)));
        saveProfileTotal(trimmedProfileTotal);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshCommandIndex = async () => {
    const started = performance.now();
    setCommandLoading(true);
    setCommandError(null);
    try {
      const result = await invoke<CommandIndexReport>("command_index_report");
      setCommandReport(result);
      setCommandUpdated(new Date());
      setCommandDurationMs(Math.max(0, Math.round(performance.now() - started)));
    } catch (err) {
      if (!isTauri()) {
        setCommandReport(demoCommandReport());
        setCommandUpdated(new Date());
        setCommandDurationMs(Math.max(0, Math.round(performance.now() - started)));
      } else {
        setCommandError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setCommandLoading(false);
    }
  };

  const refreshRepoSnapshot = async () => {
    const started = performance.now();
    setRepoLoading(true);
    setRepoError(null);
    try {
      const result = await invoke<RepoSnapshotReport>("repo_snapshot_report");
      setRepoReport(result);
      setRepoUpdated(new Date());
      setRepoDurationMs(Math.max(0, Math.round(performance.now() - started)));
    } catch (err) {
      if (!isTauri()) {
        setRepoReport(demoRepoSnapshot());
        setRepoUpdated(new Date());
        setRepoDurationMs(Math.max(0, Math.round(performance.now() - started)));
      } else {
        setRepoError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRepoLoading(false);
    }
  };

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<AppMetadata>("app_metadata")
      .then(setAppMetadata)
      .catch(() => setAppMetadata(demoMetadata));
  }, []);

  const isCodexUsageWorkspace = workspace === "codex-usage" || workspace === "codex-usage-glass-spike";
  const isCodexGlassSpike = workspace === "codex-usage-glass-spike";

  useEffect(() => {
    if (workspace !== "codex-usage" || report || loading || error) return;
    void refresh();
  }, [workspace]);

  useEffect(() => {
    if (workspace !== "codex-usage-glass-spike" || report || loading || error) return;
    void refresh();
  }, [workspace]);

  useEffect(() => {
    if (workspace !== "command-index" || commandReport || commandLoading || commandError) return;
    void refreshCommandIndex();
  }, [workspace]);

  useEffect(() => {
    if (workspace !== "repo-snapshot" || repoReport || repoLoading || repoError) return;
    void refreshRepoSnapshot();
  }, [workspace]);

  useEffect(() => {
    const syncWorkspace = () => setWorkspace(workspaceFromHash());
    window.addEventListener("hashchange", syncWorkspace);
    return () => window.removeEventListener("hashchange", syncWorkspace);
  }, []);

  const selectWorkspace = (nextWorkspace: WorkspaceKey) => {
    setWorkspace(nextWorkspace);
    writeWorkspaceHash(nextWorkspace);
  };

  const coverage = report?.profile_comparison?.local_coverage;
  const cacheRate = useMemo(() => {
    if (!report || report.cache.files_seen === 0) return 0;
    return (report.cache.file_hits / report.cache.files_seen) * 100;
  }, [report]);
  const runState = error ? "Needs attention" : loading ? "Scanning" : report ? "Ready" : "Idle";
  const coverageValue = coverage ? `${(coverage * 100).toFixed(1)}%` : "Optional";
  const missingTokens = report?.profile_comparison?.unavailable_total ?? 0;
  const profileTotalError = profileTotal.trim() && !isValidProfileTotal(profileTotal) ? "Use a number like 18.4B." : "";
  const lastUpdatedLabel = formatScanTime(lastUpdated);
  const scanDurationLabel = formatDuration(scanDurationMs);
  const commandUpdatedLabel = formatScanTime(commandUpdated);
  const commandDurationLabel = formatDuration(commandDurationMs);
  const repoUpdatedLabel = formatScanTime(repoUpdated);
  const repoDurationLabel = formatDuration(repoDurationMs);
  const commandExpectedCount = toolCatalog.filter((tool) => tool.state === "Ready").length;
  const commandMissingCount = commandReport
    ? toolCatalog.filter((tool) => tool.state === "Ready" && !commandReport.commands.some((command) => command.name === tool.command)).length
    : null;
  const runtimeSurface = isTauri() ? "Desktop app" : "Preview";
  const commandState = commandError ? "Needs attention" : commandLoading ? "Checking" : commandReport ? "Ready" : "Idle";
  const repoState = repoError ? "Needs attention" : repoLoading ? "Checking" : repoReport ? "Ready" : "Idle";
  const activeWorkspaceLabel =
    workspace === "library"
      ? "Tool Library"
      : workspace === "glass-lab"
        ? "Glass Material Lab"
      : workspace === "codex-usage-glass-spike"
        ? "Codex Usage Glass Spike"
      : workspace === "command-index"
        ? "Command Index"
        : workspace === "repo-snapshot"
          ? "Repo Snapshot"
          : "Codex Usage";
  const visibleState =
    workspace === "library"
      ? "Ready"
      : workspace === "glass-lab"
        ? "Lab"
      : workspace === "codex-usage-glass-spike"
        ? runState
      : workspace === "command-index"
        ? commandState
        : workspace === "repo-snapshot"
          ? repoState
          : runState;
  const isGlassLab = workspace === "glass-lab";

  return (
    <div className={`appShell ${isGlassLab ? "glassLabApp" : ""} ${isCodexGlassSpike ? "codexUsageGlassSpikeApp" : ""}`} data-theme="dark">
      <a className="skipLink" href="#mainContent">
        Skip to content
      </a>
      {!isGlassLab ? (
      <aside className="toolRail" aria-label="Universal Tools navigation">
        <div className="brand">
          <div className="brandMark">
            <Boxes size={19} aria-hidden="true" />
          </div>
          <div>
            <strong>Universal Tools</strong>
            <span>Local developer toolbox</span>
          </div>
        </div>

        <ToolLibrarySummary />

        <div className="railLabel">Library</div>
        <nav>
          <ToolNavItem
            icon={Boxes}
            title="Tool Library"
            meta="Command inventory"
            command="ut-*"
            surface="Desktop"
            state="Ready"
            active={workspace === "library"}
            onSelect={() => selectWorkspace("library")}
          />
        </nav>

        <div className="railLabel">Workspaces</div>
        <nav>
          {toolCatalog
            .filter((tool) => tool.state === "Ready" && tool.workspace)
            .map((tool) => {
              const workspaceTarget = tool.workspace;
              return (
                <ToolNavItem
                  key={tool.title}
                  {...tool}
                  active={Boolean(workspaceTarget) && (workspace === workspaceTarget || (isCodexGlassSpike && workspaceTarget === "codex-usage"))}
                  disabled={tool.disabled || !workspaceTarget}
                  onSelect={tool.disabled || !workspaceTarget ? undefined : () => selectWorkspace(workspaceTarget)}
                />
              );
            })}
        </nav>

        {workspace !== "library" ? (
          <>
            <div className="railLabel workspaceOnly">Workspace</div>
            <div className="railNote">
              <Layers3 size={16} aria-hidden="true" />
              <span>Active workspace: {activeWorkspaceLabel}</span>
            </div>
          </>
        ) : null}

        <div className="railFooter">
          <span>{runtimeSurface}</span>
          <strong>{visibleState}</strong>
          <small>
            {workspace === "library"
              ? `${readyToolCount} ready tools, ${plannedToolCount} planned`
              : workspace === "command-index"
                ? commandReport
                  ? `${commandReport.command_count} commands, ${commandDurationLabel}`
                  : "No private data required"
                : workspace === "repo-snapshot"
                  ? repoReport
                    ? `${repoReport.dirty ? "dirty" : "clean"}, ${repoDurationLabel}`
                    : "Counts only, no paths"
                  : report
                    ? `${fullNumber(report.scan_stats.sessions_seen)} sessions, ${scanDurationLabel}`
                    : "Local data stays on this machine"}
          </small>
        </div>
      </aside>
      ) : null}

      <main id="mainContent">
        {!isGlassLab ? (
        <div className="topBar">
          <div className="breadcrumb">
            Universal Tools <span>/</span> Tool Library{" "}
            {isCodexUsageWorkspace ? (
              <>
                <span>/</span> <strong>{isCodexGlassSpike ? "Codex Usage Glass Spike" : "Codex Usage"}</strong>
              </>
            ) : workspace === "repo-snapshot" ? (
              <>
                <span>/</span> <strong>Repo Snapshot</strong>
              </>
            ) : workspace === "command-index" ? (
              <>
                <span>/</span> <strong>Command Index</strong>
              </>
            ) : null}
          </div>
          <div
            className={`runBadge ${
              (isCodexUsageWorkspace && error) ||
              (workspace === "command-index" && commandError) ||
              (workspace === "repo-snapshot" && repoError)
                ? "warn"
                : (isCodexUsageWorkspace && loading) ||
                    (workspace === "command-index" && commandLoading) ||
                    (workspace === "repo-snapshot" && repoLoading)
                  ? "scan"
                  : "ok"
            }`}
        >
            {visibleState}
          </div>
        </div>
        ) : null}

        {isGlassLab ? (
          <GlassMaterialLab />
        ) : workspace === "library" ? (
          <section className="homeGlassDeck" aria-label="Universal Tools home">
            <header className="pageHeader">
              <div>
                <span className="toolType">Universal Tools</span>
                <h1>Universal Tools</h1>
                <p>A local toolbox with one command prefix, a shared command catalog, and independent tool workspaces for many small developer utilities. Command Index and Codex Usage are ready today; future tools use the same library model.</p>
              </div>
            </header>

            <section className="statusStrip compact" aria-label="Tool library status">
              <StatusItem label="Ready" value={plural(readyToolCount, "tool")} />
              <StatusItem label="Prefix" value={TOOL_PREFIX} tone="accent" />
              <StatusItem label="Data" value="Local only" />
            </section>

            <LibraryWorkspace metadata={appMetadata} onOpenWorkspace={selectWorkspace} surface={runtimeSurface} />
          </section>
        ) : workspace === "command-index" ? (
          <>
            <header className="pageHeader">
              <div>
                <span className="toolType">Tool workspace</span>
                <h1>Command Index</h1>
                <p>Installed Universal Tools commands, surfaces, and ready status from the current app bundle.</p>
              </div>
              <div className="toolbar" aria-label="Command index actions">
                <button className={`primaryButton ${commandLoading ? "loading" : ""}`} onClick={refreshCommandIndex} disabled={commandLoading}>
                  <RefreshCw size={16} aria-hidden="true" />
                  {commandLoading ? "Checking commands" : "Refresh commands"}
                </button>
              </div>
            </header>

            <section className="statusStrip" aria-label="Command index status">
              <StatusItem label="Library" value={`${readyToolCount} ready`} />
              <StatusItem label="Source" value="App bundle" />
              <StatusItem label="Last check" value={commandUpdatedLabel} />
              <StatusItem label="Commands" value={commandReport ? String(commandReport.command_count) : "No check"} tone="accent" />
              <StatusItem label="Expected" value={String(commandExpectedCount)} />
              <StatusItem label="Install" value={commandMissingCount === null ? "No check" : commandMissingCount === 0 ? "Complete" : "Incomplete"} tone={commandMissingCount && commandMissingCount > 0 ? "warn" : undefined} />
            </section>

            {commandError ? (
              <section className="errorPanel" role="alert">
                <TriangleAlert size={18} aria-hidden="true" />
                <div>
                  <strong>Command index failed</strong>
                  <span>{commandError}</span>
                </div>
              </section>
            ) : null}

            {commandLoading && !commandReport ? (
              <section className="statePanel loadingState" aria-live="polite">
                <div>
                  <RefreshCw size={18} aria-hidden="true" />
                  <strong>Checking installed commands</strong>
                  <span>Reading command files from the current Universal Tools app bundle.</span>
                </div>
                <div className="skeletonRows" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </section>
            ) : null}

            {commandReport ? <CommandIndexWorkspace report={commandReport} /> : !commandLoading ? <CommandIndexEmptyState /> : null}
          </>
        ) : workspace === "repo-snapshot" ? (
          <>
            <header className="pageHeader">
              <div>
                <span className="toolType">Tool workspace</span>
                <h1>Repo Snapshot</h1>
                <p>Counts-only Git repository status for the current working directory, with no file paths, branch names, or remote URLs shown.</p>
              </div>
              <div className="toolbar" aria-label="Repository snapshot actions">
                <button className={`primaryButton ${repoLoading ? "loading" : ""}`} onClick={refreshRepoSnapshot} disabled={repoLoading}>
                  <RefreshCw size={16} aria-hidden="true" />
                  {repoLoading ? "Checking status" : "Refresh status"}
                </button>
              </div>
            </header>

            <section className="statusStrip" aria-label="Repository snapshot status">
              <StatusItem label="Library" value={`${readyToolCount} ready`} />
              <StatusItem label="Source" value="Current repo" />
              <StatusItem label="Last check" value={repoUpdatedLabel} />
              <StatusItem label="Status" value={repoReport ? (repoReport.dirty ? "Dirty" : "Clean") : "No check"} tone={repoReport?.dirty ? "warn" : undefined} />
              <StatusItem label="Paths" value="Hidden" tone="accent" />
              <StatusItem label="Files" value={repoReport ? String(repoReport.counts.staged + repoReport.counts.modified + repoReport.counts.deleted + repoReport.counts.renamed + repoReport.counts.untracked + repoReport.counts.conflicted) : "No check"} />
            </section>

            {repoError ? (
              <section className="errorPanel" role="alert">
                <TriangleAlert size={18} aria-hidden="true" />
                <div>
                  <strong>Repository snapshot failed</strong>
                  <span>{repoError}</span>
                </div>
              </section>
            ) : null}

            {repoLoading && !repoReport ? (
              <section className="statePanel loadingState" aria-live="polite">
                <div>
                  <RefreshCw size={18} aria-hidden="true" />
                  <strong>Checking repository status</strong>
                  <span>Reading Git status counts without showing paths or branch names.</span>
                </div>
                <div className="skeletonRows" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </section>
            ) : null}

            {repoReport ? <RepoSnapshotWorkspace report={repoReport} /> : !repoLoading ? <RepoSnapshotEmptyState /> : null}
          </>
        ) : (
          <section className={`usageGlassShell ${isCodexGlassSpike ? "usageProductSpike" : ""}`} aria-label={isCodexGlassSpike ? "Codex Usage glass product spike" : "Codex Usage workspace"}>
            <header className="pageHeader">
              <div>
                <span className="toolType">Tool workspace</span>
                <h1>Codex Usage</h1>
                <p>Token activity, cost, cache behavior, and profile coverage from local Codex logs.</p>
              </div>
              <div className="toolbar" aria-label="Codex usage actions">
                <label>
                  Profile total
                  <input
                    aria-describedby="profile-total-hint"
                    aria-invalid={Boolean(profileTotalError)}
                    value={profileTotal}
                    onChange={(event) => setProfileTotal(event.target.value)}
                    placeholder="18.4B"
                  />
                  <small id="profile-total-hint" className={profileTotalError ? "fieldError" : ""}>
                    {profileTotalError || "Optional, for profile coverage."}
                  </small>
                </label>
                <button className={`primaryButton ${loading ? "loading" : ""}`} onClick={refresh} disabled={loading || Boolean(profileTotalError)}>
                  <RefreshCw size={16} aria-hidden="true" />
                  {loading ? "Refreshing report" : "Refresh report"}
                </button>
              </div>
            </header>

            <section className="statusStrip" aria-label="Current report status">
              <StatusItem label="Library" value={`${readyToolCount} ready`} />
              <StatusItem label="Source" value="Local Codex logs" />
              <StatusItem label="Last scan" value={lastUpdatedLabel} />
              <StatusItem label="Cache" value={report ? `${cacheRate.toFixed(1)}% hit` : "Waiting"} tone="accent" />
              <StatusItem label="Coverage" value={coverageValue} tone={coverage ? "warn" : undefined} />
              <StatusItem label="Files" value={report ? fullNumber(report.cache.files_seen) : "No scan"} />
            </section>

            {error ? (
              <section className="errorPanel" role="alert">
                <TriangleAlert size={18} aria-hidden="true" />
                <div>
                  <strong>Report failed</strong>
                  <span>{error}</span>
                </div>
              </section>
            ) : null}

            {loading && !report ? <LoadingState /> : null}

            {report ? (
              <section className="workspaceGrid">
                <div className="analysisColumn">
                  <section className="summaryBand" aria-label="Usage summary">
                    <Metric label="Lifetime tokens" value={compactNumber(report.summary.raw_total_tokens)} sublabel={fullNumber(report.summary.raw_total_tokens)} tone="accent" />
                    <Metric label="Estimated cost" value={money(report.summary.usd)} sublabel={`${fullNumber(report.summary.credits)} credits`} />
                    <Metric label="Cached input" value={compactNumber(report.summary.cached_input_tokens)} sublabel={`${compactNumber(report.summary.uncached_input_tokens)} uncached`} />
                    <Metric label="Local coverage" value={coverageValue} sublabel={coverage ? `${compactNumber(missingTokens)} not in logs` : "Profile total optional"} tone="warn" />
                  </section>

                  <Panel icon={Clock3} title="Daily activity" meta={`${report.top_days.length} days`} className="activityPanel">
                    <TrendBars rows={report.top_days} />
                  </Panel>

                  <Panel icon={DollarSign} title="Top sessions" meta={`${report.top_sessions.length} sessions`} className="tablePanel">
                    <UsageTable rows={report.top_sessions} />
                  </Panel>
                </div>

                <aside className="inspectorColumn" aria-label="Codex usage diagnostics">
                  <Panel icon={Gauge} title="Coverage check" meta={coverage ? "Profile compared" : "Local basis"}>
                    <div className="reconcileBlock">
                      <HealthRow label="Profile total" value={report.profile_comparison ? compactNumber(report.profile_comparison.profile_total) : "Not set"} />
                      <HealthRow label="Local basis" value={report.profile_comparison ? compactNumber(report.profile_comparison.local_basis_total) : compactNumber(report.summary.raw_total_tokens)} />
                      <HealthRow label="Unavailable" value={compactNumber(missingTokens)} ok={missingTokens === 0} />
                    </div>
                  </Panel>

                  <Panel icon={BarChart3} title="Model share" meta={`${report.top_models.length} models`}>
                    <ModelShare rows={report.top_models} total={report.summary.raw_total_tokens} />
                  </Panel>

                  <Panel icon={CheckCircle2} title="Run health" meta={report.cache.used ? "Cache enabled" : "Cache rebuilt"}>
                    <div className="healthList">
                      <HealthRow label="Cache hit rate" value={`${cacheRate.toFixed(1)}%`} />
                      <HealthRow label="Token events" value={fullNumber(report.scan_stats.token_events_counted)} />
                      <HealthRow label="Failed files" value={String(report.scan_stats.files_failed)} ok={report.scan_stats.files_failed === 0} />
                      <HealthRow label="Output tokens" value={compactNumber(report.summary.output_tokens)} />
                    </div>
                  </Panel>
                </aside>
              </section>
            ) : !loading ? (
              <EmptyState />
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
