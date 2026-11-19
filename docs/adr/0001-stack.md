# ADR 0001: Technology stack

- Status: **Accepted** (18 November 2026)

## Decision

| Part | Choice |
|---|---|
| Language | TypeScript (front end, back end and shared rules) |
| Database | PostgreSQL + PostGIS, with row-level security per tenant |
| Database access | Drizzle ORM; plain SQL migrations, reviewed |
| Backend | NestJS (Node.js 24 LTS), OpenAPI generated from code |
| Frontend | Next.js (React), Tailwind CSS, shadcn/ui on Radix |
| Tables / charts | TanStack Table, Apache ECharts |
| Field client | Installable offline web app (PWA) until the RFID reader is chosen |
| Background jobs | Redis + BullMQ (outbox, SMS, alerts, heavy reports) |
| Files / evidence | S3-compatible storage (MinIO locally), files hashed on upload |
| Sign-in | An established auth library with authenticator-app MFA (chosen in Phase 1) |
| Tests | Vitest, Playwright, Testcontainers (real PostgreSQL) |
| Packaging | pnpm workspaces; Docker; deployed to the owner's VPS |

## Why
- One language lets the reconciliation, balanced-handover and liability rules be written once and shared by both sides.
- PostgreSQL gives strict transactions for the ledger, database-level tenant isolation, and PostGIS for locations.
- Drizzle keeps SQL visible and under control, which the ledger, the append-only history and row-level security need.
- Radix-based components give accessible behaviour to build on toward WCAG 2.2 AA.

## Alternatives considered
- **C#/.NET:** equally strong for finance-heavy systems, but loses the single shared language.
- **Prisma:** awkward with row-level security and per-transaction session settings.

## Notes
- Exact package and image versions are pinned when each app is generated in Phase 1.
