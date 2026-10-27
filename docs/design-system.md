# Design system and frontend QA

The application shell and shared components use the theme in
`apps/web/src/app/globals.css`. Semantic CSS custom properties provide light and
dark surface, text, border, input, focus-ring, primary, destructive, success,
warning, and informational colors. Typography uses Geist. The same token set
defines radii, content width, sidebar width, and a 44px interactive target.
Reduced-motion preferences are honored by the global motion rules. Do not hide
page overflow globally to mask a layout defect; dense operational tables may
scroll within their own labeled panel.

The component layer uses `panelui-web` exports for cards, inputs, labels,
dialogs, tabs, alerts, and status presentation, plus local LedgerFlow
compositions (`DataPanel`, `PageHeader`, `PageSection`, `MoneyDisplay`, and
state components). The local Button is shadcn-compatible. It was not installed
from a registry because the registry was unavailable in the original setup;
no claim is made that registry-specific acceptance was completed. The
`/design-system` showcase is development-only and is not an application page.

## Accessibility expectations

- Use semantic landmarks, one clear page heading, and visible form labels.
- Keep keyboard focus visible, preserve logical tab order, and restore focus
  after closing transient navigation/dialog UI.
- Associate inline validation with its field and expose failure/status messages
  with alert/status semantics.
- Keep controls operable by keyboard and large enough for touch interaction.
- Keep charts accompanied by readable labels/values and tables by a usable
  narrow-screen representation or contained horizontal scrolling.
- Respect reduced motion and verify foreground/background contrast for both
  themes when changing tokens.

Automated coverage includes Next/ESLint accessibility rules, semantic and form
behavior in component tests, keyboard interaction in the browser verifier, and
visual inspection of captured authentication screens. This is not a formal
WCAG conformance audit: no axe scan, screen-reader certification, or exhaustive
contrast matrix was run in Phase 3I. Recheck contrast with a dedicated tool
before changing color tokens or claiming conformance.

## Browser QA command

Start the web app with `npm run web:dev`, then run:

```bash
SCREENSHOT_DIR=/tmp/ledgerflow-ui npm run verify:ui --workspace @ledgerflow/web
```

Set `WEB_BASE_URL` or `CHROMIUM_PATH` when needed. Screenshots are optional and
should normally remain outside the repository. To exercise authenticated route
smoke checks, supply `LEDGERFLOW_QA_ACCESS_COOKIE` and
`LEDGERFLOW_QA_ROLE` from a dedicated non-production test account; values are
consumed by the local script and are not logged. The cookie expires according
to the API's configured session policy. Do not use a personal or production
session for this command. A customer session previews a `0.01` transfer from
live wallet data, opens and dismisses its confirmation dialog, and asserts that
no transfer request was sent. Staff sessions check role denial, and all roles
check logout followed by protected-route denial. These browser checks are not
a replacement for the database integration suite.

With an authenticated development server, `CHECK_DESIGN_SYSTEM=1` additionally
checks the development-only showcase, confirmation dialog Escape behavior, and
keyboard tabs.
