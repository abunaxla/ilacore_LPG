# Accounting

The system keeps a full double-entry ledger. Every cylinder movement that carries value creates journal entries.

## Ledger rules
- Chart of accounts (draft: [chart-of-accounts](../drafts/chart-of-accounts.md)).
- Journals are **immutable**. A mistake is corrected by a reversing journal plus a new correct one.
- Every journal balances (total debits = total credits). The database enforces this, not only the code.
- Accounts receivable (AR) per customer, with credit limits, ageing and statements.
- Bank and M-Pesa accounts, bank reconciliation, trial balance, P&L, balance sheet and period close.
  A closed period accepts no new postings.
- Money is stored as integer cents (KES). Never floating-point numbers.
- Cylinders are company assets, valued by location (depot, trucks, wholesalers, retailers, missing).

## Pricing
- Price lists by cylinder size, customer type and effective date.
- **Exchange** = G (gas price). **Outright sale** = G + C (cylinder value). Outright means bought,
  with no refund and no deposit, and ownership passes to the buyer.
- Tax rates and KRA eTIMS integration are configurable and **must be verified** before use. Nothing is hard-coded.

## From cylinders to money
- Every filled cylinder leaving the company creates an amount owed. It is cleared by:
  - a confirmed payment (bank or M-Pesa), or
  - approved credit (`credit.approve`).
- The **invoice is posted from the cylinder IDs scanned and confirmed** on the receiving manifest, never from a typed-in quantity.
- **Drivers never handle money.**
- A shortfall (see [custody-and-liability](custody-and-liability.md)) is charged at value C to the party liable for it,
  unless finance approves another resolution. A missing-cylinder case opens either way.

## Who is billed: billing links
Each retailer has a billing link, set by finance:

| Billing link | Who gets the invoice | Who the retailer pays |
|---|---|---|
| **Direct** | The retailer, on the company's books | The company (bank, M-Pesa or approved credit) |
| **Through wholesaler X** | Wholesaler X, on the company's books | Wholesaler X, which settles with the company |

- The billing link decides who is invoiced, **not** who delivered the cylinders.
- A driver delivering to a retailer linked to wholesaler X → the invoice goes to wholesaler X; custody shows the retailer.
- A wholesaler supplying its own retailer from its own stock → no new company invoice (the wholesaler was invoiced on receipt).
  Custody moves to the retailer when they confirm.

## Credit
- `credit.approve` is held by Finance and Senior roles by default, and can be assigned to others.
- Every approval is logged with the approver, the limit and the reason.

## Delivery modes
A company setting, which can be overridden per customer:

| Mode | Behaviour |
|---|---|
| **Route supply allowed** | Drivers supply from route stock. Over-limit warnings are shown. Accounts manage credit after delivery. |
| **Approved orders only** | A credit check happens at loading. A held order can be released by `credit.approve`, and the release is logged. |

**Account stop** (set by finance) applies in both modes. Drivers see "do not supply without approval".
