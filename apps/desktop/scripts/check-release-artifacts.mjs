#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
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

const requireFile = (path) => {
  if (!existsSync(path)) fail(`missing file: ${path}`);
};

const sha256File = (path) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
};

const latestManifestPath = () => {
  const manifests = readdirSync(distDir)
    .filter((name) => /^Universal-Tools-.+-macos-.+\.manifest\.json$/.test(name))
    .filter((name) => name.startsWith(`Universal-Tools-${packageJson.version}-macos-`))
    .sort();
  if (manifests.length === 0) fail(`no Universal Tools ${packageJson.version} manifest found in ${distDir}`);
  return join(distDir, manifests[manifests.length - 1]);
};

const manifestPath = process.env.UT_RELEASE_MANIFEST ?? latestManifestPath();
requireFile(manifestPath);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const artifact = (kind) => manifest.artifacts?.find((item) => item.kind === kind);
const zipArtifact = artifact("app-zip");
const checksumArtifact = artifact("sha256");
const caskArtifact = artifact("homebrew-cask");
const notesArtifact = artifact("release-notes");

if (!zipArtifact) fail("manifest is missing app-zip artifact");
if (!checksumArtifact) fail("manifest is missing sha256 artifact");
if (!caskArtifact) fail("manifest is missing homebrew-cask artifact");
if (!notesArtifact) fail("manifest is missing release-notes artifact");

const zipPath = join(distDir, zipArtifact.file);
const checksumPath = join(distDir, checksumArtifact.file);
const caskPath = join(distDir, caskArtifact.file);
const notesPath = join(distDir, notesArtifact.file);
requireFile(zipPath);
requireFile(checksumPath);
requireFile(caskPath);
requireFile(notesPath);

const zipSha256 = sha256File(zipPath);
if (zipArtifact.sha256 !== zipSha256) {
  fail(`manifest zip sha256 expected ${zipSha256}, got ${zipArtifact.sha256}`);
}

const checksumText = readFileSync(checksumPath, "utf8");
if (!checksumText.includes(zipSha256) || !checksumText.includes(zipArtifact.file)) {
  fail("checksum file does not match the zip artifact");
}

if (zipArtifact.sizeBytes !== statSync(zipPath).size) {
  fail("manifest zip size does not match the zip artifact");
}

if (checksumArtifact.sizeBytes !== statSync(checksumPath).size) {
  fail("manifest checksum size does not match the checksum artifact");
}

if (caskArtifact.sizeBytes !== statSync(caskPath).size) {
  fail("manifest Homebrew Cask size does not match the Cask artifact");
}

if (notesArtifact.sizeBytes !== statSync(notesPath).size) {
  fail("manifest release notes size does not match the notes artifact");
}

let zipEntries;
try {
  zipEntries = execFileSync("zipinfo", ["-1", zipPath], { encoding: "utf8", stdio: "pipe" })
    .split(/\r?\n/)
    .filter(Boolean);
} catch {
  fail("could not inspect zip artifact entries");
}

const forbiddenZipEntry = zipEntries.find((entry) => {
  const parts = entry.split("/");
  return parts.includes("__MACOSX") || parts.some((part) => part.startsWith("._")) || parts.includes(".DS_Store");
});

if (forbiddenZipEntry) {
  fail(`zip artifact contains macOS metadata file: ${forbiddenZipEntry}`);
}

if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
  fail("manifest is missing ready commands");
}

for (const command of manifest.commands) {
  if (!zipEntries.includes(`${manifest.productName}.app/Contents/MacOS/${command.name}`)) {
    fail(`zip artifact is missing embedded ${command.name} command`);
  }
}

const cask = readFileSync(caskPath, "utf8");
const caskUrlMatch = cask.match(/^\s*url\s+"([^"]+)"/m);
if (!caskUrlMatch) fail("Homebrew Cask is missing url");

let caskUrl;
try {
  caskUrl = new URL(caskUrlMatch[1]);
} catch {
  fail(`Homebrew Cask URL is invalid: ${caskUrlMatch[1]}`);
}

if (caskUrl.protocol !== "https:") fail(`Homebrew Cask URL must use https: ${caskUrl.href}`);
if (!caskUrl.pathname.endsWith(`/${zipArtifact.file}`)) {
  fail(`Homebrew Cask URL must end with ${zipArtifact.file}`);
}

