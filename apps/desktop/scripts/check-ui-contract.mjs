#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const rootDir = resolve(appDir, "../..");
const appTsxPath = join(appDir, "src/App.tsx");
const registryPath = join(appDir, "src/toolRegistry.ts");
const stylesPath = join(appDir, "src/styles.css");
const productPath = join(rootDir, "PRODUCT.md");
const designPath = join(rootDir, "DESIGN.md");

const app = readFileSync(appTsxPath, "utf8");
const registry = readFileSync(registryPath, "utf8");
const styles = readFileSync(stylesPath, "utf8");
const product = readFileSync(productPath, "utf8");
const design = readFileSync(designPath, "utf8");

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const ok = (message) => {
  console.log(`ok: ${message}`);
};

const expectIncludes = (label, text, needle) => {
  if (!text.includes(needle)) fail(`${label} must include ${JSON.stringify(needle)}`);
};

const expectMatches = (label, text, pattern) => {
  if (!pattern.test(text)) fail(`${label} does not match ${pattern}`);
};

const cssBlock = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? "";
};

expectIncludes("Codex Usage route", app, 'window.location.hash === "#codex-usage"');
expectIncludes("Command Index route", app, 'window.location.hash === "#command-index"');
expectIncludes("Repo Snapshot route", app, 'window.location.hash === "#repo-snapshot"');
expectIncludes("App route writer", app, 'workspace === "repo-snapshot"');
expectIncludes("Tool registry import", app, 'from "./toolRegistry"');
expectIncludes("Theme token entry", app, 'data-theme="dark"');
expectIncludes("Skip link", app, 'className="skipLink" href="#mainContent"');
expectIncludes("Main content target", app, '<main id="mainContent">');
expectIncludes("Universal Tools home heading", app, "<h1>Universal Tools</h1>");
expectIncludes("Multi-tool product copy", app, "independent tool workspaces");
expectIncludes("Multi-workspace ready copy", app, "future tools use the same library model");
expectIncludes("Plural helper", app, "const plural =");
expectIncludes("Ready tool grammar", app, 'value={plural(readyToolCount, "tool")}');
expectIncludes("Codex Usage workspace declaration", registry, 'workspace: "codex-usage"');
expectIncludes("Codex Usage ready state", registry, 'state: "Ready"');
expectIncludes("Command Index ready command", registry, 'command: "ut-list"');
expectIncludes("Command Index workspace declaration", registry, 'workspace: "command-index"');
expectIncludes("Repo Snapshot ready command", registry, 'command: "ut-repo-snapshot"');
expectIncludes("Repo Snapshot ready state", registry, 'title: "Repo Snapshot"');
expectIncludes("Repo Snapshot workspace declaration", registry, 'workspace: "repo-snapshot"');
expectIncludes("Repo Snapshot desktop surface", registry, 'surface: "CLI + Desktop"');
expectIncludes("Planned tool slots", registry, 'state: "Planned"');
expectIncludes("Non-Codex ready tool", registry, 'title: "Repo Snapshot"');
expectIncludes("Tool categories", registry, "category:");
expectIncludes("Tool category count", registry, "toolCategoryCount");
expectIncludes("Tool area source", registry, "export const toolAreas");
expectIncludes("Tool prefix declaration", registry, 'export const TOOL_PREFIX = "ut-"');
expectIncludes("Tool area summary count", app, 'plural(toolCategoryCount, "domain")');
expectIncludes("Specific open action", app, 'aria-label={`Open ${tool.title}`}');
expectIncludes("Non-workspace tool state", app, "<em>{tool.state}</em>");
expectIncludes("Tool Library workspace opener", app, "onOpenWorkspace={selectWorkspace}");
expectIncludes("Command Index heading", app, "<h1>Command Index</h1>");
expectIncludes("Command Index backend invoke", app, '"command_index_report"');
expectIncludes("Command Index table", app, 'className="commandTable"');
expectIncludes("Command Index expected command check", app, "expectedCommandNames");
expectIncludes("Command Index missing command check", app, "missingCommandNames");
expectIncludes("Command Index install status", app, "Install status");
expectIncludes("Repo Snapshot heading", app, "<h1>Repo Snapshot</h1>");
expectIncludes("Repo Snapshot backend invoke", app, '"repo_snapshot_report"');
expectIncludes("Repo Snapshot privacy copy", app, "No filenames, file paths, remote URLs, or branch names are shown.");
expectIncludes("Repo Snapshot count grid", styles, ".repoCountGrid");
expectIncludes("Tool inventory panel", app, 'title="Tool inventory"');
expectIncludes("Library no-scan copy", app, "Library view does not scan private tool data");
expectIncludes("Library guardrails panel", app, 'title="Library guardrails"');
expectIncludes("Private data local", app, 'label="Private data" value="Local only"');
expectIncludes("Tool scans on open", app, 'label="Tool scans" value="On open"');
expectIncludes("Generated reports ignored", app, 'label="Generated reports" value="Ignored"');
expectIncludes("Tool area summary style", styles, ".libraryEssentials");
expectIncludes("Glass surface token", styles, "--surface-panel");
expectIncludes("Glass strong token", styles, "--surface-panel-strong");
expectIncludes("Glass border token", styles, "--glass-border");
expectIncludes("Glass blur token", styles, "--glass-blur");
expectIncludes("Glass edge token", styles, "--glass-edge");
expectIncludes("Glass caustic token", styles, "--glass-caustic");
expectIncludes("Glass press token", styles, "--glass-press-shadow");
expectIncludes("Future light theme token", styles, '.appShell[data-theme="light"]');
expectIncludes("Backdrop filter use", styles, "backdrop-filter: var(--glass-blur)");
expectIncludes("WebKit backdrop filter use", styles, "-webkit-backdrop-filter: var(--glass-blur)");
expectIncludes("Motion fast token", styles, "--motion-fast");
expectIncludes("Glass motion token", styles, "--motion-glass");
expectIncludes("Motion easing token", styles, "--ease-out-expo");
expectIncludes("Workspace enter animation", styles, "@keyframes workspaceEnter");
expectIncludes("Glass sheen animation", styles, "@keyframes glassSheen");
expectIncludes("Chart grow animation", styles, "@keyframes barGrow");
expectIncludes("Share grow animation", styles, "@keyframes shareGrow");
expectIncludes("Loading rotation", styles, "@keyframes refreshSpin");
expectIncludes("Skeleton motion", styles, "@keyframes skeletonSweep");
expectIncludes("Reduced motion", styles, "@media (prefers-reduced-motion: reduce)");
expectIncludes("Loading state class", app, "loadingState");
expectIncludes("Button loading class", app, 'loading ? "loading"');
expectIncludes("Chart bar delay", app, "--bar-delay");
expectIncludes("Model share delay", app, "--share-delay");
expectIncludes("Tool row detail tray", app, "toolDetailTray");
expectIncludes("Chart detail reveal", app, "barDetail");
expectIncludes("Model detail reveal", app, "modelDetail");
expectIncludes("Chart keyboard focus", app, "tabIndex={0}");
expectIncludes("Chart list semantics", app, '<div className="trend" role="list"');
expectIncludes("Inspect item semantics", app, 'role="listitem"');
expectIncludes("Chart detail hidden from screen reader", app, 'className="barDetail" aria-hidden="true"');
expectIncludes("Model detail hidden from screen reader", app, 'className="modelDetail" aria-hidden="true"');
expectIncludes("Tool route detail label", app, "workspaceRouteLabel");
expectIncludes("Tool data access detail label", app, "dataAccessLabel");
expectIncludes("Secondary button desktop height", styles, "min-height: 38px");
expectIncludes("Navigation focus style", styles, ".navItem:focus-visible");
expectIncludes("Liquid glass background field", styles, ".appShell::after");
expectIncludes("Liquid glass structural rim", styles, "var(--glass-edge)");
expectIncludes("Liquid glass strong rim", styles, "var(--glass-edge-strong)");
expectIncludes("Liquid glass press feedback", styles, "scale(0.986)");
expectIncludes("Tool row detail tray style", styles, ".toolDetailTray");
expectIncludes("Tool row hover detail reveal", styles, ".toolRow.ready:hover .toolDetailTray");
expectIncludes("Tool row focus detail reveal", styles, ".toolRow.ready:focus-within .toolDetailTray");
expectIncludes("Tool row hover motion survives entry animation", styles, "animation: itemEnter var(--motion-glass) var(--ease-out-expo) backwards");
expectIncludes("Chart hover detail style", styles, ".trendItem:hover .barDetail");
expectIncludes("Chart focus detail style", styles, ".trendItem:focus-visible .barDetail");
expectIncludes("Chart edge detail guard", styles, ".trendItem:first-child .barDetail");
expectIncludes("Chart last detail guard", styles, ".trendItem:last-child .barDetail");
expectIncludes("Chart neighbor dimming", styles, ".trend:hover .trendItem:not(:hover):not(:focus-visible) .barTrack");
expectIncludes("Model row hover detail style", styles, ".modelRow:hover .modelDetail");
expectIncludes("Model row focus detail style", styles, ".modelRow:focus-visible .modelDetail");
expectIncludes("Model share track focus motion", styles, ".modelRow:focus-visible .shareTrack");
expectIncludes("Balanced headings", styles, "text-wrap: balance");
expectIncludes("Pretty page copy", styles, "text-wrap: pretty");
expectIncludes("Mobile touch target", styles, "min-height: 44px");

