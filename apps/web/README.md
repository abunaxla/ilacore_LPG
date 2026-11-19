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
