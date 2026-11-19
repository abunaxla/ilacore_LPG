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

## Access (Step 2)
- `migrations/0002_access.sql`: organisation directory, locations, users, role grants, devices, sessions, MFA recovery codes.
  All under row-level security. People, grants and devices are disabled or revoked, never erased.
- `src/identity/`: sign-in, MFA (TOTP, RFC 6238), sessions, password changes. `src/access/`: the global guard, roles,
  and administration of users, devices and locations. Rules (roles, permissions, PIN and password policy, separation of
  duties) live in `@ilacore/domain`.
- **Every route declares who may call it** (`@Public`, `@SignedIn` or `@RequirePermission`). A route without one is refused.

| Endpoint | Who |
|---|---|
| `POST /auth/sign-in` `{organisation, phone, password}` | Anyone. Sets the `lpg_session` cookie; replies with `next` |
| `POST /auth/device/sign-in` `{phone, pin}` + `Authorization: Device <credential>` | Registered handheld. Returns a bearer token |
| `GET /auth/me` | Signed in (also mid-sign-in) |
| `POST /auth/mfa/setup`, `/auth/mfa/confirm {code}`, `/auth/mfa/verify {code \| recoveryCode}` | Web, signed in |
| `POST /auth/password {current, next}`, `POST /auth/sign-out` | Signed in |
| `GET/POST /users`, `POST /users/:id/roles`, `/roles/:assignmentId/revoke`, `/pin`, `/password`, `/mfa/reset`, `/status` | `user.manage` |
| `GET/POST /devices`, `POST /devices/:id/revoke` | `device.manage` |
| `GET /locations` / `POST /locations` | `settings.manage`, `user.manage` or `device.manage` / `settings.manage` |

`next` is `mfa_setup`, `mfa`, `change_password` or `done`. Until it is `done`, only the `/auth` routes work.

### First administrator
```bash
corepack pnpm build
echo "the-admin-password" | corepack pnpm provision --name "Acme Gas Ltd" --code acme-gas --phone 0712345678 --admin "Jane Wanjiru"
```
Or run it without `echo` and type the password when asked. Uses `DATABASE_MIGRATION_URL`.

## Cylinders, tags and scan sessions (Step 3)
- `migrations/0003_items.sql`: the tracked-item core (`tracked_items`, ADR 0004) with cylinders as the first type;
  RFID tags (`item_tags`: a tag number belongs to one item forever and a retired tag never comes back, enforced by a
  trigger); the restricted `item_security` dimension in its own table; `cylinder_sizes`; `tenant_settings` (retest
  interval); and `scan_sessions` / `scan_batches` / `scan_reads` (raw reads, append-only).
- New organisations start with 6, 13 and 50 kg sizes; the owner adds or retires sizes.
- Safety (eligible / test due / overdue / quarantined / condemned) is worked out on read from the test dates, the
  organisation's interval and any hold, because time changes it. An unknown test date counts as due and blocks a full dispatch.
- A scan never changes a cylinder's state. Step 4 (handovers) uses the reviewed session list.
- Routes marked `anyLocation` only check the permission is held somewhere; the service then checks it at the record's
  location (`src/access/require-at.ts`).

| Endpoint | Who |
|---|---|
| `GET /cylinder-settings` | `settings.manage`, `item.register` or `item.view_position` |
| `PUT /cylinder-settings/retest-interval {months \| null}`, `POST /cylinder-settings/sizes {name, nominalFillKg}`, `POST /cylinder-settings/sizes/:id/retire` | `settings.manage` |
| `POST /cylinders` (one) / `POST /cylinders/import` (up to 500, all or nothing, problems reported per row) | `item.register` at `locationId` |
| `GET /cylinders?locationId&sizeId&physicalState&safety&search&limit&offset` | `item.view_position` or `item.register` there (organisation-wide without `locationId`) |
| `GET /cylinders/:id`, `GET /cylinders/by-tag/:epc` (any tag it ever had) | the same, at the cylinder's location |
| `POST /cylinders/:id/tag {epc, reason}` | `item.replace_tag` at the cylinder's location |
| `POST /scan-sessions {purpose, locationId}`, `POST /scan-sessions/:id/reads {batchId, reads}`, `POST /scan-sessions/:id/close` | the purpose's permission at the location (registration `item.register`, dispatch `dispatch.scan`, stocktake `stocktake.perform`, audit `audit.perform`). Only the device that opened it sends reads; a repeated `batchId` is ignored |
| `GET /scan-sessions`, `GET /scan-sessions/:id` (reads merged per tag, matched to cylinders) | the purpose's permission or cylinder viewing, at the location |

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

`.env` also needs `MFA_ENCRYPTION_KEY` (`openssl rand -base64 32`). Keep it safe: losing it means everyone re-enrols MFA.

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
