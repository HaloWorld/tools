#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const rootDir = resolve(appDir, "../..");
const appPath = join(appDir, "src/App.tsx");
const registryPath = join(appDir, "src/toolRegistry.ts");
const tauriMainPath = join(appDir, "src-tauri/src/main.rs");
const distDir = join(appDir, "dist");
const readmePath = join(rootDir, "README.md");
const releaseReadmePath = join(appDir, "RELEASE.md");
const notesScriptPath = join(appDir, "scripts/write-release-notes.mjs");

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

const read = (path) => readFileSync(path, "utf8");

const registry = read(registryPath);
const app = read(appPath);
const tauriMain = read(tauriMainPath);
const readme = read(readmePath);
const releaseReadme = read(releaseReadmePath);
const notesScript = read(notesScriptPath);

const catalogMatch = registry.match(/export const toolCatalog: ToolCatalogItem\[] = \[([\s\S]*?)\];/);
if (!catalogMatch) fail("could not find toolCatalog in toolRegistry.ts");

const catalogBlocks = catalogMatch[1].match(/\{\s*icon:[\s\S]*?\n  \}/g) ?? [];
const extractField = (block, field) => block.match(new RegExp(`${field}:\\s*"([^"]+)"`))?.[1] ?? null;
const tools = catalogBlocks.map((block) => ({
  title: extractField(block, "title"),
  command: extractField(block, "command"),
  surface: extractField(block, "surface"),
  state: extractField(block, "state"),
  workspace: extractField(block, "workspace"),
}));

const readyTools = tools.filter((tool) => tool.state === "Ready");
if (readyTools.length < 3) fail(`expected at least 3 ready tools, found ${readyTools.length}`);

const workspaceBackends = new Map([
  ["command-index", "command_index_report"],
  ["repo-snapshot", "repo_snapshot_report"],
  ["codex-usage", "codex_usage_report"],
]);

const readyWorkspaceLabels = [];

for (const tool of readyTools) {
  if (!tool.title || !tool.command || !tool.surface) {
    fail(`ready tool is missing title, command, or surface: ${JSON.stringify(tool)}`);
  }
  if (!tool.command.startsWith("ut-")) fail(`${tool.title} command must use the ut- prefix`);
  if (tool.surface.includes("Desktop") && !tool.workspace) {
    fail(`${tool.title} is marked for Desktop but has no workspace`);
  }
  if (!tool.workspace) continue;

  readyWorkspaceLabels.push(tool.title);
  const hash = `#${tool.workspace}`;
  const backend = workspaceBackends.get(tool.workspace);

  expectIncludes(`${tool.title} hash route`, app, `window.location.hash === "${hash}"`);
  expectIncludes(`${tool.title} hash writer`, app, `workspace === "${tool.workspace}"`);
  expectIncludes(`${tool.title} heading`, app, `<h1>${tool.title}</h1>`);
  expectIncludes(`${tool.title} catalog command`, app, tool.command);
  expectIncludes(`${tool.title} README`, readme, tool.title);
  expectIncludes(`${tool.title} release guide`, releaseReadme, tool.title);
  expectIncludes(`${tool.title} release notes`, notesScript, tool.title);

  if (backend) {
    expectIncludes(`${tool.title} frontend invoke`, app, `"${backend}"`);
    expectIncludes(`${tool.title} Tauri command`, tauriMain, `fn ${backend}`);
    expectIncludes(`${tool.title} Tauri handler`, tauriMain, backend);
  }
}

expectIncludes("Universal Tools product copy", app, "A local toolbox with one command prefix");
expectIncludes("workspace opener", app, "onOpenWorkspace={selectWorkspace}");
expectIncludes("ready workspace status strip", app, 'label="Ready" value={plural(readyToolCount, "tool")}');

const requireDist = process.env.UT_REQUIRE_DIST === "1";
if (existsSync(distDir)) {
  const distFiles = readdirSync(join(distDir, "assets"))
    .filter((name) => /\.(js|css)$/.test(name))
    .map((name) => join(distDir, "assets", name));
  const distText = [read(join(distDir, "index.html")), ...distFiles.map(read)].join("\n");
  for (const tool of readyTools.filter((item) => item.workspace)) {
    expectIncludes(`${tool.title} built route`, distText, `#${tool.workspace}`);
    expectIncludes(`${tool.title} built heading`, distText, tool.title);
    expectIncludes(`${tool.title} built command`, distText, tool.command);
  }
} else if (requireDist) {
  fail("apps/desktop/dist is required for release workspace verification");
} else {
  console.log("note: apps/desktop/dist not found; skipped built asset workspace check");
}

if (!readyWorkspaceLabels.includes("Command Index")) fail("Command Index must be a ready workspace");
if (!readyWorkspaceLabels.includes("Repo Snapshot")) fail("Repo Snapshot must be a ready workspace");
if (!readyWorkspaceLabels.includes("Codex Usage")) fail("Codex Usage must be a ready workspace");

ok(`workspace contract checks passed for ${readyWorkspaceLabels.join(", ")}`);
