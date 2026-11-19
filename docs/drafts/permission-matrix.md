# Permission matrix (adopted starting point)

Status: **adopted as the starting point** (19 November 2026). The product owner accepted this draft so development can begin.
It will be refined as features are built. Any change is recorded here first.

Permissions are per task. Roles are bundles of permissions. Everything is denied by default.
Every grant is scoped to an organisation and, where it applies, a location.

## Permissions

| Area | Permission | Meaning |
|---|---|---|
| Items | `item.register` | Register a new cylinder and its first tag |
| | `item.replace_tag` | Replace a damaged tag (old tag retired, logged) |
| | `item.view_position` | See where cylinders are (custody/location) |
| Filling | `filling.record` | Record a fill |
| | `qc.record` | Record a QC pass/fail |
| | `safety.requalify` | Record a retest/requalification |
| Dispatch | `dispatch.scan` | Scan a load onto a truck |
| | `dispatch.approve_exception` | Approve a dispatch exception |
| Handover | `handover.perform` | Perform a handover as the giver |
| | `handover.confirm` | Confirm a handover as the receiver |
| | `handover.approve_exception` | Approve "empties owed" exceptions |
| | `handover.resolve_dispute` | Resolve a disputed handover |
| Route | `route.settle` | Settle a driver's route (physical) |
| Stock | `stocktake.perform` | Count stock |
| | `stocktake.finalise` | Finalise variances |
| | `audit.perform` | Carry out a field audit visit |
| Sales | `pricing.manage` | Maintain price lists |
| | `invoice.view` | See invoices |
| | `customer.manage` | Register customers, billing links |
| | `customer.change_phone` | Approve a registered-number change |
| Finance | `credit.approve` | Approve credit, release held orders |
| | `account.stop` | Set or lift an account stop |
| | `ledger.post_manual` | Post a manual journal |
| | `ledger.reconcile` | Bank / M-Pesa reconciliation |
| | `period.close` | Close an accounting period |
| | `loss.resolve` | Resolve a shortfall charge (other than at value C) |
| | `loss.cancel` | Cancel a loss charge (senior to finance only) |
| Investigations | `investigation.view` | See flags, sightings, cases |
| | `investigation.view_customer` | See end-customer details in cases |
| | `investigation.manage` | Open, assign, close cases |
| | `investigation.configure_thresholds` | Set thresholds and periods |
| Admin | `user.manage` | Users and role assignments |
| | `device.manage` | Register and revoke devices and readers |
| | `settings.manage` | Company settings (delivery mode, windows) |
| Reports | `report.operations` / `report.finance` / `report.owner` | Report access by area |

## Draft roles

| Role | Holds (summary) |
|---|---|
| Owner / Director | All `report.*`, `item.view_position`, `loss.cancel`, `settings.manage` |
| Senior manager | `credit.approve`, `loss.cancel`, `report.*` |
| Finance | `credit.approve`, `account.stop`, `ledger.*`, `period.close`, `loss.resolve`, `customer.change_phone`, `report.finance` |
| Depot supervisor | `dispatch.approve_exception`, `handover.approve_exception`, `route.settle`, `stocktake.finalise`, `item.register`, `item.replace_tag`, `item.view_position` (the three `item.*` added provisionally on 20 Nov 2026, to confirm) |
| Loader | `dispatch.scan` |
| Filling / QC operator | `filling.record`, `qc.record` |
| Driver | `handover.perform` |
| Field supervisor / agent | `audit.perform`, `handover.resolve_dispute` |
| Stocktaker | `stocktake.perform` |
| Investigator | `investigation.*` (MFA required) |
| Wholesaler user | `handover.perform`, `handover.confirm`, `invoice.view` (own account) |
| Retailer (light) | `handover.confirm` (via registered number), `invoice.view` (own account) |
| Administrator | `user.manage`, `device.manage` |

## Separation of duties (enforced, not just advised)
- `dispatch.scan` and `dispatch.approve_exception` can't be used by the same person on the same dispatch.
- A driver can't `route.settle` their own route.
- `stocktake.perform` and `stocktake.finalise` can't be used by the same person on the same stocktake.
- Whoever opens a missing case can't close it.
- `loss.cancel` is never held by the Finance role.
