# Notifications and alerts

## Principles
- An alert is a **record**, not just a message. It has a severity, an **owning role at a location** (not a named person),
  an acknowledgement and a resolution, all logged.
- Serious alerts can open a case automatically.
- Every alert links to the record it's about, and that link is permission-checked.
- No time-based escalation chain (agreed).

## Severity

| Level | Meaning | Channels |
|---|---|---|
| **Critical** | Act now | In-app, SMS, email |
| **Warning** | Act today | In-app, email; appears in the daily digest |
| **Info** | Good to know | In-app, daily digest |

Users can turn down info alerts. Critical alerts can't be switched off.

## Catalogue (draft)
- **Custody and loss:** unbalanced handover completed; handover unconfirmed after 15 minutes; dispute raised;
  missing-cylinder case opened; empties owed past their due date.
- **Security** (visible only to investigation roles; see [investigations](investigations.md)): a missing cylinder seen anywhere;
  a cylinder at an unexpected location; the same tag read in two places at once (possible cloned tag);
  a device or reader offline unexpectedly or reporting tampering; a retailer or end-customer threshold reached.
- **Safety:** cylinder retest due or overdue; a cylinder that failed QC appears in a dispatch.
- **Money:** credit limit exceeded; account stop set; held order waiting for release;
  an M-Pesa or bank payment couldn't be matched to a customer; period close due.
- **Stock:** stocktake variance found; stock below reorder level.
- **Customer-facing (SMS/email):** invoice issued, payment received, monthly statement, overdue reminder, account stop notice.

## Delivery rules
- De-duplicate: one alert for "15 handovers unconfirmed", not 15 messages.
- Quiet hours for non-critical SMS.
- Customer-facing SMS go only to the customer's registered number.
