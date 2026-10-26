# Phase 3A frontend foundation

`apps/web` is a Next.js App Router workspace with strict TypeScript, Tailwind CSS 4,
Geist fonts, a shadcn-compatible local Button, and a temporary `/ui-check` route.
It does not authenticate users or call the API. Its `.env.example` has no secrets.
The backend remains a separate workspace; its scripts and runtime configuration
are unchanged.

Run `npm ci` from the repository root, then `npm run web:dev` and visit
<http://localhost:3001/ui-check>. The corresponding production commands are
`npm run web:build` and `npm run web:start`. Run `npm run web:typecheck` and
`npm run web:lint` for static checks.

## Installed structure and versions

The web workspace has `src/app` (App Router routes and Tailwind theme),
`src/components/ui/button.tsx` (local shadcn-style Button), and `src/lib/utils.ts`
(class merging). `components.json` configures `@/*` aliases and the official
`@panelui` web registry URL. The `panelui-web` agent skill and its source lock
are under `.agents/skills/panelui-web` and `skills-lock.json`.

The lockfile currently resolves Next.js 16.4.3, React/React DOM 19.3.1,
Tailwind CSS 4.3.3, Geist 1.8.2, and PanelUI Web 0.9.0. The `/ui-check`
page renders PanelUI Web `Card` and `RollingNumber` from the official npm
package, plus the local Button, a count action, and a light/dark switch.
The npm route is documented by the installed PanelUI Web skill; it requires
Tailwind's `@source` directive for the package classes.

## Registry and MCP limitation

The environment's enforced network policy returns HTTP 403 for
`panelui.dev` and `ui.shadcn.com`. Consequently the official
`shadcn init`, `shadcn add @panelui/rolling-number`, and CLI registry
`search`/`view` commands could not complete. The local Button is
shadcn-compatible but was not installed from the shadcn registry; no
PanelUI source file was copied into `src/components/panelui`. The
registry-specific acceptance checks remain open.

`shadcn mcp init --client codex` reported the Codex configuration needed,
and `codex mcp add shadcn -- npx shadcn@latest mcp` registered it in this
environment's global Codex config. `codex mcp list` reports it enabled.
The already-running agent session cannot reload MCP tools, so a live MCP
registry discovery was not verified. On another development machine, add
the same MCP entry to that machine's Codex configuration and restart Codex.
Access to the PanelUI registry must also be permitted before its tools can
discover components.

## Verification

Web typecheck, lint, and production build passed. The production server
returned HTTP 200 for `/ui-check` and its HTML contained the PanelUI card
and interactive control markup. The first build attempt stalled under a
sandbox without local-network permission; rerunning with that permission
compiled and prerendered `/` and `/ui-check` successfully.
The unchanged backend also passed its typecheck and production build.

`npm audit --omit=dev --workspace @ledgerflow/web --audit-level=high`
reported zero vulnerabilities. The same repository-wide audit reported four
high-severity findings in existing backend dependency paths involving
`body-parser` and `multer`. These require separate backend dependency review;
the audit's forced fix proposes a breaking NestJS downgrade and was not run.

Do not use this route as an application screen. It is temporary installation
verification only; login, dashboard, transfers, and backend integration
belong to later phases.
