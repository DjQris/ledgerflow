# Phase 3B design system and application shell

Phase 3B builds on `apps/web`; it does not connect to `apps/api`. The navigation
and pages are clearly marked UI previews. The customer and operations workspaces
have no sign-in, balance fetch, transaction fetch, retry action, or transfer form.

## Structure

```text
apps/web/src/
  app/(app)/layout.tsx                shared shell layout
  app/(app)/error.tsx                 safe error boundary
  app/(app)/dashboard/ ... settings/  customer placeholder routes
  app/(app)/operations/               operations placeholder routes
  app/(app)/design-system/            development-only showcase
  components/shell/                   sidebar, mobile navigation, top bar, user menu
  components/                         panels, headers, status, money, states, dialog
  lib/route-shells.ts                 route labels and empty-table headings
```

Customer routes are `/dashboard`, `/wallets`, `/transfer`, `/transactions`, and
`/settings`. Operations routes are `/operations`, `/operations/transactions`,
`/operations/users`, `/operations/jobs`, `/operations/audit`, and
`/operations/reconciliation`. `/` redirects to `/dashboard`. The
`/design-system` showcase is available only with `next dev`; production
returns 404. The Phase 3A `/ui-check` remains temporary and separate.

## Tokens and components

`src/app/globals.css` centralizes light/dark neutral surfaces, foreground,
border, input, ring, primary, destructive, info, success, and warning tokens.
It also defines radii, the maximum content width, sidebar width, a 44 px
touch target, Geist typography, and reduced-motion behavior. Keyboard focus
uses the semantic ring token. Tailwind scans PanelUI Web's npm distribution
through `@source`.

The installed `panelui-web@0.9.0` package supplies Frame, Stat, Alert,
AlertDialog, Input, Label, and Tabs in Phase 3B; Card and RollingNumber remain
in the Phase 3A UI check. `DataPanel`, `ErrorState`, and
`ConfirmationDialog` compose those actual exports instead of copying their
source. The local shadcn-style Button remains a substitute because the
shadcn and PanelUI registry hosts are blocked in this environment. A live
MCP registry inspection is still unavailable, so no component is claimed to
have been installed through the registry.

`MoneyDisplay` accepts canonical integer minor-unit strings and formats via
`BigInt`, avoiding floating-point currency conversion. The showcase uses a
clearly labelled sample amount. `npm run web:test:money` checks zero,
negative, very large, and invalid inputs. Real financial responses are
never loaded.

## Verification

From the repository root, run `npm run web:typecheck`, `npm run web:lint`,
`npm run web:test:money`, and `npm run web:build`. With a local Chromium binary and the web server
running, `npm run web:verify:ui` checks the customer dashboard and operations
table at 360, 768, 1024, and 1440 px. Set `CHROMIUM_PATH` if Chromium is not
at `/usr/bin/chromium`; set `WEB_BASE_URL` when not using port 3001. Set
`CHECK_DESIGN_SYSTEM=1` against a development server to check the showcase
dialog and tabs. `SCREENSHOT_DIR` optionally saves viewport screenshots.

The browser checks passed with no page-level horizontal overflow at all four
widths. Mobile navigation opened by keyboard and changed routes; the theme
toggle persisted across reloads with readable light/dark foregrounds; the
confirmation dialog closed with Escape and tabs switched content. The
operations table scrolls within its panel on narrow screens, with a visible
scroll cue. Production HTTP checks returned 200 for all eleven route shells
and 404 for `/design-system`.

This phase stops at the shell. Authorization, real account identity, data
tables, transfers, and operational actions require later phases.
