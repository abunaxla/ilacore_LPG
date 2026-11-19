# ILACORE

LPG cylinder lifecycle, distribution and loss intelligence platform (Kenya).

Every cylinder has a permanent identity. Custody is tracked through every handover, from depot to driver, wholesaler,
retailer and end customer. Every filled cylinder that leaves the company is matched to money: a confirmed payment or approved credit.

**Status:** project skeleton and agreed design. No business logic yet.

## Layout

```
apps/
  web/            Next.js web app: role dashboards and screens (not generated yet)
  api/            NestJS API: modular monolith holding all business rules (not generated yet)
packages/
  domain/         Shared types, state models and pure rules
  reader-sim/     RFID reader simulator (the real reader comes later)
docs/             Agreed decisions, design, drafts, ADRs, diagrams, open questions
infra/            Local PostgreSQL+PostGIS, Redis and MinIO (docker compose)
```

## Getting started (local services)

Requirements: Node.js 24, pnpm (via `corepack enable`), Docker.

```bash
cp infra/.env.example infra/.env   # set real values
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
```

## Read first
- [docs/agreed-decisions.md](docs/agreed-decisions.md): everything agreed so far
- [docs/open-questions.md](docs/open-questions.md): what still needs an answer

## Working rules
- Inspect before building. Don't fabricate integrations: M-Pesa, KRA eTIMS, SMS and RFID are adapters, built only against verified specs.
- Permissions are per task, deny by default, and enforced in the API.
- History is append-only. Corrections reverse earlier records; nothing is edited or deleted.
- Money is stored as integer cents. Every number in a report traces back to its source records.
- Report honestly: say what was tested and what wasn't.
