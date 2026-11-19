# ADR 0004: A general tracked-item core, with the LPG cylinder as the first type

- Status: **Accepted** (18 November 2026)

## Context
The system is LPG-first, but the owner expects to use it later for warehouse operations.

## Decision
- The core concept is a **tracked item**: permanent identity, tags, owner, custodian, location, state dimensions and history.
- Custody, handovers, scanning, the ledger, alerts and investigations work on tracked items and don't depend on gas-specific details.
- **Cylinder** is the first item type, with its own attributes (size, tare weight, retest date) and fill states.
- Warehouse features are **not** built now. This only keeps the path open.

## Consequence
- Gas-specific rules (filling, QC, requalification, G/C pricing) stay inside their own modules.
- Naming in the core is generic (`tracked_item`, `custody_holder`). LPG terms are used in LPG modules and in the UI.
