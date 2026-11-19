import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { Field, Select } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { createLocationAction } from '../actions';
import { load, type Location } from '../data';

export default function LocationsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Locations />
    </Suspense>
  );
}

async function Locations() {
  const me = await requireMe();
  const t = getMessages();
  const l = t.locations;
  if (!hasAny(me, ['settings.manage', 'user.manage', 'device.manage'])) {
    return <AppFrame me={me} title={l.title}><NoAccess /></AppFrame>;
  }
  const locations = await load<Location[]>('/locations', []);
  return (
    <AppFrame me={me} title={l.title}>
      {hasAny(me, ['settings.manage']) ? (
        <section aria-labelledby="add-location" className="mb-10 rounded-md border-2 border-current p-4">
          <h2 id="add-location" className="mb-4 text-2xl font-bold">{l.add}</h2>
          <ActionForm action={createLocationAction} label={l.create} working={t.admin.working} className="grid gap-4 md:grid-cols-2">
            <Field name="name" label={l.name} required autoComplete="off" />
            <Select name="kind" label={l.kind} required>
              {Object.entries(l.kinds).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </ActionForm>
        </section>
      ) : (
        <p className="mb-6">{l.ownerAdds}</p>
      )}
      {locations.length === 0 ? (
        <p>{l.empty}</p>
      ) : (
        <ul className="list-disc pl-6">
          {locations.map((loc) => (
            <li key={loc.id}>
              {loc.name} ({l.kinds[loc.kind as keyof typeof l.kinds] ?? loc.kind})
            </li>
          ))}
        </ul>
      )}
    </AppFrame>
  );
}