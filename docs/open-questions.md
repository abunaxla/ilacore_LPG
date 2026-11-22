# Open questions

| # | Question | Why it matters |
|---|---|---|
| 1 | Are there many places on routes with **no network coverage**? | A 15-minute SMS window can't work offline. If no-signal areas are common, an offline confirmation method is needed. |
| 2 | **SMS replies**: provider settled (Africa's Talking, KES 0.8 per SMS on the basic plan). Still open: a short code for YES/NO replies (shared with keyword about KES 5,800 set-up + KES 2,320/month per AT's 2019 page; codes would then come from a number, not "ILACORE"). Deferred 22 Nov 2026 | Shops can only refuse through the driver until then |
| 3 | **RFID reader** make and model | Decides whether the field client stays a PWA or moves to native Android, and how the vendor adapter is built |
| 4 | Current **VAT rate and KRA eTIMS** integration route | Must be verified, never assumed |
| 5 | Refinements to the **permission matrix** | Adopted as the starting point on 19 Nov 2026; refine as features are built ([matrix](drafts/permission-matrix.md)) |
| 6 | **Chart of accounts** review by the company accountant | [draft](drafts/chart-of-accounts.md) |
| 7 | Default **threshold periods** for investigations (per retailer, per end customer) | Configurable; needs a sensible starting value |
| 8 | Who is **senior to finance** for cancelling loss charges | Needed for the `loss.cancel` role |
| 9 | Is it right that the **depot supervisor** registers cylinders and replaces tags? | Provisional since 20 Nov 2026; no other role held these permissions ([matrix](drafts/permission-matrix.md)) |
| 10 | Are **serial numbers unique per manufacturer** (not across all manufacturers)? | That is how duplicates are checked today |
| 11 | Who **registers customers** (`customer.manage`)? | Given provisionally to finance on 21 Nov 2026; there is no sales role yet ([matrix](drafts/permission-matrix.md)) |
