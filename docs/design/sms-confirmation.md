# SMS confirmation

Used for every handover where the receiver has no scanner of their own (mainly small retailers).

## Flow
1. The giver scans fulls out and empties in. The screen shows whether the handover balances.
2. The giver taps **Request confirmation**. The system sends an SMS to the receiver's **registered number**:

   > ILACORE: Mwangi (KDA 123X) at Mama Njeri Shop. 4x13kg FULL given, 4x13kg EMPTY taken. Ref 4821.
   > If correct, give the driver code 739152 or reply YES 4821. If wrong, reply NO 4821.

3. The receiver confirms in one of two ways:
   - reads the **code** to the giver, who types it in, or
   - **replies YES** by SMS.
4. **NO** freezes the handover, opens a dispute and alerts the giver's supervisor.

## Timing (agreed)
- The window is **15 minutes** from when the code is sent. Longer windows cause confusion.
- While still at the shop, the giver may request **one fresh code**.
- If it isn't confirmed in time, the handover is **unconfirmed**: custody stays with the giver, the supervisor is alerted and a case opens.
- If the code can't be sent because there's no signal, the handover can't be confirmed and is recorded as unconfirmed.
  An offline way to confirm will only be designed if no-signal areas turn out to be common (see [open questions](../open-questions.md)).

## Security
- Each code is **single-use** and tied to that handover and those counts. If the counts change, the code stops working.
- Codes expire, and each has a limited number of tries.
- **One registered number per customer**, verified by OTP. Only that number receives codes and only its replies count.
  Replies from any other number are ignored and logged.
- Changing the number needs **finance approval** and is logged.
- SMS messages never contain prices, balances or anything related to investigations. Invoices and statements are sent separately.
- Wording never mentions theft or flags (see [investigations](investigations.md)).

## Provider
- Behind an `SmsAdapter` interface; no provider is hard-coded.
- **To verify before building:** registered sender ID, a shortcode or long number for replies,
  the cost per message (at least one per retailer handover), and delivery reports.
