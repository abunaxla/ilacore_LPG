# apps/web — Next.js web app

Role-based screens and dashboards for every user type: owner (distributor), finance,
depot, driver, field supervisor, investigations, wholesaler and retailer.

Not scaffolded yet. Phase 1 will run `create-next-app` here with Tailwind and shadcn/ui (Radix).

Rules that apply here:
- WCAG 2.2 AA: large touch targets, high contrast that stays readable in sunlight,
  full keyboard and screen-reader support, and status never shown by colour alone.
- All UI strings live in one message catalogue (English only for now), so translation is easy later.
- The UI never decides permissions. It only hides what the API already refuses.
- Every figure on a dashboard links to the records behind it (see docs/design/reporting-and-dashboards.md).
- Field (handheld) screens are an installable offline web app (PWA) until the RFID reader is chosen.
