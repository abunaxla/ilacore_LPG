import { ROLE_IDS, ROLES } from '@ilacore/domain';
import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { Field, Select } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import {
  createUserAction,
  grantRoleAction,
  resetMfaAction,
  resetPasswordAction,
  revokeRoleAction,
  setPinAction,
  setStatusAction,
} from '../actions';
import { load, type Location } from '../data';

interface UserRow {
  id: string;
  phone: string;
  displayName: string;
  status: 'active' | 'disabled';
  mfaEnabled: boolean;
  roles: { id: string; role: string; locationId: string | null }[];
}

/** Roles a person can be given. Retailers confirm by SMS and never get a login. */
const GRANTABLE = ROLE_IDS.filter((r) => ROLES[r].channel !== 'sms_only');

export default function UsersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Users />
    </Suspense>
  );
}

async function Users() {
  const me = await requireMe();
  const t = getMessages();
  if (!hasAny(me, ['user.manage'])) {
    return <AppFrame me={me} title={t.users.title}><NoAccess /></AppFrame>;
  }
  const [users, locations] = await Promise.all([load<UserRow[]>('/users', []), load<Location[]>('/locations', [])]);
  const placeName = (id: string | null) => (id === null ? t.users.allLocations : (locations.find((l) => l.id === id)?.name ?? id));
  const u = t.users;

  return (
    <AppFrame me={me} title={u.title}>
      <section aria-labelledby="add-person" className="mb-10 rounded-md border-2 border-current p-4">
        <h2 id="add-person" className="mb-4 text-2xl font-bold">{u.add}</h2>
        <ActionForm action={createUserAction} label={u.create} working={t.admin.working} className="grid gap-4 md:grid-cols-2">
          <Field name="displayName" label={u.name} required autoComplete="off" />
          <Field name="phone" label={u.phone} required type="tel" inputMode="tel" autoComplete="off" />
          <Field name="password" label={u.password} hint={u.passwordHint} type="password" autoComplete="new-password" />
          <Field name="pin" label={u.pin} hint={u.pinHint} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" />
        </ActionForm>
      </section>

      <ul className="flex flex-col gap-6">
        {users.map((user) => {
          // Phones are unique within an organisation. The API refuses self-changes anyway; this hides the controls.
          const isMe = user.phone === me.phone;
          return (
          <li key={user.id} className="rounded-md border-2 border-current p-4">
            <h2 className="text-xl font-bold">{user.displayName}</h2>
            <p>
              {user.phone} · {user.status === 'active' ? u.active : `⛔ ${u.disabled}`} ·{' '}
              {user.mfaEnabled ? `🔐 ${u.mfaOn}` : u.mfaOff}
            </p>
            <h3 className="mt-3 font-semibold">{u.roles}</h3>
            {user.roles.length === 0 ? (
              <p>{u.noRoles}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2">
                {user.roles.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3">
                    <span>
                      {ROLES[r.role as keyof typeof ROLES]?.label ?? r.role} ({placeName(r.locationId)})
                    </span>
                    {isMe ? null : (
                      <ActionForm
                        action={revokeRoleAction.bind(null, user.id, r.id)}
                        label={u.revoke}
                        working={t.admin.working}
                        secondary
                        className="flex items-center gap-2"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {isMe ? (
              <p className="mt-4">{u.yourself}</p>
            ) : (
            <details className="mt-4">
              <summary className="cursor-pointer font-semibold underline underline-offset-4">{u.manage}</summary>
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <ActionForm action={grantRoleAction.bind(null, user.id)} label={u.grant} working={t.admin.working}>
                  <Select name="role" label={u.role} id={`role-${user.id}`} required>
                    {GRANTABLE.map((r) => (
                      <option key={r} value={r}>{ROLES[r].label}</option>
                    ))}
                  </Select>
                  <Select name="locationId" label={u.location} id={`loc-${user.id}`}>
                    <option value="">{u.allLocations}</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </Select>
                </ActionForm>
                <ActionForm action={setPinAction.bind(null, user.id)} label={u.setPin} working={t.admin.working}>
                  <Field name="pin" id={`pin-${user.id}`} label={u.pin} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="off" />
                </ActionForm>
                <ActionForm action={resetPasswordAction.bind(null, user.id)} label={u.resetPassword} working={t.admin.working}>
                  <Field name="password" id={`pw-${user.id}`} label={u.password} type="password" required autoComplete="new-password" minLength={12} />
                </ActionForm>
                <div className="flex flex-col gap-4">
                  <ActionForm action={resetMfaAction.bind(null, user.id)} label={u.resetMfa} working={t.admin.working} secondary />
                  <ActionForm
                    action={setStatusAction.bind(null, user.id, user.status === 'active' ? 'disabled' : 'active')}
                    label={user.status === 'active' ? u.disable : u.enable}
                    working={t.admin.working}
                    secondary
                  />
                </div>
              </div>
            </details>
            )}
          </li>
          );
        })}
      </ul>
    </AppFrame>
  );
}