const commandIndexPosition = registry.indexOf('title: "Command Index"');
const codexUsagePosition = registry.indexOf('title: "Codex Usage"');
if (commandIndexPosition === -1 || codexUsagePosition === -1 || commandIndexPosition > codexUsagePosition) {
  fail("Command Index must stay before Codex Usage in the tool catalog");
}

const commandSurfacePosition = registry.indexOf('label: "Command surface"');
const usageAnalyticsPosition = registry.indexOf('label: "Usage analytics"');
if (commandSurfacePosition === -1 || usageAnalyticsPosition === -1 || commandSurfacePosition > usageAnalyticsPosition) {
  fail("Command surface must stay before usage analytics in the tool areas");
}

expectMatches("No eager Codex refresh on app mount", app, /if \(workspace !== "codex-usage" \|\| report \|\| loading \|\| error\) return;\s+void refresh\(\);/);
if (/useEffect\(\(\) => \{\s*void refresh\(\);\s*\}, \[\]\);/.test(app)) {
  fail("App must not refresh Codex Usage on initial Tool Library load");
}

expectIncludes("Anchor focus style", styles, "a:focus-visible");
expectIncludes("Skip link style", styles, ".skipLink");
const disabledNav = cssBlock(".navItem:disabled");
if (!disabledNav) fail("missing .navItem:disabled style");
if (/opacity\s*:/.test(disabledNav)) fail(".navItem:disabled must not rely on whole-control opacity");
expectIncludes("Disabled title style", styles, ".navItem:disabled strong");
expectIncludes("Disabled metadata style", styles, ".navItem:disabled small");

