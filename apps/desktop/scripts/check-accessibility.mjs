#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const rootDir = resolve(appDir, "../..");
const stylesPath = join(appDir, "src/styles.css");
const appPath = join(appDir, "src/App.tsx");
const productPath = join(rootDir, "PRODUCT.md");

const styles = readFileSync(stylesPath, "utf8");
const app = readFileSync(appPath, "utf8");
const product = readFileSync(productPath, "utf8");

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const ok = (message) => {
  console.log(`ok: ${message}`);
};

const expectIncludes = (label, text, expected) => {
  if (!text.includes(expected)) fail(`${label} must include ${JSON.stringify(expected)}`);
};

const cssBlock = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? "";
};

const rgb = (hex) => {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) fail(`invalid color: ${hex}`);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
};

const linear = (channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (foreground, background) => {
  const left = luminance(foreground);
  const right = luminance(background);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
};

const assertContrast = ({ label, foreground, background, minimum = 4.5 }) => {
  const ratio = contrast(foreground, background);
  if (ratio < minimum) {
    fail(`${label} contrast ${ratio.toFixed(2)} is below ${minimum}: ${foreground} on ${background}`);
  }
};

const contrastPairs = [
  { label: "App text", foreground: "#f4f0dd", background: "#070806" },
  { label: "Main text", foreground: "#f4f0dd", background: "#11120f" },
  { label: "Muted text on main", foreground: "#b8b29e", background: "#11120f" },
  { label: "Muted text on rail", foreground: "#b8b29e", background: "#0d0e0b" },
  { label: "Muted text on panel", foreground: "#b8b29e", background: "#181912" },
  { label: "Muted text on status cell", foreground: "#b8b29e", background: "#15160f" },
  { label: "Rail label", foreground: "#847d67", background: "#0d0e0b" },
  { label: "Disabled nav metadata", foreground: "#8f886f", background: "#0d0e0b" },
  { label: "Disabled nav badge", foreground: "#9f9782", background: "#0d0e0b" },
  { label: "Input placeholder", foreground: "#9f9782", background: "#0d0e0b" },
  { label: "Primary button", foreground: "#111008", background: "#f8bd1c" },
  { label: "Primary disabled button", foreground: "#cfc5a8", background: "#3a321c" },
  { label: "Skip link", foreground: "#111008", background: "#f8bd1c" },
  { label: "Secondary button", foreground: "#f8bd1c", background: "#151307" },
  { label: "Warning text", foreground: "#ff9a86", background: "#1d100d" },
  { label: "Selected table row", foreground: "#f8bd1c", background: "#1e1a0d" },
  { label: "Table body", foreground: "#ebe4ca", background: "#181912" },
  { label: "Diagnostic teal", foreground: "#7cc7c1", background: "#181912" },
];

for (const pair of contrastPairs) {
  assertContrast(pair);
}

expectIncludes("Product accessibility rule", product, "Meet at least WCAG AA");
expectIncludes("Skip link markup", app, 'className="skipLink"');
expectIncludes("Skip link target", app, '<main id="mainContent">');
expectIncludes("Focus visible style", styles, "button:focus-visible");
expectIncludes("Anchor focus visible style", styles, "a:focus-visible");
expectIncludes("Reduced motion media query", styles, "@media (prefers-reduced-motion: no-preference)");

const focusBlock = styles.match(/button:focus-visible,[\s\S]*?a:focus-visible\s*\{([\s\S]*?)\}/)?.[1] ?? "";
if (!focusBlock.includes("outline: 3px solid #f8bd1c")) fail("focus-visible must use a 3px amber outline");
if (!focusBlock.includes("outline-offset: 2px")) fail("focus-visible must use outline offset");

const primaryDisabled = cssBlock(".primaryButton:disabled");
if (!primaryDisabled) fail("missing .primaryButton:disabled style");
if (/opacity\s*:/.test(primaryDisabled)) fail(".primaryButton:disabled must not rely on whole-control opacity");
expectIncludes("Primary disabled foreground", primaryDisabled, "color: #cfc5a8");
expectIncludes("Primary disabled background", primaryDisabled, "background: #3a321c");

const disabledNav = cssBlock(".navItem:disabled");
if (!disabledNav) fail("missing .navItem:disabled style");
if (/opacity\s*:/.test(disabledNav)) fail(".navItem:disabled must not rely on whole-control opacity");

const modelRow = cssBlock(".modelRow");
if (!modelRow) fail("missing .modelRow style");
expectIncludes("Model row touch target", modelRow, "min-height: 44px");
expectIncludes("Mobile touch targets", styles, ".primaryButton,\n  .secondaryButton");
expectIncludes("Mobile touch target size", styles, "min-height: 44px");

ok("accessibility checks passed");
