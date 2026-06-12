#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const rootDir = resolve(appDir, "../..");
const appBundle = process.env.UT_APP_BUNDLE ?? join(rootDir, "target/release/bundle/macos/Universal Tools.app");
const ciWorkflowPath = join(rootDir, ".github/workflows/ci.yml");
const rootInstallPath = join(rootDir, "install");
const embedCliScriptPath = join(appDir, "scripts/embed-cli-tools.sh");
const checkWorkspacesScriptPath = join(appDir, "scripts/check-workspaces.mjs");
const installLocalScriptPath = join(appDir, "scripts/install-local-app.sh");
const checkLocalInstallScriptPath = join(appDir, "scripts/check-local-install.sh");
const publicReleaseScriptPath = join(appDir, "scripts/release-macos-public.sh");
const checkMacosReleaseScriptPath = join(appDir, "scripts/check-macos-release.sh");
const writeManifestScriptPath = join(appDir, "scripts/write-release-manifest.mjs");
const writeCaskScriptPath = join(appDir, "scripts/write-homebrew-cask.mjs");
const writeNotesScriptPath = join(appDir, "scripts/write-release-notes.mjs");
const checkArtifactsScriptPath = join(appDir, "scripts/check-release-artifacts.mjs");
const utListLibPath = join(rootDir, "crates/ut-list/src/lib.rs");
const toolRegistryPath = join(appDir, "src/toolRegistry.ts");
const iconDir = join(appDir, "src-tauri/icons");
const binDir = join(rootDir, "bin");
const toolsDir = join(rootDir, "tools");

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const ok = (message) => {
  console.log(`ok: ${message}`);
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const expectIncludes = (label, text, expected) => {
  if (!text.includes(expected)) {
    fail(`${label} must include ${expected}`);
  }
};

const expectInOrder = (label, text, snippets) => {
  let position = -1;
  for (const snippet of snippets) {
    const nextPosition = text.indexOf(snippet, position + 1);
    if (nextPosition === -1) {
      fail(`${label} must include ${snippet} after the previous release step`);
    }
    position = nextPosition;
  }
};

const readPackageToml = (path) => {
  const text = readFileSync(path, "utf8");
  const fields = {};
  let inPackage = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "[package]") {
      inPackage = true;
      continue;
    }
    if (inPackage && line.startsWith("[")) break;
    if (!inPackage) continue;

    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
    if (match) fields[match[1]] = match[2];
  }

  const field = (name) => {
    if (!fields[name]) fail(`missing package ${name} in ${path}`);
    return fields[name];
  };
  return {
    name: field("name"),
    version: field("version"),
  };
};

const plistValue = (key) =>
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(appBundle, "Contents/Info.plist")], {
    encoding: "utf8",
  }).trim();

const expect = (label, actual, expected) => {
  if (actual !== expected) {
    fail(`${label} expected '${expected}', got '${actual}'`);
  }
};

const expectTruthy = (label, value) => {
  if (!value) fail(`${label} is required`);
};

const requireNonEmptyFile = (label, path) => {
  if (!existsSync(path)) fail(`${label} is missing: ${path}`);
  const size = statSync(path).size;
  if (size <= 0) fail(`${label} is empty: ${path}`);
  return size;
};

const sortedUnique = (values) => [...new Set(values)].sort();