const caskRequirements = [
  `version "${manifest.version}"`,
  `sha256 "${zipSha256}"`,
  zipArtifact.file,
  `name "${manifest.productName}"`,
  `app "${manifest.productName}.app"`,
  ...manifest.commands.map((command) => `binary "#{appdir}/${manifest.productName}.app/Contents/MacOS/${command.name}"`),
];

for (const snippet of caskRequirements) {
  if (!cask.includes(snippet)) fail(`Homebrew Cask is missing ${snippet}`);
}

try {
  execFileSync("ruby", ["-c", caskPath], { stdio: "pipe" });
} catch {
  fail("Homebrew Cask Ruby syntax check failed");
}

const notes = readFileSync(notesPath, "utf8");
if (!manifest.source?.repository) fail("manifest is missing source repository");
if (!/^[a-f0-9]{40}$/.test(manifest.source?.commit ?? "")) fail("manifest is missing source commit");
if (!/^[a-f0-9]{12}$/.test(manifest.source?.shortCommit ?? "")) fail("manifest is missing source short commit");
if (typeof manifest.source?.dirty !== "boolean") fail("manifest source dirty state is missing");
if (manifest.releaseKind === "public" && manifest.source.dirty) {
  fail("public release manifest must not be built from a dirty worktree");
}
const notesRequirements = [
  zipArtifact.file,
  zipSha256,
  checksumArtifact.file,
  caskArtifact.file,
  manifest.bundleIdentifier,
  `${manifest.productName} ${manifest.version}`,
  "brew install --cask ./universal-tools.rb",
  "./install",
  "~/Applications",
  `"/Applications/${manifest.productName}.app/Contents/MacOS/ut-list"`,
  `"/Applications/${manifest.productName}.app/Contents/MacOS/ut-repo-snapshot" doctor`,
  `"/Applications/${manifest.productName}.app/Contents/MacOS/ut-codex-usage" doctor`,
  "ut-list",
  "ut-repo-snapshot doctor",
  "ut-codex-usage doctor",
  manifest.source.shortCommit,
];

for (const snippet of notesRequirements) {
  if (!notes.includes(snippet)) fail(`release notes are missing ${snippet}`);
}

if (manifest.productName !== "Universal Tools") fail("unexpected product name in manifest");
if (manifest.bundleIdentifier !== "com.haloworld.universaltools") fail("unexpected bundle identifier in manifest");
if (manifest.platform !== "macos") fail("unexpected platform in manifest");
if (!["local", "public"].includes(manifest.releaseKind)) fail("unexpected release kind in manifest");
if (!["adhoc", "developer-id"].includes(manifest.signing?.signature)) {
  fail("manifest signing signature must be adhoc or developer-id");
}
if (manifest.releaseKind === "public") {
  if (manifest.signing.signature !== "developer-id") {
    fail("public release manifest must be Developer ID signed");
  }
  if (!manifest.signing.teamIdentifier || manifest.signing.teamIdentifier === "-") {
    fail("public release manifest must include a TeamIdentifier");
  }
}
for (const name of ["ut-codex-usage", "ut-list", "ut-repo-snapshot"]) {
  const command = manifest.commands.find((item) => item.name === name);
  if (!command) fail(`manifest is missing ${name} command`);
  if (command.path !== `${manifest.productName}.app/Contents/MacOS/${name}`) {
    fail(`manifest ${name} path is wrong`);
  }
  if (command.version !== `${name} ${manifest.version}`) {
    fail(`manifest ${name} version is wrong`);
  }
  if (command.doctor !== true) fail(`manifest ${name} doctor check is not true`);
}

