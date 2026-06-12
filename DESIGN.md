---
name: Universal Tools
description: A direct black and amber desktop toolbox for local developer utilities.
colors:
  app-bg: "#070806"
  main-bg: "#11120f"
  rail-bg: "#0d0e0b"
  panel-bg: "#181912"
  panel-muted: "#15160f"
  border: "#302a16"
  border-subtle: "#292617"
  text: "#f4f0dd"
  text-strong: "#fff8df"
  muted: "#b8b29e"
  muted-low: "#847d67"
  amber: "#f8bd1c"
  amber-hover: "#ffd257"
  amber-soft: "#1b180d"
  teal: "#7cc7c1"
  error: "#ff9a86"
  error-bg: "#1d100d"
materials:
  surface-base: "#070806"
  surface-glass: "rgba(24, 25, 18, 0.72)"
  surface-glass-strong: "rgba(24, 25, 18, 0.86)"
  glass-border: "rgba(248, 189, 28, 0.22)"
  glass-highlight: "rgba(255, 248, 223, 0.16)"
  glass-blur: "24px"
  glass-edge: "amber and warm-white gradient rim"
  glass-caustic: "restrained amber/teal refracted light field"
  glass-contact-shadow: "short dark contact shadow"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0"
  value:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0"
rounded:
  chart: "7px"
  control: "8px"
  panel: "10px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.app-bg}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "38px"
  input-default:
    backgroundColor: "{colors.rail-bg}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "38px"
  nav-item-active:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "54px"
  panel:
    backgroundColor: "{colors.panel-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "16px"
  metric:
    backgroundColor: "{colors.panel-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

# Design System: Universal Tools

## 1. Overview

**Creative North Star: "The Direct Workbench"**

Universal Tools is a local desktop toolbox first. Codex Usage is one ready tool
inside that toolbox, not the product boundary. The app should open like a
focused Liquid Glass workbench: dark, direct, compact, and ready for repeated
use. The black and amber palette references the Impeccable direction the
maintainer approved, but it is translated into product UI rather than a
marketing page.

The primary direction is the Universal Tools workbench: a place to discover,
open, and trust many small local utilities. Rich report workspaces are reusable
surfaces inside the workbench, not a signal that the product is only a Codex
Usage app.

The outer frame must always signal a tool library. The app opens at Tool
Library without scanning tool-specific private data, then lets the user enter
Codex Usage or any future ready workspace. Navigation, command prefix, tool
counts, and future entries should make it clear that Codex Usage is the
selected utility, not the whole product. Inside the selected tool, the
interface prioritizes quick confirmation: totals, cost, cache behavior,
coverage, model share, and top sessions.

**Key Characteristics:**
- Black Liquid Glass workbench shell with amber primary action and active state.
- Universal Tools owns the app shell, tool library, and command prefix.
- Tool Library is the default entry, not a secondary page.
- Tool-specific local data is read only after entering or refreshing that tool.
- Codex Usage lives as a ready desktop workspace inside that shell.
- Command Index is the second ready desktop workspace and shows the installed
  `ut-*` command catalog plus install completeness without reading private
  data.
- Dense information layout with a wide analysis column and a narrow inspector.
- Direct tabular and bar-based data display. No donut charts.
- Glass surfaces use translucent material, edge highlights, and restrained
  depth. They must still read as tool UI, not decorative glass cards.

## 2. Colors

The palette is black and amber with a restrained secondary teal for comparison
data. Amber is rare and functional: it marks the active tool, primary command,
focus ring, selected row, and the main activity bars.

The material system is tokenized for future dark and light theme switching.
Components should read from semantic surface and glass tokens instead of
hard-coded one-off fills when they represent reusable UI structure.

### Primary
- **Workbench Black**: the app background and rail foundation. It creates the
  direct local-tool atmosphere.
- **Command Amber**: the primary action, active navigation, focus ring, selected
  row signal, and daily activity fill.

