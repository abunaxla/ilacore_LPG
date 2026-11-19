# Threat model (first version, 19 November 2026)

A living document. Update it whenever a feature adds a new boundary, data type or role.

## What we protect
| Asset | Why it matters |
|---|---|
| Custody and handover records | They decide who is liable for missing cylinders |
| Ledger and invoices | Money owed and paid; must be exact and tamper-evident |
| Investigation data (flags, sightings, end-customer details) | Tipping off a thief ruins the case; personal data under Kenya's Data Protection Act |
| Registered phone numbers and confirmation codes | Whoever controls them can confirm handovers |
| Device credentials (handhelds, readers) | A stolen device could post fake scans |
| User accounts, especially privileged roles | Credit approval, period close, loss cancellation |

## Who might attack
- **Insiders**, the most likely: a driver dropping cylinders without empties; staff altering records; someone confirming their own work.
- **Partners:** a wholesaler or retailer disputing deliveries or using another party's confirmation.
- **Thieves** returning stolen cylinders for refill.
- **Outsiders:** credential stuffing, scraping, attacks on the public API and SMS endpoints.

## Main threats and controls

| Threat | Control | Where |
|---|---|---|
| One tenant reading another's data | Row-level security on every tenant table; tenant set per transaction | `0001_foundation.sql`, `withTenant` (tested) |
| Altering or deleting history | Append-only triggers on `business_events` and `audit_log` for every role; app role has no UPDATE/DELETE | `0001_foundation.sql` (tested) |
| Event written without its side effects (or the reverse) | Event + outbox + state change in one transaction | `recordEvent` (tested) |
| Silent schema drift | Immutable migrations with checksums | `migrate.ts` (tested) |
| App running with excessive database rights | App connects as a non-superuser member of `lpg_app` with least privilege | `0001_foundation.sql` |
| Leaking secrets in errors or logs | Config validation names bad settings, never their values | `env.ts` (tested) |
| Someone approving their own work | Separation-of-duties rules checked against record history | `@ilacore/domain` (rules listed; enforcement comes with the access module) |
| Account takeover of privileged roles | MFA required for privileged and investigation permissions | Access module (next) |
| Fake scans from stolen devices | Per-device credentials, individually revocable | Access module (next) |
| Driver entering their own phone as the retailer's | One registered number, OTP-verified; changes need finance approval | SMS module (later) |
| Brute-forcing confirmation codes | Single-use codes bound to counts, 15-minute expiry, limited attempts, rate limits | SMS module (later) |
| Tipping off a thief through the UI | Security state never sent to non-investigation roles; no flags on scanning screens | API response shaping (later) |
| Tampered evidence files | Hash on upload, stored with the record | Investigations (later) |

## Not yet covered
- Rate limiting and security headers on the API (added with the access module).
- Hosting hardening on the VPS (firewall, TLS, backups, restore drills): needs its own document before go-live.
- The outbox worker needs a role that can read pending work across tenants. Its design must keep that role from reading business data.