const expectSameSet = (label, actual, expected) => {
  const actualSorted = sortedUnique(actual);
  const expectedSorted = sortedUnique(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${label} expected ${expectedSorted.join(", ")}, got ${actualSorted.join(", ")}`);
  }
};

const readyCommandsFromToolRegistry = (text) => {
  const commands = [];
  const blocks = text.match(/\{[\s\S]*?\n  \}/g) ?? [];
  for (const block of blocks) {
    const command = block.match(/command:\s*"(ut-[^"]+)"/)?.[1];
    const state = block.match(/state:\s*"([^"]+)"/)?.[1];
    if (command && state === "Ready") commands.push(command);
  }
  return commands;
};

const commandNamesFromToolToml = () => {
  const commands = [];
  for (const toolName of readdirSync(toolsDir).sort()) {
    const toolTomlPath = join(toolsDir, toolName, "tool.toml");
    if (!existsSync(toolTomlPath)) continue;
    const command = readFileSync(toolTomlPath, "utf8").match(/^command\s*=\s*"(ut-[^"]+)"/m)?.[1];
    if (command) commands.push(command);
  }
  return commands;
};

const executableBinCommands = () =>
  readdirSync(binDir)
    .filter((name) => /^ut-[^.]+$/.test(name))
    .filter((name) => (statSync(join(binDir, name)).mode & 0o111) !== 0);

const commandNamesFromUtListCatalog = (text) => {
  const catalogBody = text.match(/fn known_catalog\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  return [...catalogBody.matchAll(/"(?<command>ut-[^"]+)"/g)].map((match) => match.groups.command);
};

const requireCommand = (command) => {
  try {
    execFileSync("/bin/sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
  } catch {
    fail(`required command not found: ${command}`);
  }
};

const imageDimensions = (path) => {
  const output = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path], {
    encoding: "utf8",
  });
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    fail(`could not read image dimensions: ${path}`);
  }
  return { width, height };
};

const fileDescription = (path) => execFileSync("file", ["-b", path], { encoding: "utf8" }).trim();

for (const command of ["ditto", "file", "ruby", "shasum", "sips", "zipinfo"]) {
  requireCommand(command);
}

const packageJson = readJson(join(appDir, "package.json"));
const packageLock = readJson(join(appDir, "package-lock.json"));
const packageLockText = readFileSync(join(appDir, "package-lock.json"), "utf8");
const tauriConfig = readJson(join(appDir, "src-tauri/tauri.conf.json"));
const tauriCapability = readJson(join(appDir, "src-tauri/capabilities/default.json"));
const tauriCargo = readPackageToml(join(appDir, "src-tauri/Cargo.toml"));
const codexUsageCargo = readPackageToml(join(rootDir, "crates/ut-codex-usage/Cargo.toml"));
const commandIndexCargo = readPackageToml(join(rootDir, "crates/ut-list/Cargo.toml"));
const repoSnapshotCargo = readPackageToml(join(rootDir, "crates/ut-repo-snapshot/Cargo.toml"));
const ciWorkflow = readFileSync(ciWorkflowPath, "utf8");
const rootInstall = readFileSync(rootInstallPath, "utf8");
const rootReadme = readFileSync(join(rootDir, "README.md"), "utf8");
const desktopReadme = readFileSync(join(appDir, "README.md"), "utf8");
const releaseReadme = readFileSync(join(appDir, "RELEASE.md"), "utf8");
const toolRegistry = readFileSync(toolRegistryPath, "utf8");
const utListLib = readFileSync(utListLibPath, "utf8");
const checkMacosReleaseScript = readFileSync(checkMacosReleaseScriptPath, "utf8");
const writeManifestScript = readFileSync(writeManifestScriptPath, "utf8");
const writeCaskScript = readFileSync(writeCaskScriptPath, "utf8");
const writeNotesScript = readFileSync(writeNotesScriptPath, "utf8");
const checkArtifactsScript = readFileSync(checkArtifactsScriptPath, "utf8");
const checkWorkspacesScript = readFileSync(checkWorkspacesScriptPath, "utf8");

expect("package name", packageJson.name, "ut-desktop");
expect("package-lock name", packageLock.name, packageJson.name);
expect("package-lock version", packageLock.version, packageJson.version);
expect("package-lock root name", packageLock.packages[""].name, packageJson.name);
expect("package-lock root version", packageLock.packages[""].version, packageJson.version);
if (packageLockText.includes("registry.npmmirror.com")) {
  fail("package-lock must not depend on a local registry mirror");
}
expectIncludes("package-lock registry", packageLockText, "registry.npmjs.org");
expect("embed CLI script", packageJson.scripts["embed:cli"], "scripts/embed-cli-tools.sh");
expect("workspace check script", packageJson.scripts["check:workspaces"], "node scripts/check-workspaces.mjs");
expect("local install script", packageJson.scripts["install:local"], "scripts/install-local-app.sh");
expect("local install check script", packageJson.scripts["check:install"], "scripts/check-local-install.sh");
expectIncludes("local release script", packageJson.scripts["release:local"], "npm run embed:cli");
expectIncludes("public release script", packageJson.scripts["release:public"], "npm run embed:cli");
expect("Rust test script", packageJson.scripts["check:rust"], "cd ../.. && cargo test --workspace");
expectInOrder("local release script", packageJson.scripts["release:local"], [
  "npm run check:rust",
  "npm run build:app",
  "npm run check:ui",
  "UT_REQUIRE_DIST=1 npm run check:workspaces",
  "npm run check:a11y",
  "npm run check:cli",
  "npm run embed:cli",
  "npm run sign:app",
  "npm run verify:app",
  "npm run check:app",
  "npm run check:metadata",
  "npm run package:app",
  "npm run package:cask",
  "npm run package:notes",
  "npm run check:artifacts",
  "npm run check:install",
  "npm run check:privacy",
]);
expectInOrder("public release script", packageJson.scripts["release:public"], [
  "npm run check:public-prereqs",
  "npm run check:rust",
  "npm run build:app",
  "npm run check:ui",
  "UT_REQUIRE_DIST=1 npm run check:workspaces",
  "npm run check:a11y",
  "npm run check:cli",
  "npm run embed:cli",
  "npm run check:metadata",
  "scripts/release-macos-public.sh",
]);
expect("accessibility script", packageJson.scripts["check:a11y"], "node scripts/check-accessibility.mjs");
expectIncludes("local release script", packageJson.scripts["release:local"], "npm run check:rust");
expectIncludes("public release script", packageJson.scripts["release:public"], "npm run check:rust");
expectIncludes("local release script", packageJson.scripts["release:local"], "npm run check:a11y");
expectIncludes("public release script", packageJson.scripts["release:public"], "npm run check:a11y");
expectIncludes("local release script", packageJson.scripts["release:local"], "npm run check:install");
expectIncludes("local release script", packageJson.scripts["release:local"], "UT_REQUIRE_DIST=1 npm run check:workspaces");
expectIncludes("public release script", packageJson.scripts["release:public"], "UT_REQUIRE_DIST=1 npm run check:workspaces");
if (!existsSync(checkWorkspacesScriptPath)) fail("missing workspace check script");
if ((statSync(checkWorkspacesScriptPath).mode & 0o111) === 0) fail("workspace check script must be executable");
expectIncludes("workspace check script", checkWorkspacesScript, "Command Index");
expectIncludes("workspace check script", checkWorkspacesScript, "Repo Snapshot");
expectIncludes("workspace check script", checkWorkspacesScript, "Codex Usage");
expectIncludes("workspace check script", checkWorkspacesScript, "UT_REQUIRE_DIST");
if (!existsSync(installLocalScriptPath)) fail("missing local install script");
if ((statSync(installLocalScriptPath).mode & 0o111) === 0) fail("local install script must be executable");
const installLocalScript = readFileSync(installLocalScriptPath, "utf8");
expectIncludes("local install script", installLocalScript, '${HOME}/Applications');
expectIncludes("local install script", installLocalScript, "UT_LOCAL_INSTALL_DIR");
expectIncludes("local install script", installLocalScript, "UT_LINK_CLI");
expectIncludes("local install script", installLocalScript, "check-macos-release.sh");
if (!existsSync(checkLocalInstallScriptPath)) fail("missing local install check script");
if ((statSync(checkLocalInstallScriptPath).mode & 0o111) === 0) fail("local install check script must be executable");
const checkLocalInstallScript = readFileSync(checkLocalInstallScriptPath, "utf8");
expectIncludes("local install check script", checkLocalInstallScript, "UT_LOCAL_INSTALL_DIR");
expectIncludes("local install check script", checkLocalInstallScript, "UT_LINK_CLI=1");
expectIncludes("local install check script", checkLocalInstallScript, "ut-list");
expectIncludes("local install check script", checkLocalInstallScript, "ut-repo-snapshot");
expectIncludes("local install check script", checkLocalInstallScript, "ut-codex-usage");
if (!existsSync(embedCliScriptPath)) fail("missing embed CLI script");
if ((statSync(embedCliScriptPath).mode & 0o111) === 0) fail("embed CLI script must be executable");
const embedCliScript = readFileSync(embedCliScriptPath, "utf8");
expectIncludes("embed CLI script", embedCliScript, 'embed_tool "ut-codex-usage" "ut-codex-usage"');
expectIncludes("embed CLI script", embedCliScript, 'embed_tool "ut-list" "ut-list"');
expectIncludes("embed CLI script", embedCliScript, 'embed_tool "ut-repo-snapshot" "ut-repo-snapshot"');
expectIncludes("macOS release check", checkMacosReleaseScript, "DIST_INDEX");
expectIncludes("macOS release check", checkMacosReleaseScript, "desktop dist index is missing frontend asset links");
expectIncludes("macOS release check", checkMacosReleaseScript, "require_embedded_string");
expectIncludes("macOS release check", checkMacosReleaseScript, "codex_usage_report");
expectIncludes("macOS release check", checkMacosReleaseScript, "require_dist_string");
expectIncludes("macOS release check", checkMacosReleaseScript, "#repo-snapshot");
expectIncludes("macOS release check", checkMacosReleaseScript, "repo_snapshot_report");
if (!existsSync(publicReleaseScriptPath)) fail("missing public release script");
if ((statSync(publicReleaseScriptPath).mode & 0o111) === 0) fail("public release script must be executable");
const publicReleaseScript = readFileSync(publicReleaseScriptPath, "utf8");
expectIncludes("public release script", publicReleaseScript, 'require_file "${APP_BUNDLE}/Contents/MacOS/ut-codex-usage"');
expectIncludes("public release script", publicReleaseScript, 'require_file "${APP_BUNDLE}/Contents/MacOS/ut-list"');
expectIncludes("public release script", publicReleaseScript, 'require_file "${APP_BUNDLE}/Contents/MacOS/ut-repo-snapshot"');
expectInOrder("public release script body", publicReleaseScript, [
  '"${SCRIPT_DIR}/check-public-release-prereqs.sh"',
  'require_file "${APP_BUNDLE}/Contents/MacOS/ut-list"',
  'require_file "${APP_BUNDLE}/Contents/MacOS/ut-repo-snapshot"',
  'require_file "${APP_BUNDLE}/Contents/MacOS/ut-codex-usage"',
  'codesign --force --deep --options runtime --timestamp --sign',
  'codesign --verify --deep --strict --verbose=2',
  'UT_RELEASE_KIND=public "${SCRIPT_DIR}/package-macos-release.sh" >/dev/null',
  'xcrun notarytool submit',
  'xcrun stapler staple',
  'xcrun stapler validate',
  '"${SCRIPT_DIR}/check-macos-release.sh" public',
  'UT_RELEASE_KIND=public "${SCRIPT_DIR}/package-macos-release.sh"',
  '"${SCRIPT_DIR}/write-homebrew-cask.mjs"',
  '"${SCRIPT_DIR}/write-release-notes.mjs"',
  '"${SCRIPT_DIR}/check-release-artifacts.mjs"',
  '"${ROOT_DIR}/scripts/privacy-scan.sh"',
]);
const publicPrereqsScript = readFileSync(join(appDir, "scripts/check-public-release-prereqs.sh"), "utf8");
expectIncludes("public release prerequisites", publicPrereqsScript, "public release requires a clean git worktree");
expectIncludes("public release prerequisites", publicPrereqsScript, "public release requires no staged but uncommitted changes");
expectIncludes("public release prerequisites", publicPrereqsScript, "public release requires no untracked files");
expectIncludes("public release prerequisites", publicPrereqsScript, "normalize_github_remote");
expectIncludes("public release prerequisites", publicPrereqsScript, "expected_release_base_url");
expectIncludes("public release prerequisites", publicPrereqsScript, "public release requires git tag");
expectIncludes("public release prerequisites", publicPrereqsScript, "must point to HEAD");
const cleanWorktreeCheckPosition = publicPrereqsScript.indexOf("public release requires a clean git worktree");
const signingEnvCheckPosition = publicPrereqsScript.indexOf("set UT_DEVELOPER_ID_APPLICATION");
if (cleanWorktreeCheckPosition === -1 || signingEnvCheckPosition === -1 || cleanWorktreeCheckPosition > signingEnvCheckPosition) {
  fail("public release must check for a clean worktree before signing credentials");
}
const releaseUrlCheckPosition = publicPrereqsScript.indexOf("expected_release_base_url");
const tagCheckPosition = publicPrereqsScript.indexOf("public release requires git tag");
if (
  releaseUrlCheckPosition === -1 ||
  tagCheckPosition === -1 ||
  signingEnvCheckPosition === -1 ||
  releaseUrlCheckPosition > signingEnvCheckPosition ||
  tagCheckPosition > signingEnvCheckPosition
) {
  fail("public release must check release URL and git tag before signing credentials");
}

const readyCommands = readyCommandsFromToolRegistry(toolRegistry);
expectSameSet("ready commands in bin", executableBinCommands(), readyCommands);
expectSameSet("ready commands in tool metadata", commandNamesFromToolToml(), readyCommands);
expectSameSet(
  "ready commands in ut-list catalog",
  commandNamesFromUtListCatalog(utListLib),
  readyCommands,
);
expectSameSet(
  "ready commands in embed script",
  [...embedCliScript.matchAll(/embed_tool\s+"[^"]+"\s+"(?<command>ut-[^"]+)"/g)].map((match) => match.groups.command),
  readyCommands,
);
expectSameSet(
  "ready commands in release manifest script",
  [...writeManifestScript.matchAll(/name:\s+"(?<command>ut-[^"]+)"/g)].map((match) => match.groups.command),
  readyCommands,
);

expect("Tauri productName", tauriConfig.productName, "Universal Tools");
expect("Tauri identifier", tauriConfig.identifier, "com.haloworld.universaltools");
expect("Tauri version", tauriConfig.version, packageJson.version);
expect("Tauri window title", tauriConfig.app.windows[0].title, "Universal Tools");
expect("Tauri bundle category", tauriConfig.bundle.category, "DeveloperTool");
expect("Tauri bundle active", String(tauriConfig.bundle.active), "true");
if (!tauriConfig.bundle.targets.includes("app")) fail("Tauri bundle targets must include app");
expectSameSet("Tauri bundle icons", tauriConfig.bundle.icon ?? [], [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.png",
  "icons/icon.icns",
  "icons/icon.ico",
]);

for (const [name, expected] of [
  ["32x32.png", { width: 32, height: 32 }],
  ["128x128.png", { width: 128, height: 128 }],
  ["128x128@2x.png", { width: 256, height: 256 }],
  ["icon.png", { width: 512, height: 512 }],
]) {
  const iconPath = join(iconDir, name);
  requireNonEmptyFile(`source icon ${name}`, iconPath);
  const actual = imageDimensions(iconPath);
  expect(`source icon ${name} width`, String(actual.width), String(expected.width));
  expect(`source icon ${name} height`, String(actual.height), String(expected.height));
}

const icnsSize = requireNonEmptyFile("source icon icon.icns", join(iconDir, "icon.icns"));
if (icnsSize < 50_000) fail("source icon.icns is unexpectedly small");
expectIncludes("source icon.icns type", fileDescription(join(iconDir, "icon.icns")), "Mac OS X icon");
expectIncludes("source icon.ico type", fileDescription(join(iconDir, "icon.ico")), "MS Windows icon");
const sourceSvg = readFileSync(join(iconDir, "icon.svg"), "utf8");
expectIncludes("source icon.svg", sourceSvg, "#f8bd1c");
expectIncludes("source icon.svg", sourceSvg, "#070806");

const csp = tauriConfig.app.security?.csp;
expectTruthy("Tauri CSP", csp);
if (csp.includes("unsafe-eval")) fail("Tauri CSP must not allow unsafe-eval");
if (!csp.includes("default-src 'self'")) fail("Tauri CSP must define default-src 'self'");

expect("Tauri capability identifier", tauriCapability.identifier, "default");
if (JSON.stringify(tauriCapability.windows) !== JSON.stringify(["main"])) {
  fail("Tauri capability must only target the main window");
}
if (JSON.stringify(tauriCapability.permissions) !== JSON.stringify(["core:default"])) {
  fail("Tauri capability permissions must stay limited to core:default");
}
for (const permission of tauriCapability.permissions) {
  if (/^(fs|shell|http|process|window|webview):/.test(permission)) {
    fail(`Tauri capability includes broad permission: ${permission}`);
  }
}

expect("Tauri Cargo package name", tauriCargo.name, packageJson.name);
expect("Tauri Cargo package version", tauriCargo.version, packageJson.version);
expect("Codex Usage Cargo package name", codexUsageCargo.name, "ut-codex-usage");
expect("Codex Usage Cargo package version", codexUsageCargo.version, packageJson.version);
expect("Command Index Cargo package name", commandIndexCargo.name, "ut-list");
expect("Command Index Cargo package version", commandIndexCargo.version, packageJson.version);
expect("Repo Snapshot Cargo package name", repoSnapshotCargo.name, "ut-repo-snapshot");
expect("Repo Snapshot Cargo package version", repoSnapshotCargo.version, packageJson.version);
expectIncludes("Vite version define", readFileSync(join(appDir, "vite.config.ts"), "utf8"), "__APP_VERSION__");
expectIncludes("Vite product define", readFileSync(join(appDir, "vite.config.ts"), "utf8"), "__APP_PRODUCT_NAME__");
expectIncludes("App uses injected version", readFileSync(join(appDir, "src/App.tsx"), "utf8"), "version: __APP_VERSION__");
expectIncludes("Homebrew Cask manifest selection", writeCaskScript, "packageJson.version");
expectIncludes("release notes manifest selection", writeNotesScript, "packageJson.version");
expectIncludes("release artifact manifest selection", checkArtifactsScript, "packageJson.version");
expectIncludes("Homebrew Cask manifest filter", writeCaskScript, "startsWith(`Universal-Tools-${packageJson.version}-macos-`)");
expectIncludes("release notes manifest filter", writeNotesScript, "startsWith(`Universal-Tools-${packageJson.version}-macos-`)");
expectIncludes("release artifact manifest filter", checkArtifactsScript, "startsWith(`Universal-Tools-${packageJson.version}-macos-`)");
expectIncludes("release artifact direct app command check", checkArtifactsScript, "verifyDirectInstallCommands");
expectIncludes("release artifact direct ut-list check", checkArtifactsScript, "direct app install ut-list");
expectIncludes("release artifact direct repo snapshot check", checkArtifactsScript, "direct app install ut-repo-snapshot doctor");
expectIncludes("release artifact direct doctor check", checkArtifactsScript, "direct app install ut-codex-usage doctor");
expectIncludes("release artifact local install notes check", checkArtifactsScript, "./install");
expectIncludes("release notes local install command", writeNotesScript, "./install");
expectIncludes("release notes local install location", writeNotesScript, "~/Applications");
expectIncludes("root install local release", rootInstall, "npm run release:local");
expectIncludes("root install app install", rootInstall, "npm run install:local");
expectIncludes("root install dependency setup", rootInstall, "npm ci");
expectIncludes("root install default app path", rootInstall, "Universal Tools.app");

for (const [label, text] of [
  ["root README", rootReadme],
  ["desktop README", desktopReadme],
  ["release checklist", releaseReadme],
]) {
  expectIncludes(label, text, `/releases/download/v${packageJson.version}`);
}
expectIncludes("release checklist direct install smoke check", releaseReadme, "direct app install command smoke check");
expectIncludes("root README local install", rootReadme, "./install");
expectIncludes("root README local install default", rootReadme, "~/Applications");
expectIncludes("desktop README local install", desktopReadme, "./install");
expectIncludes("desktop README local install default", desktopReadme, "~/Applications/Universal Tools.app");
expectIncludes("release checklist local install", releaseReadme, "## Local Install");
expectIncludes("release checklist local install command", releaseReadme, "./install");
expectIncludes("release checklist local install simulation", releaseReadme, "npm run check:install");
expectIncludes("release checklist workspace check", releaseReadme, "workspace contract check for Command Index, Repo Snapshot, and Codex Usage");

for (const [label, text] of [
  ["root README", rootReadme],
  ["desktop README", desktopReadme],
  ["release checklist", releaseReadme],
  ["release notes generator", writeNotesScript],
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

if (existsSync(appBundle)) {
  expect("App bundle display name", plistValue("CFBundleDisplayName"), "Universal Tools");
  expect("App bundle name", plistValue("CFBundleName"), "Universal Tools");
  expect("App bundle identifier", plistValue("CFBundleIdentifier"), tauriConfig.identifier);
  expect("App bundle short version", plistValue("CFBundleShortVersionString"), packageJson.version);
  expect("App bundle version", plistValue("CFBundleVersion"), packageJson.version);
  expect("App bundle executable", plistValue("CFBundleExecutable"), "ut-desktop");
  const bundledIconPath = join(appBundle, "Contents/Resources/icon.icns");
  const bundledIconSize = requireNonEmptyFile("bundled app icon", bundledIconPath);
  if (bundledIconSize < 50_000) fail("bundled app icon is unexpectedly small");
  expectIncludes("bundled app icon type", fileDescription(bundledIconPath), "Mac OS X icon");
}

expectIncludes("CI workflow", ciWorkflow, "runs-on: macos-latest");
expectIncludes("CI workflow", ciWorkflow, "npm ci");
expectIncludes("CI workflow", ciWorkflow, "npm run check:rust");
expectIncludes("CI workflow", ciWorkflow, "npm run release:local");
expectIncludes("CI workflow", ciWorkflow, "actions/upload-artifact@v4");
if (ciWorkflow.includes("release:public")) fail("CI workflow must not run public release");
if (ciWorkflow.includes("UT_DEVELOPER_ID_APPLICATION")) fail("CI workflow must not require signing secrets");
if (ciWorkflow.includes("UT_NOTARYTOOL_PROFILE")) fail("CI workflow must not require notarytool secrets");

ok("release metadata is consistent");
