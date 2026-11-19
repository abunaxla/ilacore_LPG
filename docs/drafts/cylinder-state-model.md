# Cylinder state model (DRAFT)

A cylinder's state is **four independent dimensions**, not a single state machine. Each dimension changes
only through its own events, and all changes are recorded in the append-only `business_events` ledger.

| Dimension | Values (draft) | Changed by |
|---|---|---|
| **Physical / fill** | empty, filling, full, damaged, scrapped | Filling, QC, returns |
| **Custody / location** | at depot, on truck *T*, at wholesaler *W*, at retailer *R*, with end customer, sold outright, missing | Confirmed handovers, outright sales, loss reports |
| **Safety eligibility** | eligible, retest due, retest overdue, quarantined (QC fail), condemned | QC, requalification, time |
| **Security** (restricted) | normal, missing, sighted, under investigation, recovered | Loss reports, sightings, cases |

## Examples
- A full cylinder on a truck, retest due next month, normally: *full / on truck T12 / eligible / normal*.
- A stolen cylinder returned empty at a shop: *empty / at retailer R / eligible / sighted*.
  Only investigation roles see the security dimension.

## Rules
- Ownership is separate: the distributor owns the cylinder until it's **sold outright**, and then ownership passes to the buyer.
- A scan never changes state on its own. It is an observation that feeds handovers, audits and sightings.
- A cylinder that isn't *eligible* can't be dispatched full (the dispatch is blocked, and an alert is raised).
- Tag replacement keeps the cylinder's permanent identity. The old tag is retired, never reused.

## Generalisation
The same four dimensions apply to any tracked item ([ADR 0004](../adr/0004-tracked-item-core.md)).
For a cylinder, the "physical" values are fill states. Other item types will define their own values.
