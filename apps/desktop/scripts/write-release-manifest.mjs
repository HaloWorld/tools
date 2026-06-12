#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const rootDir = resolve(appDir, "../..");
const appBundle = process.env.UT_APP_BUNDLE ?? join(rootDir, "target/release/bundle/macos/Universal Tools.app");
const distDir = process.env.UT_DIST_DIR ?? join(rootDir, "target/release/distribution");
const releaseKind = process.env.UT_RELEASE_KIND ?? "local";

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const requireFile = (path) => {
  if (!existsSync(path)) fail(`missing file: ${path}`);
};

const plistValue = (key) =>
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(appBundle, "Contents/Info.plist")], {
    encoding: "utf8",
  }).trim();

const sha256File = (path) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
};

const version = plistValue("CFBundleShortVersionString");
const bundleIdentifier = plistValue("CFBundleIdentifier");
const productName = plistValue("CFBundleDisplayName");
const executablePath = join(appBundle, "Contents/MacOS/ut-desktop");
requireFile(executablePath);
const readyCommands = [
  {
    name: "ut-list",
    doctorArgs: ["doctor", "--json"],
    doctorOk: (json) => json.tool === "ut-list" && json.version === version && json.status === "ok",
  },
  {
    name: "ut-repo-snapshot",
    doctorArgs: ["doctor", "--json"],
    doctorOk: (json) =>
      json.tool === "ut-repo-snapshot" &&
      json.version === version &&
      json.output_includes_paths === false,
  },
  {
    name: "ut-codex-usage",
    doctorArgs: ["doctor", "--json", "--codex-home", "/nonexistent/universal-tools-doctor"],
    doctorOk: (json) => json.tool === "ut-codex-usage" && json.version === version,
  },
];
for (const command of readyCommands) {
  requireFile(join(appBundle, "Contents/MacOS", command.name));
}

const archs = execFileSync("/usr/bin/lipo", ["-archs", executablePath], { encoding: "utf8" })
  .trim()
  .split(/\s+/)
  .filter(Boolean);
if (archs.length === 0) fail("could not detect app architecture");

const artifactBase = `Universal-Tools-${version}-macos-${archs.join("-")}`;
const zipPath = join(distDir, `${artifactBase}.zip`);
const checksumPath = `${zipPath}.sha256`;
const manifestPath = join(distDir, `${artifactBase}.manifest.json`);
requireFile(zipPath);
requireFile(checksumPath);

const signatureProcess = spawnSync("codesign", ["--display", "--verbose=2", appBundle], {
  encoding: "utf8",
});
if (signatureProcess.status !== 0) fail("could not read app code signature");
const signatureInfo = `${signatureProcess.stdout ?? ""}${signatureProcess.stderr ?? ""}`;
const signature = signatureInfo.includes("Signature=adhoc") ? "adhoc" : "developer-id";
const teamMatch = signatureInfo.match(/^TeamIdentifier=(.+)$/m);
const teamIdentifier = teamMatch ? teamMatch[1] : null;

const zipStat = statSync(zipPath);
const zipSha256 = sha256File(zipPath);
const checksumText = readFileSync(checksumPath, "utf8");
if (!checksumText.includes(zipSha256)) fail("zip checksum file does not match zip content");

const git = (args, fallback = null) => {
  try {
    return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim() || fallback;
  } catch {
    return fallback;
  }
};

const gitStatus = git(["status", "--porcelain"], "");

const normalizeRemote = (remote) => {
  if (!remote) return null;
  const sshMatch = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
  return remote;
};

const commands = readyCommands.map((command) => {
  const executable = join(appBundle, "Contents/MacOS", command.name);
  const commandVersion = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
  const doctor = execFileSync(executable, command.doctorArgs, { encoding: "utf8" });
  const doctorJson = JSON.parse(doctor);

  return {
    name: command.name,
    path: `${productName}.app/Contents/MacOS/${command.name}`,
    version: commandVersion,
    doctor: command.doctorOk(doctorJson),
  };
});

const manifest = {
  schemaVersion: 1,
  productName,
  version,
  bundleIdentifier,
  platform: "macos",
  archs,
  releaseKind,
  signing: {
    signature,
    teamIdentifier,
  },
  source: {
    repository: normalizeRemote(git(["config", "--get", "remote.origin.url"])),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: git(["rev-parse", "HEAD"]),
    shortCommit: git(["rev-parse", "--short=12", "HEAD"]),
    dirty: gitStatus.length > 0,
  },
  commands,
  artifacts: [
    {
      kind: "app-zip",
      file: basename(zipPath),
      sha256: zipSha256,
      sizeBytes: zipStat.size,
    },
    {
      kind: "sha256",
      file: basename(checksumPath),
      sizeBytes: statSync(checksumPath).size,
    },
  ],
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const written = JSON.parse(readFileSync(manifestPath, "utf8"));
if (written.artifacts[0].sha256 !== zipSha256) fail("written manifest checksum mismatch");

console.log(`ok: created ${manifestPath}`);
