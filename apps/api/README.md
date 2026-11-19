# apps/api — NestJS API (modular monolith)

All business rules live here, behind per-task permissions. See docs/adr/0002-modular-monolith.md.

## What exists now (Phase 1 foundation)
- `migrations/0001_foundation.sql`: tenants; row-level security (deny by default when no tenant is set);
  append-only `business_events` and `audit_log` (enforced by triggers, even for the owner); outbox;
  a least-privilege `ilacore_app` role.
- `src/db/migrate.ts`: ordered SQL migrations, each in a transaction, with checksums. A changed migration stops the run.
- `src/db/tenant-transaction.ts`: `withTenant()` scopes one transaction to one tenant.
- `src/events/`: `recordEvent()` (event + outbox in the caller's transaction) and `recordAudit()`.
- `src/config/env.ts`: validated configuration. The API won't start with bad settings.
- `GET /health`: database reachability.

## Running it
```bash
cp .env.example .env              # set real values
corepack pnpm build
corepack pnpm migrate             # uses DATABASE_MIGRATION_URL (schema owner)
corepack pnpm start               # uses DATABASE_URL (a login role IN ROLE ilacore_app)
```
Create the application login role once, as the schema owner:
`CREATE ROLE ilacore_app_login LOGIN PASSWORD '...' IN ROLE ilacore_app;`

## Tests
- `corepack pnpm test`: unit tests.
- `corepack pnpm test:int`: integration tests against a real PostgreSQL + PostGIS. Needs Docker running.

Planned modules (each has its own folder, and modules only talk to each other through public interfaces):

| Module | Purpose |
|---|---|
| identity | Sign-in, MFA, devices, sessions |
| access | Permissions, roles, organisation and location scope |
| tracked-items | Permanent item identity (cylinders first), tags, tag replacement |
| filling | Filling, QC, safety eligibility, requalification |
| scanning | Scan sessions; reads are observations, never transactions |
| custody | Handovers, the balanced-handover rule, SMS confirmation, shortfalls |
| distribution | Routes, dispatch, trucks, driver settlement (physical only) |
| inventory | Stock by location, stocktakes, variances |
| sales | Price lists, invoices posted from confirmed manifests, billing links |
| ledger | Double-entry accounting, credit, AR, M-Pesa and bank reconciliation, period close |
| investigations | Restricted: missing cases, silent sightings, thresholds |
| notifications | Alerts as records, SMS and email adapters |
| reporting | Read models, exports, drill-down |

Data rules:
- PostgreSQL with row-level security per tenant; Drizzle ORM; plain SQL migrations.
- Current state lives in tables. Every change also writes to the append-only `business_events`
  ledger and the outbox, in the same transaction.
- Money is stored as integer cents (KES). Never floating-point numbers.
