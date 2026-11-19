# Chart of accounts (DRAFT)

Status: **draft for finance review**. Account codes and names are placeholders until your accountant agrees them.
Tax accounts must be checked against current KRA requirements. Nothing is hard-coded.

| Code | Account | Type | Notes |
|---|---|---|---|
| 1000 | Bank — (per bank account) | Asset | One sub-account per bank account |
| 1050 | M-Pesa — (per paybill/till) | Asset | |
| 1100 | Accounts receivable — customers | Asset | Sub-ledger per customer (wholesalers and direct retailers) |
| 1150 | Shortfalls receivable — staff/partners | Asset | Liability charges at value C |
| 1200 | Gas inventory | Asset | Bulk and filled stock |
| 1300 | Cylinders — at depot | Asset | Valued by location |
| 1310 | Cylinders — on trucks | Asset | |
| 1320 | Cylinders — at customers | Asset | Wholesalers and retailers (still company-owned) |
| 1330 | Cylinders — missing | Asset (contra/review) | Pending recovery or write-off |
| 2000 | Accounts payable | Liability | |
| 2100 | VAT output | Liability | Rate configurable and verified |
| 2200 | Empties owed to the company | Memo/statistical | Count-based, tracked alongside |
| 4000 | Gas sales — exchange (G) | Income | |
| 4100 | Cylinder sales — outright (C) | Income | |
| 5000 | Cost of gas sold | Expense | |
| 5100 | Cylinder losses / write-offs | Expense | Only after approved resolution |
| 3000 | Equity | Equity | |

## Example postings
- **Exchange invoice** (confirmed manifest, 4 × 13 kg): Dr AR (customer) / Cr Gas sales (4 × G) / Cr VAT output.
- **Outright sale** (1 × 13 kg): Dr AR / Cr Gas sales (G) / Cr Cylinder sales (C) / Cr VAT output; and move the cylinder out of
  *Cylinders — at customers* (ownership passes to the buyer).
- **Payment by M-Pesa**: Dr M-Pesa / Cr AR (customer).
- **Shortfall charged to giver**: Dr Shortfalls receivable / Cr Cylinders (location), at value C.
- **Correction**: a reversing journal of the original, then the correct journal. Nothing is ever edited.