### Secondary
- **Diagnostic Teal**: secondary comparison data, especially model-share bars.
  It must never compete with Command Amber.
- **Error Clay**: failed scan, unavailable report, and warning states.

### Neutral
- **Workbench Text**: default text on dark panels.
- **Strong Text**: page title and high-emphasis content.
- **Operational Muted**: secondary body-scale text that still needs readable
  contrast.
- **Low Muted**: section labels and non-critical metadata only.
- **Amber Divider**: the standard 1px divider on panels and segmented surfaces.

### Named Rules
**The Tool Shell Rule.** The rail and breadcrumb must keep Universal Tools
visible even when one tool owns the main workspace.

**The Product Boundary Rule.** Universal Tools owns the default screen,
navigation, install story, and release story. Codex Usage must appear as one
selected module, never as the product identity.

**The Presentation Boundary Rule.** Rich charts, tables, and web-like report
views are display surfaces that any future tool can use. They must never make
Codex Usage look like the product's reason to exist.

**The Tool Library Rule.** The first visible app concept is the Universal Tools
library: ready tools, planned slots, and the `ut-` command prefix.

**The Default Library Rule.** Opening the app without a deep link shows Tool
Library. Ready tools are entered from there.

**The Lazy Local Data Rule.** The default library view does not scan a
tool-specific private source. Data access starts only when a tool workspace is
opened or refreshed.

**The Amber Rarity Rule.** Amber is primary action, active selection, and key
state. Do not use it as decoration.

**The Liquid Glass Rule.** Use glass for app shell, panels, grouped rows,
floating value labels, and controls that benefit from depth. Glass must include
readable foregrounds, stable borders, and clear focus states. Do not turn the
interface into a color sample sheet.

**The Thick Glass Rule.** Liquid Glass surfaces must read as material, not only
as transparent fill. Structural surfaces need a visible rim, inner highlight,
low edge shadow, and short contact shadow. Interactive controls need a pressed
state that feels like the material compressing.

**The Refraction Rule.** Glass needs something restrained behind it to refract.
Use the black and amber light field plus small teal diagnostic refractions. Do
not import the reference image's purple, pink, or blue palette into the product
identity.

**The Theme Token Rule.** New structural colors should map to semantic tokens:
base, main, rail, glass, strong glass, control, border, highlight, accent, text,
muted, and status colors. This keeps the dark theme shippable now and leaves a
clean path to a light theme later.

**The No Donut Rule.** Usage and model data use bars, rows, and tables. Donut
charts are prohibited for this surface.

## 3. Typography

**Display Font:** Inter with system sans fallbacks.
**Body Font:** Inter with system sans fallbacks.
**Label/Mono Font:** No separate label or mono family is defined.

**Character:** The type system is direct and native-feeling. It should feel
closer to a Mac developer utility than an analytics landing page.

### Hierarchy
- **Headline** (700, 32px, 1.1): selected tool title only.
- **Title** (700, 15px, 1.2): panel titles and nav item labels.
- **Body** (400, 14px, 1.45): explanatory text, row labels, metadata, and
  compact UI copy.
- **Label** (700, 12px, 1.2): status labels, field labels, and table headers.
- **Value** (700, 27px, 1): metric values and summary totals.

### Named Rules
**The Direct Label Rule.** Labels name the data or action. Avoid clever copy,
marketing language, or page-level slogans.

**The Tabular Number Rule.** Metrics, tables, percentages, and costs use tabular
numbers so rows remain easy to scan.

## 4. Elevation

The system is flat by default. Depth comes from dark tonal layers, 1px amber
dividers, glass material, and spatial grouping. Ordinary panels may use
restrained glass depth when it clarifies layer order.

### Named Rules
**The Glass Workbench Rule.** Panels, metrics, tables, and grouped rows sit on
translucent glass surfaces with controlled blur, edge light, and short shadows.
Depth should separate layers, not decorate them.

