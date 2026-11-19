# Investigations (restricted)

Missing cylinders are handled **quietly**. The system gathers evidence in the background, and only permitted users ever see it.

## How a cylinder becomes missing
- For example, a driver reports a cylinder lost in transit. It is marked **missing**, and the loss stays on the
  giver's custody record (see [custody-and-liability](custody-and-liability.md)).

## Scenario 1: it turns up full in a retailer's stock
- It is detected by any scan: a delivery handover, a wholesaler supplying that retailer, or an audit.
- The system quietly opens a **verification task** for a field supervisor: find out how the retailer got the cylinder.
- To the retailer, the visit is a **routine audit**, and nobody is accused on the spot.
- The supervisor records what they found, and the case links back to the original loss.

## Scenario 2: it comes back empty, through an exchange
- This means someone is bringing the stolen cylinder back for a refill.
- The exchange goes through normally. The customer isn't refused and the retailer isn't questioned.
- Detection usually happens when the flagged empty is **collected from the shop**, so the system records which shop it came from.
  At the next audit visit, the field supervisor quietly asks about it and records any customer details in the case.
  Retailers aren't asked to record anything extra.

## Thresholds
Two counts, each over a **configurable period** (for example 3 months, 1 year or longer):
- flagged cylinders per **retailer**, default **5**;
- flagged cylinders per **end customer**, wherever their details are known, across all shops.

Whichever count reaches its limit first sends the case to the **investigations department** for further action.

## Silence and access
- Drivers, wholesalers, retailers and stocktakers see **nothing unusual** when they scan a flagged cylinder.
  Their screens behave exactly as normal.
- Only users with investigation permissions see flags, sightings, customer details and cases.
  **Every view is logged.** MFA is required for these roles.
- No SMS, notification or customer message ever mentions theft.

## Recovery
- Finance takes a recovery into account, but the original loss charge is **not** cancelled automatically.
  Only someone senior to finance can cancel it, and the cancellation is logged.
- Under separation of duties, whoever opens a missing case can't close it.
