# apps/api — NestJS API (modular monolith)

All business rules live here, behind per-task permissions. See docs/adr/0002-modular-monolith.md.

## What exists now (Phase 1 foundation)
- `migrations/0001_foundation.sql`: tenants; row-level security (deny by default when no tenant is set);
  append-only `business_events` and `audit_log` (enforced by triggers, even for the owner); outbox;
  a least-privilege `lpg_app` role.
- `src/db/migrate.ts`: ordered SQL migrations, each in a transaction, with checksums. A changed migration stops the run.
- `src/db/tenant-transaction.ts`: `withTenant()` scopes one transaction to one tenant.
- `src/events/`: `recordEvent()` (event + outbox in the caller's transaction) and `recordAudit()`.
- `src/config/env.ts`: validated configuration. The API won't start with bad settings.
- `GET /health`: database reachability.

## Development database (on the VPS)
Development and integration tests use the PostgreSQL 16 + PostGIS 3.4 server on the VPS, which also hosts
the live telematics app. Don't run Docker locally. Database names and logins all start with `lpg_` so they
never collide with the telematics app's `ilacore` database and roles (PostgreSQL logins are server-wide).

| Name | What it is |
|---|---|
| `lpg_owner` | Schema owner (not a superuser; CREATEDB, CREATEROLE; admin of `lpg_app`). Runs migrations and tests. |
| `lpg_app` | NOLOGIN application role. Row-level security always applies to it. |
| `lpg_app_login` | The API's login, a member of `lpg_app`. |
| `lpg_dev` | Development database, owned by `lpg_owner`. |
| `lpg_template` | Template with PostGIS and pgcrypto preinstalled (extensions need a superuser). |

PostgreSQL only listens on the VPS itself. Reach it through an SSH tunnel and keep it open while you work:
```bash
ssh -N -L 15432:127.0.0.1:5432 -i "D:\Tools\ssh\ilacore_vps" root@45.13.234.139
```
`.env` (not committed) holds the generated passwords. `.env.example` shows its shape.

## Running it
```bash
corepack pnpm build
corepack pnpm migrate             # uses DATABASE_MIGRATION_URL (schema owner)
corepack pnpm start               # uses DATABASE_URL (a login role IN ROLE lpg_app)
```

Row-level security is forced even for the owner, so tenants are provisioned inside their own scope
(`withTenant(pool, newId, ...)`), never by bypassing it.

## Tests
- `corepack pnpm test`: unit tests.
- `corepack pnpm test:int`: integration tests against a real PostgreSQL + PostGIS (`test/support/test-database.ts`).
  - Locally, with `TEST_ADMIN_DATABASE_URL` set and the tunnel open, each run creates a throwaway `lpg_test_*` database
    and `lpg_t_*` login on the VPS, then drops them.
  - In CI, with `TEST_ADMIN_DATABASE_URL` unset, Testcontainers starts `postgis/postgis:16-3.4`.

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
