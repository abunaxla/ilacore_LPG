# ADR 0003: Current state in tables, history in an append-only event ledger

- Status: **Accepted** (17 November 2026)

## Decision
- The current state (for example a cylinder's four state dimensions, custody and balances) lives in normal relational tables.
- Every business change also writes a row to an **append-only `business_events`** table and to an **outbox** table,
  in the **same database transaction** as the state change.
- Workers read the outbox to send SMS and alerts and to refresh reports. They retry safely, so nothing is lost if a send fails.
- `business_events` and ledger journals can't be updated or deleted (enforced by database permissions and triggers).

## Why
- Queries for "where is everything right now" stay fast and simple.
- Full history and evidence are kept for audits, disputes and investigations.
- It avoids the complexity of full event sourcing, while keeping its main benefit: an immutable history.
