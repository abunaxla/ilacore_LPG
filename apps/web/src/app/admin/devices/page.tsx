import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { revokeDeviceAction } from '../actions';
import { load, type Location } from '../data';
import { RegisterDevice } from './register-device';

interface DeviceRow {
  id: string;
  name: string;
  kind: 'handheld' | 'reader';
  locationId: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(iso));

export default function DevicesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Devices />
    </Suspense>
  );
}

async function Devices() {
  const me = await requireMe();
  const t = getMessages();
  const d = t.devices;
  if (!hasAny(me, ['device.manage'])) {
    return <AppFrame me={me} title={d.title}><NoAccess /></AppFrame>;
  }
  const [devices, locations] = await Promise.all([load<DeviceRow[]>('/devices', []), load<Location[]>('/locations', [])]);
  const placeName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? id) : d.none);

  return (
    <AppFrame me={me} title={d.title}>
      <section aria-labelledby="add-device" className="mb-10 rounded-md border-2 border-current p-4">
        <h2 id="add-device" className="mb-4 text-2xl font-bold">{d.add}</h2>
        <RegisterDevice locations={locations} />
      </section>
      <ul className="flex flex-col gap-4">
        {devices.map((device) => (
          <li key={device.id} className="flex flex-wrap items-center gap-4 rounded-md border-2 border-current p-4">
            <div className="flex-1">
              <h2 className="text-xl font-bold">{device.name}</h2>
              <p>
                {device.kind === 'handheld' ? d.handheld : d.reader} · {placeName(device.locationId)} · {d.lastSeen}:{' '}
                {device.lastSeenAt ? when(device.lastSeenAt) : d.never}
              </p>
            </div>
            {device.revokedAt ? (
              <p className="font-semibold">⛔ {d.revoked} {when(device.revokedAt)}</p>
            ) : (
              <ActionForm action={revokeDeviceAction.bind(null, device.id)} label={d.revoke} working={t.admin.working} secondary>
                <p className="text-base">{d.revokeHint}</p>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
    </AppFrame>
  );
}