expectIncludes("Product lazy local data rule", product, "Workspace-triggered local access");
expectIncludes("Product visible safety rule", product, "Visible safety posture");
expectIncludes("Product boundary rule", product, "Codex Usage is one ready desktop workspace");
expectIncludes("Product multi-tool boundary", product, "not a Codex Usage wrapper");
expectIncludes("Product presentation independence", product, "Presentation independence");
expectIncludes("Design default library rule", design, "The Default Library Rule");
expectIncludes("Design lazy local data rule", design, "The Lazy Local Data Rule");
expectIncludes("Design presentation boundary rule", design, "The Presentation Boundary Rule");
expectIncludes("Design local safety rule", design, "Local Safety");
expectIncludes("Design disabled readability rule", design, "Do not rely");
expectIncludes("Design motion rule", design, "Motion is state feedback, not decoration");
expectIncludes("Design Liquid Glass rule", design, "The Liquid Glass Rule");
expectIncludes("Design thick glass rule", design, "The Thick Glass Rule");
expectIncludes("Design refraction rule", design, "The Refraction Rule");
expectIncludes("Design theme token rule", design, "The Theme Token Rule");
expectIncludes("Design inspect motion rule", design, "Inspect-on-Hover");
expectIncludes("Design glass response rule", design, "Glass Response");
expectIncludes("Design material press rule", design, "Material Press");
expectIncludes("Design chart detail guard", design, "stay inside the visible report");
expectIncludes("Design motion color-only ban", design, "color change alone");
expectIncludes("Design reduced motion rule", design, "prefers-reduced-motion");

for (const [label, text] of [
  ["App", app],
  ["Product", product],
  ["Design", design],
]) {
  for (const forbidden of [
    "Codex Usage is the first",
    "Codex Usage lives as the first",
    "first ready desktop workspace",
    "first two ready desktop workspaces",
    "starting with Codex Usage",
  ]) {
    if (text.includes(forbidden)) fail(`${label} narrows Universal Tools around Codex Usage: ${forbidden}`);
  }
}

const areaLabels = new Set([...registry.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]));
const catalogCategories = new Set([...registry.matchAll(/category: "([^"]+)"/g)].map((match) => match[1]));
for (const category of catalogCategories) {
  if (!areaLabels.has(category)) {
    fail(`tool catalog category ${JSON.stringify(category)} is missing from toolAreas`);
  }
}

ok("UI contract checks passed");