**The Divider Grid Rule.** Segmented metric bands and status strips use 1px
dividers rather than separate floating cards.

## 5. Components

### Buttons
- **Shape:** compact rounded controls (8px radius).
- **Primary:** Command Amber background, Workbench Black text, 38px height,
  icon plus verb-object label.
- **Hover / Focus:** hover brightens to Amber Hover. Keyboard focus uses a 3px
  amber ring with offset.
- **Touch:** compact desktop controls may stay 38px tall, but mobile and narrow
  viewport controls use at least 44px touch targets.
- **Disabled:** no pointer cursor, muted tonal text, readable label. Do not rely
  on whole-control opacity for disabled text.

### Chips
- **Style:** no chip system is required yet.
- **State:** if added later, chips should use flat amber outlines or tonal fills,
  not colored side stripes.

### Cards / Containers
- **Corner Style:** compact panels (10px radius).
- **Background:** translucent glass on a dark workbench field.
- **Shadow Strategy:** restrained glass depth only, with short blur and inset
  highlights. Avoid wide generic drop shadows.
- **Border:** 1px glass rim, usually amber-tinted with warm-white and restrained
  teal refraction at the edge.
- **Internal Padding:** 16px for panels and metrics.

### Inputs / Fields
- **Style:** Rail Black field, 1px divider, 8px radius, 38px height.
- **Focus:** amber focus ring plus stable border. Placeholder text must pass AA.
- **Error / Disabled:** errors use Error Clay text on Error Ground. Disabled
  fields preserve readable text.

### Navigation
- **Style:** Universal Tools rail, 282px wide on desktop.
- **Default:** muted text on a translucent glass rail.
- **Active:** amber glass fill with Command Amber text.
- **Disabled:** muted tonal text and no hover promise. Planned entries remain
  readable because they explain the suite model.
- **Library Summary:** compact ready/planned tool count plus the `ut-` prefix.
- **Future Tools:** disabled entries remain visible to signal the suite model.

### Data Surfaces
- **Status Strip:** segmented cells directly under the header, including the
  current library count and selected-tool scan state.
- **Tool Library Workspace:** a compact inventory of ready and planned tools
  with command names, surfaces, and a direct open action for ready tools.
- **Tool Areas:** a compact product-level map of current and future utility
  domains, such as agent telemetry, project hygiene, shell utilities, report
  browsing, and local diagnostics. The displayed area count must come from the
  same source as the tool catalog.
- **Workspace Route:** each ready tool owns its workspace route. The library
  opens the route declared by that tool, not a hard-coded first-tool action.
- **Release Profile:** a compact app identity panel with product name, version,
  bundle identifier, surface, command prefix, and local-data posture.
- **Local Safety:** a compact first-screen panel that states no background
  scans, tool data access only after open/refresh, synthetic preview data, and
  ignored generated reports.
- **Metric Band:** compact segmented summary values, not isolated hero cards.
- **Daily Activity:** vertical amber bars with short date labels.
- **Model Share:** rows with teal horizontal bars. No donut charts.
- **Top Sessions:** dense table with selected top row, tabular numbers, and
  predictable truncation.
- **Inspector:** narrow diagnostic column for coverage, cache, health, and
  warnings.

## 6. Motion

Motion is state feedback, not decoration. Universal Tools should feel alive
because the interface acknowledges user action and data changes, not because it
performs.

### Motion Rules
- **Timing:** most motion runs between 120ms and 240ms. Loading loops may run
  longer, but they must stay visually quiet. Glass entry and inspection
  transitions may use 340ms to 520ms when the motion clarifies layer change.
- **Workspace Entry:** Tool Library and individual workspaces may use a short
  fade plus 8-10px upward settle, slight scale, and a brief blur release when
  they appear.
- **First Open:** the default Tool Library can use a brief stagger across tool
  areas and tool rows to signal readiness. The content must remain readable
  throughout the motion.
