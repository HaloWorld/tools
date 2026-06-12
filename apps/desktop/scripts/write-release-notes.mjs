#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const rootDir = resolve(appDir, "../..");
const distDir = process.env.UT_DIST_DIR ?? join(rootDir, "target/release/distribution");
const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const ok = (message) => {
  console.log(`ok: ${message}`);
};

const latestManifestPath = () => {
  const manifests = readdirSync(distDir)
    .filter((name) => /^Universal-Tools-.+-macos-.+\.manifest\.json$/.test(name))
    .filter((name) => name.startsWith(`Universal-Tools-${packageJson.version}-macos-`))
    .sort();
  if (manifests.length === 0) fail(`no Universal Tools ${packageJson.version} manifest found in ${distDir}`);
  return join(distDir, manifests[manifests.length - 1]);
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const manifestPath = process.env.UT_RELEASE_MANIFEST ?? latestManifestPath();
if (!existsSync(manifestPath)) fail(`missing manifest: ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const artifact = (kind) => manifest.artifacts?.find((item) => item.kind === kind);
const zipArtifact = artifact("app-zip");
const checksumArtifact = artifact("sha256");
const caskArtifact = artifact("homebrew-cask");

if (!zipArtifact) fail("manifest is missing app-zip artifact");
if (!checksumArtifact) fail("manifest is missing sha256 artifact");
if (!caskArtifact) fail("manifest is missing homebrew-cask artifact");

for (const item of [zipArtifact, checksumArtifact, caskArtifact]) {
  const path = join(distDir, item.file);
  if (!existsSync(path)) fail(`missing release artifact: ${item.file}`);
  if (item.sizeBytes !== statSync(path).size) fail(`artifact size mismatch: ${item.file}`);
}

const notesPath = process.env.UT_RELEASE_NOTES ?? join(distDir, `Universal-Tools-${manifest.version}-release-notes.md`);
const archLabel = manifest.archs.join(", ");
const signingLabel =
  manifest.signing.signature === "developer-id"
    ? "Developer ID signed and notarized"
    : "Ad-hoc signed local validation build";
const sourceLabel = manifest.source?.shortCommit
  ? `${manifest.source.shortCommit}${manifest.source.repository ? ` (${manifest.source.repository})` : ""}`
  : "not recorded";
const sourceStateLabel = manifest.source?.dirty ? "dirty worktree local build" : "clean worktree";
const commandLabel = (manifest.commands ?? []).map((command) => command.name).join(", ") || "none";
const linkedCommands = (manifest.commands ?? []).map((command) => `\`${command.name}\``).join(", ");

const notes = `# ${manifest.productName} ${manifest.version}

Universal Tools is a local developer toolbox. This release opens to the Universal Tools library, with Command Index, Repo Snapshot, and Codex Usage as ready desktop workspaces inside the broader tool collection.

## Install

Homebrew Cask:

\`\`\`bash
brew install --cask ./universal-tools.rb
\`\`\`

The Cask installs \`${manifest.productName}.app\` and links ${linkedCommands}.

Direct app install:

Download and unzip \`${zipArtifact.file}\`, then move \`${manifest.productName}.app\` to Applications. The app works immediately. To run the CLI without Homebrew, use:

\`\`\`bash
"/Applications/${manifest.productName}.app/Contents/MacOS/ut-list"
"/Applications/${manifest.productName}.app/Contents/MacOS/ut-repo-snapshot" doctor
"/Applications/${manifest.productName}.app/Contents/MacOS/ut-codex-usage" doctor
\`\`\`

Local install from this source checkout:

\`\`\`bash
./install
\`\`\`

The source-checkout installer builds the latest app and copies it to \`~/Applications\` by default. Set \`UT_LINK_CLI=1\` to link the embedded \`ut-*\` commands into a local bin directory.

After Cask install, run \`ut-list\` to see every installed Universal Tools command.
Run \`ut-repo-snapshot doctor\` to check the counts-only repository snapshot tool.
Run \`ut-codex-usage doctor\` only when checking the Codex Usage tool.

## Artifacts

- \`${zipArtifact.file}\` (${formatBytes(zipArtifact.sizeBytes)})
- \`${checksumArtifact.file}\`
- \`${manifestPath.split("/").pop()}\`
- \`${caskArtifact.file}\`

## Verification

- SHA256: \`${zipArtifact.sha256}\`
- Bundle ID: \`${manifest.bundleIdentifier}\`
- Platform: ${manifest.platform} ${archLabel}
- Signing: ${signingLabel}
- Source: ${sourceLabel}
- Source state: ${sourceStateLabel}
- Commands: ${commandLabel}

## Product Scope

- Universal Tools library first: ready tools, planned tools, tool areas, and the shared \`ut-\` prefix.
- App bundle includes the ready CLI commands, and the Homebrew Cask links them into the user's shell path.
- \`ut-list\` and Command Index show the installed Universal Tools command catalog and install completeness.
- \`ut-repo-snapshot\` adds a non-Codex, counts-only repository status workspace.
- \`ut-codex-usage doctor\` checks the Codex Usage tool without parsing local logs.
- Local safety posture on the first screen: no background scans, synthetic preview data, and ignored generated reports.
- Command Index, Repo Snapshot, and Codex Usage are ready tool workspaces inside the Universal Tools library.

## Privacy

Universal Tools reads local data only when a specific workspace is opened or refreshed. Do not upload local reports, raw logs, private exports, or ignored workspace data.
`;

writeFileSync(notesPath, notes);

const written = readFileSync(notesPath, "utf8");
for (const snippet of [
  zipArtifact.file,
  zipArtifact.sha256,
  manifest.bundleIdentifier,
  caskArtifact.file,
  manifest.source?.shortCommit,
  "ut-codex-usage",
  "ut-list",
  "ut-repo-snapshot",
].filter(Boolean)) {
  if (!written.includes(snippet)) fail(`release notes missing ${snippet}`);
}

const notesArtifact = {
  kind: "release-notes",
  file: notesPath.split("/").pop(),
  sizeBytes: statSync(notesPath).size,
};
manifest.artifacts = [
  ...(manifest.artifacts ?? []).filter((item) => item.kind !== notesArtifact.kind),
  notesArtifact,
];
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

ok(`created ${notesPath}`);
ok(`updated ${manifestPath}`);
