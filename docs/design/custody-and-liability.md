# Custody and liability

## Principles
- **Ownership** (who owns the cylinder: the distributor, or a buyer after an outright sale) is separate from
  **custody** (who physically holds it right now).
- A **scan is an observation**. It records that a tag was seen, by which device, where and when.
  Only a confirmed **handover** changes custody.
- History is append-only. Corrections are new records that reverse earlier ones. Nothing is edited or deleted.

## The chain of custody

```
Depot ──▶ Driver (truck) ──▶ Wholesaler ──▶ Retailer ──▶ End customer
                       └──────────────────▶ Retailer
```

Drivers supply both wholesalers and retailers. Wholesalers supply retailers.

## The balanced-handover rule

For every full cylinder handed over, the giver must receive one of these, **at the handover**:

| Cover | Meaning |
|---|---|
| **Empty returned** | An empty scanned in during the same handover |
| **Sale report** | The receiver reports the cylinder was sold outright (billed G + C), so no empty will come back |
| **Approved exception** | For example "3 empties owed, collect next trip": approver, reason and due date are logged |

Any full cylinder without cover is the **giver's shortfall**.

| Handover | Who is accountable for a shortfall |
|---|---|
| Depot → driver | The driver signs for the whole load |
| Driver → wholesaler / retailer | The driver |
| Wholesaler → its retailer | The wholesaler (the only way a wholesaler becomes liable for its retailer's cylinders) |
| Retailer → end customer | The retailer (exchange gets an empty; an outright sale is reported) |

- The **receiver confirms** every handover (by scan, or by SMS code for retailers without a scanner). That confirmation
  proves the count and is the evidence in a dispute. It does **not** make the receiver liable for the giver's shortfall.
- An **approved exception** moves the empties owed to the receiver's account with a due date, and clears the giver.
- **Before completing**, the screen shows the balance, for example "4 full out, 1 empty in, 3 unaccounted". The giver can scan more,
  record a sale report or request an exception. If they complete anyway, the shortfall is recorded against them and a
  missing-cylinder case opens.
- Shortfalls are charged at cylinder value C unless finance approves another resolution.

## Unconfirmed handovers
- Custody moves to the receiver **only when the receiver confirms**.
- SMS confirmation has a 15-minute window (see [sms-confirmation](sms-confirmation.md)).
  If it isn't confirmed in time, custody stays with the giver.

## Driver settlement
- Purely physical. At the end of a route: cylinders loaded = delivered (with confirmed handovers) + returned + recorded shortfalls.
- Drivers never take money.
- Under separation of duties, a driver can't settle their own route.

## Recovered cylinders
- A recovered cylinder goes back into circulation, and the recovery is linked to the original loss case.
- Finance takes the recovery into account, but the giver's loss charge is not cancelled automatically.
  Cancelling it needs approval from someone senior to finance. That approval is logged.
