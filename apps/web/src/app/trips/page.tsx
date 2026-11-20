import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { buttonClass, Select } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { load, type Location } from '../admin/data';
import { placesFor, showTime } from '../cylinders/data';
import { showPlate, TRIP_VIEWERS, type TripStatus, type TripSummary } from './data';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function TripsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Loading />}>
      <Trips searchParams={searchParams} />
    </Suspense>
  );
}

const STATUSES: TripStatus[] = ['loading', 'out', 'cancelled'];

async function Trips({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireMe();
  const t = getMessages();
  const s = t.trips;
  if (!hasAny(me, TRIP_VIEWERS)) return <AppFrame me={me} title={s.title}><NoAccess /></AppFrame>;

  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '');
  const locations = await load<Location[]>('/locations', []);
  const { places } = placesFor(me, TRIP_VIEWERS, locations.filter((l) => l.kind === 'depot'));
  const depotId = places.some((p) => p.id === one('depotId')) ? one('depotId') : '';
  const status = STATUSES.includes(one('status') as TripStatus) ? one('status') : '';
  const query = new URLSearchParams({ ...(depotId ? { depotId } : {}), ...(status ? { status } : {}) });
  const trips = await load<TripSummary[]>(`/trips${query.size ? `?${query}` : ''}`, []);

  return (
    <AppFrame me={me} title={s.title}>
      <p className="mb-6">{s.intro}</p>
      <form method="get" className="mb-8 grid gap-4 rounded-md border-2 border-current p-4 md:grid-cols-3 md:items-end">
        <Select name="depotId" label={s.depot} defaultValue={depotId}>
          <option value="">{s.anyDepot}</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select name="status" label={s.status} defaultValue={status}>
          <option value="">{s.anyStatus}</option>
          {STATUSES.map((x) => <option key={x} value={x}>{s.statuses[x]}</option>)}
        </Select>
        <div>
          <button type="submit" className={buttonClass}>{s.show}</button>
        </div>
      </form>

      {trips.length === 0 ? (
        <p>{s.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {trips.map((x) => (
            <li key={x.id} className="rounded-md border-2 border-current p-4">
              <h2 className="text-xl font-bold">
                <Link href={`/trips/${x.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                  {showPlate(x.vehicleReg)} · {x.driver.name}
                </Link>
              </h2>
              <p>
                {s.statuses[x.status]} · {x.depot.name} · {s.opened} {showTime(x.openedAt)}
              </p>
              <p>
                {s.loaded(x.counts.loaded)}
                {x.status === 'out' ? ` · ${s.countBack}: ${x.counts.back} · ${s.countOut}: ${x.counts.stillOut}` : ''}
              </p>
              {x.counts.needsApproval > 0 && x.status === 'loading' ? (
                <p className="font-semibold">{s.needsApproval(x.counts.needsApproval)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </AppFrame>
  );
}
