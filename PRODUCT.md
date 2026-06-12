# Product

## Register

product

## Users

Developer users who want a local, privacy-safe toolbox for small utilities,
scripts, and app-backed workflows. The project starts as a personal tool suite,
but it should be written from the beginning as a public developer product that
other people can understand, install, and trust.

## Product Purpose

Universal Tools gives developers a simple way to run local utilities from the
shell and inspect richer results in a desktop app. It should keep private source
data on the user's machine, make common tasks work with minimal setup, and give
each tool a stable public command with a clear purpose.

## Product Boundary

Universal Tools is the product. Individual tools are modules inside it.
Codex Usage is one ready desktop workspace and should not define the naming,
navigation, release story, or future information architecture for unrelated
tools. Command Index is another ready workspace and shows the installed `ut-*`
command catalog plus install completeness without reading private data.

The long-term direction is a desktop toolbox and command library for many small
developer utilities. Rich report views are a presentation pattern inside that
toolbox, not a Codex Usage wrapper. A future tool can be about repositories,
files, logs, releases, notes, shell workflows, or anything else that fits the
local-first tool model.

The default app surface should answer "what tools are available here?" before
it answers "what does the current tool report?" A tool workspace may be deep
and specific, but the shell, documentation, release notes, and install story
must stay product-level.

## Brand Personality

Restrained, elegant, and invisible: 克制、优雅、无感知. The product should feel
calm, precise, and quietly capable. It should not draw attention to itself when
the user is trying to get work done.

## Anti-references

Avoid decorative SaaS dashboards, loud terminal cosplay, marketing-style hero
pages, dense admin panels, flashy gradients, glassmorphism, privacy-unclear
cloud dashboards, generic AI templates, and control surfaces that expose too
many choices before the default path has worked.

## Design Principles

- Local first, public safe: private data stays local, and committed examples are
  synthetic or fully anonymized.
- Visible safety posture: the desktop app should make local-only behavior,
  no-background-scan behavior, and ignored generated reports visible before a
  user opens a private-data tool.
- Fast path before customization: common tasks should work with no arguments or
  very few choices.
- Tool library first: the desktop app is Universal Tools. Codex Usage is one
  ready desktop workspace, not the product boundary.
- Module independence: future tools should be able to target repositories,
  shell workflows, local reports, or other developer tasks without inheriting
  Codex Usage concepts.
- Presentation independence: a rich dashboard, web-style report, or native
  workspace is just how a tool displays results. It must not narrow the product
  into the current tool's domain.
- Workspace-triggered local access: opening the library should not read a
  specific tool's private source data. A tool reads local data only when its
  workspace is opened or refreshed.
- One tool, two surfaces: keep CLI commands quick and scriptable, while the app
  handles browsing, comparison, and richer presentation.
- Quiet clarity over spectacle: make results easy to scan without turning the
  interface into decoration.
- Agent-maintainable by default: structure, naming, and docs should make future
  changes easy for coding agents to inspect and update.

## Accessibility & Inclusion

Meet at least WCAG AA. Interfaces should have readable contrast, visible focus
states, keyboard-accessible controls, reduced-motion support where motion is
used, and status signals that do not rely on color alone. Dense views should
remain legible and predictable for repeated daily use.
