# Security and accessibility

## Access control
- Permissions are defined **per task** (for example `dispatch.scan`, `credit.approve`). Roles are bundles of permissions.
- **Deny by default.** Scoped by organisation and location. Enforced in the backend on every request.
- The matrix is agreed before code depends on it ([permission-matrix](../drafts/permission-matrix.md)).

### Separation of duties (draft defaults)
- The loader can't approve their own dispatch exceptions.
- A driver can't settle their own route.
- The stocktaker can't finalise variances.
- Whoever opens a missing case can't close it.
- A loss charge can only be cancelled by someone senior to finance.

## Security
- MFA for privileged and investigation roles.
- Tenant isolation enforced in the database as well (PostgreSQL row-level security).
- Immutable audit log of who did what, when, from which device.
- Device credentials for scanners and readers can be revoked individually.
- No hard-coded secrets. All configuration comes from the environment.
- Input validation at every boundary; rate limiting; evidence files hashed on upload.
- A threat model is written early, in Phase 0/1, and kept current.
- Personal data is handled under Kenya's Data Protection Act. Access to customer details is restricted and logged.

## Accessibility: WCAG 2.2 AA
- Large touch targets (field use, gloves).
- High contrast that stays readable in sunlight.
- Full keyboard and screen-reader support.
- Status is never shown by colour alone. Always add text or an icon.
- All UI strings sit in one catalogue (English only for now).
