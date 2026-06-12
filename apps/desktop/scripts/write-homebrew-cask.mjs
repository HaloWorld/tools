#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const rootDir = resolve(appDir, "../..");
const distDir = process.env.UT_DIST_DIR ?? join(rootDir, "target/release/distribution");
const token = process.env.UT_CASK_TOKEN ?? "universal-tools";
const caskPath = process.env.UT_CASK_PATH ?? join(distDir, `${token}.rb`);
const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const ok = (message) => {
  console.log(`ok: ${message}`);
};

const shellOut = (command, args, cwd = rootDir) =>
  execFileSync(command, args, { cwd, encoding: "utf8" }).trim();

const githubUrlFromRemote = () => {
  const remote = shellOut("git", ["config", "--get", "remote.origin.url"]);
  const sshMatch = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;

  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;

  return null;
};

const latestManifestPath = () => {
  const matches = shellOut("find", [distDir, "-maxdepth", "1", "-name", "Universal-Tools-*-macos-*.manifest.json", "-print"])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => basename(path).startsWith(`Universal-Tools-${packageJson.version}-macos-`))
    .sort();

  if (matches.length === 0) fail(`no Universal Tools ${packageJson.version} manifest found in ${distDir}`);
  return matches[matches.length - 1];
};

const escapeRuby = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

if (!/^[a-z0-9][a-z0-9-]*$/.test(token)) {
  fail(`invalid Homebrew Cask token: ${token}`);
}

const manifestPath = process.env.UT_RELEASE_MANIFEST ?? latestManifestPath();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const zipArtifact = manifest.artifacts?.find((artifact) => artifact.kind === "app-zip");
if (!zipArtifact) fail(`manifest has no app-zip artifact: ${manifestPath}`);
if (!/^[a-f0-9]{64}$/.test(zipArtifact.sha256)) fail("manifest app-zip artifact has invalid sha256");
if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
  fail("manifest must include at least one ready command");
}

const repoUrl = process.env.UT_RELEASE_REPO_URL ?? githubUrlFromRemote();
if (!repoUrl) fail("set UT_RELEASE_REPO_URL or configure a GitHub origin remote");

const releaseBaseUrl =
  process.env.UT_RELEASE_BASE_URL ?? `${repoUrl}/releases/download/v${manifest.version}`;
const downloadUrl = `${releaseBaseUrl.replace(/\/$/, "")}/${zipArtifact.file}`;

let parsedDownloadUrl;
try {
  parsedDownloadUrl = new URL(downloadUrl);
} catch {
  fail(`invalid Homebrew Cask URL: ${downloadUrl}`);
}

if (parsedDownloadUrl.protocol !== "https:") {
  fail(`Homebrew Cask URL must use https: ${downloadUrl}`);
}

if (!parsedDownloadUrl.pathname.endsWith(`/${zipArtifact.file}`)) {
  fail(`Homebrew Cask URL must end with ${zipArtifact.file}`);
}

if (!existsSync(join(distDir, zipArtifact.file))) {
  fail(`missing zip artifact referenced by manifest: ${zipArtifact.file}`);
}

const cask = `cask "${escapeRuby(token)}" do
  version "${escapeRuby(manifest.version)}"
  sha256 "${zipArtifact.sha256}"

  url "${escapeRuby(downloadUrl)}"
  name "${escapeRuby(manifest.productName)}"
  desc "Local developer toolbox with ut-* commands"
  homepage "${escapeRuby(repoUrl)}"

  app "${escapeRuby(manifest.productName)}.app"
${(manifest.commands ?? [])
  .map((command) => `  binary "#{appdir}/${escapeRuby(manifest.productName)}.app/Contents/MacOS/${escapeRuby(command.name)}"`)
  .join("\n")}
end
`;

writeFileSync(caskPath, cask);

const written = readFileSync(caskPath, "utf8");
const requiredSnippets = [
  `cask "${token}" do`,
  `version "${manifest.version}"`,
  `sha256 "${zipArtifact.sha256}"`,
  `url "${downloadUrl}"`,
  `name "${manifest.productName}"`,
  `app "${manifest.productName}.app"`,
  ...(manifest.commands ?? []).map((command) => `binary "#{appdir}/${manifest.productName}.app/Contents/MacOS/${command.name}"`),
];

for (const snippet of requiredSnippets) {
  if (!written.includes(snippet)) fail(`generated Cask is missing ${snippet}`);
}

const caskArtifact = {
  kind: "homebrew-cask",
  file: basename(caskPath),
  sizeBytes: statSync(caskPath).size,
};
manifest.artifacts = [
  ...(manifest.artifacts ?? []).filter((artifact) => artifact.kind !== caskArtifact.kind),
  caskArtifact,
];
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

ok(`created ${caskPath}`);
ok(`updated ${manifestPath}`);
ok(`Homebrew Cask URL: ${downloadUrl}`);