const verifyDirectInstallCommands = (extractedApp) => {
  const macosDir = join(extractedApp, "Contents/MacOS");
  const directListText = execFileSync(join(macosDir, "ut-list"), [], { encoding: "utf8" });
  for (const snippet of ["Universal Tools commands", "ut-list", "ut-repo-snapshot", "ut-codex-usage"]) {
    if (!directListText.includes(snippet)) {
      fail(`direct app install ut-list output is missing ${snippet}`);
    }
  }

  const directRepoDoctorText = execFileSync(join(macosDir, "ut-repo-snapshot"), [
    "doctor",
  ], { encoding: "utf8" });
  for (const snippet of ["ut-repo-snapshot doctor", "output_includes_paths: false"]) {
    if (!directRepoDoctorText.includes(snippet)) {
      fail(`direct app install ut-repo-snapshot doctor output is missing ${snippet}`);
    }
  }

  const directRepoDoctorJson = JSON.parse(execFileSync(join(macosDir, "ut-repo-snapshot"), [
    "doctor",
    "--json",
  ], { encoding: "utf8" }));
  if (
    directRepoDoctorJson.tool !== "ut-repo-snapshot" ||
    directRepoDoctorJson.version !== manifest.version ||
    directRepoDoctorJson.output_includes_paths !== false
  ) {
    fail("direct app install ut-repo-snapshot doctor JSON is not valid");
  }

  const directDoctorText = execFileSync(join(macosDir, "ut-codex-usage"), [
    "doctor",
    "--codex-home",
    "/nonexistent/universal-tools-direct-install",
  ], { encoding: "utf8" });
  for (const snippet of ["Codex Usage Doctor", "macOS app bundle", "jsonl_files"]) {
    if (!directDoctorText.includes(snippet)) {
      fail(`direct app install ut-codex-usage doctor output is missing ${snippet}`);
    }
  }

  const directDoctorJson = JSON.parse(execFileSync(join(macosDir, "ut-codex-usage"), [
    "doctor",
    "--json",
    "--codex-home",
    "/nonexistent/universal-tools-direct-install",
  ], { encoding: "utf8" }));
  if (
    directDoctorJson.tool !== "ut-codex-usage" ||
    directDoctorJson.version !== manifest.version ||
    directDoctorJson.install_surface !== "macOS app bundle" ||
    directDoctorJson.codex_home_exists !== false ||
    directDoctorJson.jsonl_files !== 0
  ) {
    fail("direct app install ut-codex-usage doctor JSON is not valid");
  }
};

const verifyDir = mkdtempSync(join(tmpdir(), "ut-artifact-check."));
try {
  execFileSync("ditto", ["-x", "-k", zipPath, verifyDir], { stdio: "pipe" });
  const extractedApp = join(verifyDir, `${manifest.productName}.app`);
  const linkedBinDir = join(verifyDir, "linked-bin");
  mkdirSync(linkedBinDir);

  requireFile(join(extractedApp, "Contents/MacOS/ut-desktop"));
  for (const command of manifest.commands) {
    const commandPath = join(extractedApp, "Contents/MacOS", command.name);
    requireFile(commandPath);
    execFileSync(commandPath, ["--help"], { stdio: "pipe" });

    const linkedPath = join(linkedBinDir, command.name);
    symlinkSync(commandPath, linkedPath);
    const linkedVersion = execFileSync(linkedPath, ["--version"], { encoding: "utf8" }).trim();
    if (linkedVersion !== command.version) {
      fail(`linked ${command.name} version expected ${command.version}, got ${linkedVersion}`);
    }
  }

  verifyDirectInstallCommands(extractedApp);

  const linkedListJson = JSON.parse(execFileSync(join(linkedBinDir, "ut-list"), ["--json"], { encoding: "utf8" }));
  const linkedCommandNames = new Set(linkedListJson.commands?.map((command) => command.name) ?? []);
  for (const command of manifest.commands) {
    if (!linkedCommandNames.has(command.name)) {
      fail(`linked ut-list output is missing ${command.name}`);
    }
  }

  const linkedDoctor = JSON.parse(execFileSync(join(linkedBinDir, "ut-list"), ["doctor", "--json"], { encoding: "utf8" }));
  if (linkedDoctor.status !== "ok" || linkedDoctor.self_listed !== true) {
    fail("linked ut-list doctor did not report a healthy install");
  }

  const mode = manifest.releaseKind === "public" ? "public" : "local";
  execFileSync(join(scriptDir, "check-macos-release.sh"), [mode], {
    env: {
      ...process.env,
      UT_APP_BUNDLE: extractedApp,
    },
    stdio: "pipe",
  });
} finally {
  rmSync(verifyDir, { recursive: true, force: true });
}

ok("release artifacts are internally consistent");
