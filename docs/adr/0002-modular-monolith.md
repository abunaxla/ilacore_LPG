# ADR 0002: Modular monolith

- Status: **Accepted** (17 November 2026)

## Decision
One deployable API (`apps/api`), split into modules with strict boundaries (see `apps/api/README.md`).
Modules talk only through each module's public interface and domain events. They don't reach into each other's tables.

## Why
- A handover, its ledger postings and its events must commit **in one database transaction**. That's simple in one service
  and hard across several.
- It suits a small team and a single VPS.
- Clear boundaries keep the option of splitting a module out later, if there's ever a real reason to.
