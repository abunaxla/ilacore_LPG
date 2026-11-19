# Open questions

| # | Question | Why it matters |
|---|---|---|
| 1 | Are there many places on routes with **no network coverage**? | A 15-minute SMS window can't work offline. If no-signal areas are common, an offline confirmation method is needed. |
| 2 | **SMS provider and cost**: sender ID, shortcode or long number for replies, price per message | At least one SMS per retailer handover |
| 3 | **RFID reader** make and model | Decides whether the field client stays a PWA or moves to native Android, and how the vendor adapter is built |
| 4 | Current **VAT rate and KRA eTIMS** integration route | Must be verified, never assumed |
| 5 | Refinements to the **permission matrix** | Adopted as the starting point on 19 Nov 2026; refine as features are built ([matrix](drafts/permission-matrix.md)) |
| 6 | **Chart of accounts** review by the company accountant | [draft](drafts/chart-of-accounts.md) |
| 7 | Default **threshold periods** for investigations (per retailer, per end customer) | Configurable; needs a sensible starting value |
| 8 | Who is **senior to finance** for cancelling loss charges | Needed for the `loss.cancel` role |
| 9 | Do existing cylinders have **stamped serials**, and is their data already in a **spreadsheet**? | Decides how the first bulk registration is done; the pasted-list import accepts flexible column names |
| 10 | Should **other brands' cylinders** be accepted and tracked? | `owner_kind` exists in the schema, but only own cylinders can be registered for now |
| 11 | The **retest interval** rule (months), and whether it differs by size | Until it is set, a cylinder without a recorded "next test due" counts as test due and cannot go out full |
| 12 | Is it right that the **depot supervisor** registers cylinders and replaces tags? | Provisional since 20 Nov 2026; no other role held these permissions ([matrix](drafts/permission-matrix.md)) |
| 13 | Are **serial numbers unique per manufacturer** (not across all manufacturers)? | That is how duplicates are checked today |
