# apps/api — NestJS API (modular monolith)

All business rules live here, behind per-task permissions. See docs/adr/0002-modular-monolith.md.

Not scaffolded yet. Phase 1 will run `nest new` here.

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