- **Refresh:** refresh buttons rotate only while loading. The scan badge may
  pulse subtly while work is in progress.
- **Inspect-on-Hover:** hover and keyboard focus should reveal useful detail
  where the user is inspecting something: tool rows reveal route and data-access
  facts, activity bars reveal token and cost values, and model rows reveal exact
  token counts.
- **Focus Object:** the hovered or focused object may enlarge slightly, deepen
  its border, or expose a detail tray. Neighboring chart or list items may dim
  so comparison stays clear.
- **Glass Response:** hover and focus can increase edge light, backdrop
  saturation, and short shadow. Buttons may show a one-shot sheen. Do not run
  continuous decorative glass animation.
- **Material Press:** primary and secondary controls compress slightly on active
  press. The pressed state uses a lower shadow and stronger inner lowlight, not
  only a color change.
- **Charts:** activity bars grow from the baseline once, and model-share bars
  fill from the left once. Hover or focus reveals precise values and makes the
  selected bar or share track feel physically closer.
- **Chart Details:** chart value overlays must stay inside the visible report
  panel, including the first and last data point.
- **Pointer Feedback:** buttons may lift by 1px. Data rows and chart items must
  do more than brighten when they are inspectable: reveal context, emphasize the
  selected object, or make neighboring values easier to compare.
- **Local Layout Change:** routine hover states should avoid layout shift, but
  explicit inspection trays may expand inside their own row when the extra
  information is the point of the interaction.
- **Reduced Motion:** `prefers-reduced-motion: reduce` disables movement,
  rotation, and repeated loops while preserving state changes.

### Motion Don'ts
- **Don't** add splash screens, onboarding animation, confetti, bounce, elastic
  easing, parallax, or scroll-triggered choreography.
- **Don't** copy bright Liquid Glass demo colors into the product. Keep black
  and amber as the identity.
- **Don't** treat a color change alone as a finished interaction when a user is
  inspecting data.
- **Don't** animate width, height, top, left, margins, or other layout-driving
  properties for routine state changes. Use local inspection trays only when
  the reveal is the interaction.
- **Don't** make users wait for animation before interacting.

## 7. Do's and Don'ts

### Do:
- **Do** keep Universal Tools visible as the app shell.
- **Do** make the tool library visible before the selected tool's report.
- **Do** open the app at Tool Library unless a specific workspace is deep
  linked.
- **Do** defer private local scans until the selected tool workspace needs
  them.
- **Do** make Codex Usage feel like the selected tool, not the whole product.
- **Do** add new ready tools by declaring their command, surface, and workspace
  route together.
- **Do** treat rich report layouts as reusable workspace patterns for any tool,
  not as Codex Usage branding.
- **Do** keep every tool catalog category represented in the Tool Areas map.
- **Do** expose app identity in Universal Tools terms: version, bundle ID,
  command prefix, and library counts.
- **Do** use Command Amber for primary action, active state, focus, and selected
  data only.
- **Do** keep usage displays direct: bars, rows, tables, and clear status text.
- **Do** preserve readable contrast for all small text.
- **Do** keep planned and disabled entries readable instead of fading the entire
  control.

### Don't:
- **Don't** create a marketing page.
- **Don't** make Codex Usage look like the only future purpose of the app.
- **Don't** describe future strategy as starting from Codex Usage.
- **Don't** name product-level concepts after the current tool.
- **Don't** use donut charts on this surface.
- **Don't** use decorative SaaS dashboards.
- **Don't** use loud terminal cosplay.
- **Don't** use flashy gradients.
- **Don't** use glassmorphism.
- **Don't** create privacy-unclear cloud dashboard language or visuals.
- **Don't** use generic AI templates.
- **Don't** expose too many choices before the default path has worked.
- **Don't** add colored side-stripe borders, gradient text, nested cards, or
  wide decorative shadows.
