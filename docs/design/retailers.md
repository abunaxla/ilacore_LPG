# Small retailers

Most small retailers can't justify an RFID reader. The design works without one.

## How a handover with a small retailer works
1. The **supplier's scanner** (driver or wholesaler) scans the fulls out and the empties in.
2. The balanced-handover check runs (see [custody-and-liability](custody-and-liability.md)).
3. The retailer **confirms by SMS code** on their registered number (see [sms-confirmation](sms-confirmation.md)).
   This works on basic phones.
4. Custody moves to the retailer only when they confirm.

## Identity and registration
- Every retailer is registered with **one verified phone number** (OTP at registration).
- A **QR label** is issued at registration. A phone camera can scan it in the browser to identify the shop during a handover or audit.
- Retailers get a light role: sign in by phone number OTP, see their own deliveries, balances and statements.
- USSD may come later through a provider such as Africa's Talking, once costs are verified.

## Billing
Each retailer is either **direct** or **through a named wholesaler** (see [accounting](accounting.md#who-is-billed-billing-links)).

## Audits
- Field agents with handhelds make periodic and surprise audit visits and scan the retailer's stock.
- Audits are also the cover for silent verification visits (see [investigations](investigations.md)).
