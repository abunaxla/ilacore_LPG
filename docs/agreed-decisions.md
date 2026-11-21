# Agreed decisions

Decisions agreed with the product owner during design discussions (17–18 November 2026).
Each one links to the document with the detail. Change a decision here first, then in the detail doc.

## Product and scope
- The product is ILACORE, an LPG cylinder lifecycle, distribution and loss intelligence platform for Kenya.
- **Owner = the distributor.** The owner sees every owned cylinder wherever it is, at any time.
- The core is built around a general **tracked item** so it can later serve warehouse operations
  ([ADR 0004](adr/0004-tracked-item-core.md)). The cylinder is the first type of tracked item.
- English only for now. All UI strings sit in one catalogue so translation is easy later.

## Quality bar
- Well designed, robust and secure. Permissions are defined per task, not guessed.
- Accessibility is key: WCAG 2.2 AA ([security-and-accessibility](design/security-and-accessibility.md)).

## Hardware
- The UHF RFID reader comes later. The system is built now against a realistic **reader simulator**
  behind a common reader interface ([packages/reader-sim](../packages/reader-sim/README.md)).
- Field client: an installable offline web app (PWA) for now. Whether to go native Android is decided once the reader is chosen.

## Custody and liability ([detail](design/custody-and-liability.md))
- A scan is an observation, not a transaction. Ownership is separate from custody.
- **Balanced handover:** every full cylinder handed over must be matched, at that moment, by an empty returned,
  a reported outright sale, or an approved exception.
- **The giver is liable for any shortfall.** This applies at every link: depot → driver → wholesaler → retailer → end customer.
- The receiver's confirmation proves the count. It does not make the receiver liable for the giver's shortfall.
- An approved exception ("N empties owed, due date") moves the debt to the receiver and clears the giver.
- An unbalanced handover can still be completed, but the shortfall is recorded against the giver and a missing-cylinder case opens.

## Money ([detail](design/accounting.md))
- Full double-entry ledger inside the system.
- Exchange = G (gas price). Outright sale = G + C (cylinder value). Outright means bought: no refunds, no deposits.
- Every filled cylinder leaving the company creates an amount owed, cleared by confirmed payment (bank, M-Pesa) or approved credit.
- Invoices post from the cylinder IDs scanned and confirmed on the receiving manifest.
- **Drivers never handle money.** Driver settlement is physical only.
- Each retailer has a **billing link**: either *direct* (pays the company) or *through a named wholesaler*.
  Who gets the invoice follows that link, not who delivered the cylinders.
- `credit.approve` is held by Finance and Senior roles by default, and can be assigned to others. Every approval is logged.
- Delivery mode is a company setting with per-customer override: *route supply allowed* or *approved orders only*.
  An account stop applies in both modes.
- Tax rates and KRA eTIMS are configurable and must be verified. Nothing is hard-coded.

## Small retailers ([detail](design/retailers.md))
- No RFID reader needed. The supplier's scanner (driver or wholesaler) scans fulls out and empties in.
- The retailer confirms by SMS code (works on basic phones). QR labels are issued at registration. Field agents do audits.

## SMS confirmation ([detail](design/sms-confirmation.md))
- **15-minute window** from when the code is sent. One fresh code may be requested while still at the shop.
- After that the handover is *unconfirmed*: custody stays with the giver, the supervisor is alerted, and a case opens.
- **One registered number per customer**, verified by OTP. Only that number receives codes and only its replies count.
  Changing it needs finance approval.

## Alerts ([detail](design/notifications-and-alerts.md))
- Alerts are records with an owning role, an acknowledgement and a resolution.
- Three levels: critical, warning, info. No time-based escalation chain.

## Investigations ([detail](design/investigations.md))
- Missing cylinders are handled **silently**. Scanning screens never show a flag.
- A missing cylinder found **full** at a retailer triggers a field-supervisor verification visit, presented as a routine audit.
- A missing cylinder returned **empty** is recorded as evidence and the exchange proceeds normally. Thresholds per retailer
  (default 5) and per end customer, over a configurable period, send the case to the investigations department.
- When a cylinder is recovered, finance takes that into account, but the driver's loss charge is **not** cancelled automatically.
  Only someone senior to finance can cancel it.

## Reporting ([detail](design/reporting-and-dashboards.md))
- Dashboards per role. Every figure drills down to its source records. Exports to PDF, Excel and CSV.

## Access (agreed 19 November 2026; [security](design/security-and-accessibility.md))
- **Office and web users** sign in with organisation code, phone number and password (12+ characters, common ones refused).
- **Field staff** sign in only on a registered handheld, with phone number and a **6-digit PIN**. A PIN never works on the web.
- **Retailers never sign in.** They confirm by SMS from their registered number.
- **No self sign-up.** An administrator creates every account. The first administrator is created with `pnpm provision` on the server.
- **MFA uses an authenticator app** (TOTP) plus ten one-time recovery codes, not SMS: SIM-swap fraud would defeat SMS codes,
  and the apps work without coverage. Required for every role that holds an MFA permission; set up at first sign-in.
- **Devices** have their own credential each, revocable on its own. Revoking one ends every session on it at once.
- **Sessions**: web signs out after 30 minutes idle and always after 12 hours; a handheld session lasts a 12-hour shift.
- Five wrong attempts lock the account for 15 minutes (doubling, up to a day). An administrator can't change their own
  roles, password, MFA or status; another administrator has to.

## Cylinders (agreed 20 November 2026)
- Sizes start as 6, 13 and 50 kg; the owner can add more.
- The **RFID tag is the identity** in practice. Stamped serials exist but are hard to read, so they are optional.
- **Own cylinders only**; other brands are not tracked.
- **Custody and movement come first.** Inspections, test dates, fill checks and weighing belong to a separate
  **maintenance module** later. Until then safety is only a hold a person places (quarantined or condemned);
  dates never block a cylinder.

## Handover, first slice (agreed 21 November 2026)
- First slice: a **driver hands over to a retailer or wholesaler from a trip that is out**. Wholesaler → retailer,
  retailer → end customer, invoices and settlement come later.
- The **depot supervisor** of the trip's depot approves "empties owed" exceptions, while the driver waits.
- An empty offered back that **isn't ours** (unknown tag or no tag) does **not** count as cover; the tag is noted.
  An empty already on a truck can't be offered back either (it would let a driver balance with his own load).
- **SMS goes through a stand-in** until a provider is chosen: messages are kept and shown on a test screen, not sent.
  Provider chosen (21 Nov 2026): **Africa's Talking**, switched on with `SMS_PROVIDER=africastalking`; the stand-in
  stays the default for development and tests.
  Confirmation in this slice is the **code read to the driver**. Replying YES / NO by SMS needs the provider's
  reply number, so it comes with the provider; until then the driver records a refusal as a dispute.
- Customers are registered by holders of `customer.manage`, given provisionally to the **finance** role
  (the accounting design already has finance setting billing links). A customer's number is verified by an SMS code
  before any handover to them.

## Stack ([ADR 0001](adr/0001-stack.md))
- TypeScript; PostgreSQL + PostGIS; Drizzle ORM with SQL migrations; NestJS; Next.js with Tailwind and shadcn/ui;
  Redis + BullMQ; S3-compatible storage; Docker. Deployed to the owner's VPS.
- Modular monolith ([ADR 0002](adr/0002-modular-monolith.md)).
