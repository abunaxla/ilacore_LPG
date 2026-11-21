import Link from 'next/link';
import { Suspense } from 'react';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { api } from '@/lib/api';
import { requireFieldMe } from '@/lib/field-session';
import { showPlate, type TripSummary } from '../trips/data';
import { FieldFrame } from './field-frame';

/** The driver's start screen: their trips that are being loaded or are out. */
export default function FieldHome() {
  return (
    <Suspense fallback={<Loading />}>
      <Trips />
    </Suspense>
  );
}

async function Trips() {
  const { me, token } = await requireFieldMe();
  const f = getMessages().field;
  if (!me.permissions.includes('handover.perform')) {
    return <FieldFrame name={me.displayName} title={f.trips}><p>{f.notDriver}</p></FieldFrame>;
  }
  const reply = await api<TripSummary[]>('/trips', { token });
  // A driver is only ever shown their own trips by the API.
  const trips = (reply.ok ? reply.data : []).filter((t) => t.status !== 'cancelled');

  return (
    <FieldFrame name={me.displayName} title={f.trips}>
      {trips.length === 0 ? (
        <p>{f.noTrips}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {trips.map((t) => (
            <li key={t.id}>
              <Link href={`/field/trips/${t.id}`} className="block rounded-md border-2 border-current p-4">
                <span className="block text-xl font-bold">{showPlate(t.vehicleReg)}</span>
                <span className="block">{f.tripStatuses[t.status]} · {t.depot.name}</span>
                <span className="block">{f.onTruck(t.status === 'out' ? t.counts.stillOut : t.counts.loaded)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </FieldFrame>
  );
}
