# apps/web — Next.js web app

Role-based screens and dashboards for every user type: owner (distributor), finance,
depot, driver, field supervisor, investigations, wholesaler and retailer.

Next.js 16 (App Router, Cache Components) with Tailwind.

## What exists now (Step 2, access)
| Screen | Path | Who |
|---|---|---|
| Sign in (organisation code, phone, password) | `/sign-in` | Anyone |
| Enter MFA code, or a recovery code | `/sign-in/mfa` | Mid-sign-in |
| Set up the authenticator app, then save 10 recovery codes | `/sign-in/set-up-mfa` | Mid-sign-in, roles that need MFA |
| Change password (forced at first sign-in with a temporary one) | `/change-password` | Signed in |
| Home: your roles and where | `/` | Signed in |
| People: add, give and remove roles, PIN, temporary password, reset MFA, disable | `/admin/users` | `user.manage` |
| Handhelds and readers: register (credential shown once), revoke | `/admin/devices` | `device.manage` |
| Locations | `/admin/locations` | `settings.manage` adds; admins can view |

How it talks to the API:
- The browser only talks to Next. Server Actions and server components call the API at `API_URL`
  (default `http://127.0.0.1:3001`) with `Authorization: Bearer`. See `src/lib/api.ts`.
- The session token sits in Next's own HttpOnly `lpg_session` cookie (SameSite=Lax; Secure in production
  or when `COOKIE_SECURE=true`). Browser JavaScript never sees it.
- `src/lib/auth.ts` sends people to the step they still owe (MFA set-up, MFA, password change) before anything else.

## Handheld screens (drivers)
A separate, phone-sized part of the app under `/field`, for the installable field client (agreed: a web app until
the RFID reader is chosen). Its cookies are scoped to `/field` and never mix with the office session.

| Screen | Path | Who |
|---|---|---|
| Set up this handheld: paste the credential from the Handhelds page (kept in an HttpOnly `lpg_device` cookie) | `/field/pair` | Once per handheld |
| Sign in with phone and PIN (needs the paired credential; session in `lpg_field`) | `/field/sign-in` | Field staff |
| Your trips | `/field` | Drivers (`handover.perform`) |
| Trip: sign for the load; find a shop by name, area or label and start a handover | `/field/trips/:id` | The trip's driver |
| Handover: scan fulls out and empties in, mark bought, ask for empties owed, send the code, enter the shop's code, resend once, record a dispute, cancel | `/field/handovers/:id` | The trip's driver |

Scanning is a text box for now: a reader that types like a keyboard sends each tag and Enter. The RFID reader
adapter plugs in there once the reader is chosen.

Working with no signal (production builds only; the service worker is not registered by `next dev`):
- `public/field-sw.js` keeps a copy of each `/field` page last opened with signal, the app's static files, and
  `/field/offline-handover` (the screen for a handover started with no signal). Signing out forgets the page copies.
- Starting a handover and scanning go through the handheld's outbox (`src/lib/field-outbox.ts`, IndexedDB) and are
  sent in order through `/field/sync` when there is signal. A start carries an id chosen on the handheld, so sending it
  twice is one handover; a tag sent twice comes back "already scanned". Refusals are shown as "could not be sent".
- Shops are kept on the handheld (`/field/shops`, no numbers) so a shop can be found with no signal.
- Everything else needs signal and is decided by the server when it happens: bought, empties owed, sending the shop
  the code and entering it. Custody therefore only moves once the server has checked the shop's code.

Loading: every handheld page loads into the handheld frame with the outbox status (waiting to send, sending, all sent)
and says when the signal is weak. Not done yet: the app manifest and icons.

## Running it
Needs the API running (see `apps/api/README.md`, including the SSH tunnel to the database).
```bash
corepack pnpm --filter @ilacore/web dev     # http://localhost:3000
```
Set `API_URL` if the API is not on `http://127.0.0.1:3001`.

Rules that apply here:
- WCAG 2.2 AA: large touch targets, high contrast that stays readable in sunlight,
  full keyboard and screen-reader support, and status never shown by colour alone.
- All UI strings live in one message catalogue (`src/i18n/messages.en.ts`, English only for now), so translation is easy later.
- The UI never decides permissions. It only hides what the API already refuses.
- Every figure on a dashboard links to the records behind it (see docs/design/reporting-and-dashboards.md).
- Field (handheld) screens are an installable offline web app (PWA) until the RFID reader is chosen.
