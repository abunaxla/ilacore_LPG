import { PHYSICAL_STATES, SAFETY_STATES } from '@ilacore/domain';
import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { buttonClass, Field, secondaryButtonClass, Select } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { load, type Location } from '../admin/data';
import { showPlate } from '../trips/data';
import { groupEpc, placesFor, type CylinderSettings, type CylinderSummary } from './data';

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = 50;

export default function CylindersPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<Loading />}>
      <Cylinders searchParams={searchParams} />
    </Suspense>
  );
}

async function Cylinders({ searchParams }: { searchParams: Search }) {
  const me = await requireMe();
  const t = getMessages();
  const c = t.cylinders;
  if (!hasAny(me, ['item.view_position', 'item.register'])) {
    return <AppFrame me={me} title={c.title}><NoAccess /></AppFrame>;
  }
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' && sp[k] ? (sp[k] as string) : undefined);

  const [locations, settings] = await Promise.all([
    load<Location[]>('/locations', []),
    load<CylinderSettings>('/cylinder-settings', { sizes: [] }),
  ]);
  const view = placesFor(me, ['item.view_position', 'item.register'], locations);
  const canRegister = placesFor(me, ['item.register'], locations).places.length > 0;
  if (view.places.length === 0 && !view.everywhere) {
    return <AppFrame me={me} title={c.title}><p>{c.noPlaceAccess}</p></AppFrame>;
  }

  // Without an organisation-wide grant, a location is required: default to the first one the person has.
  const requested = one('locationId');
  const locationId = requested && view.places.some((p) => p.id === requested) ? requested : view.everywhere ? undefined : view.places[0]!.id;
  const offset = Math.max(0, Number(one('offset') ?? 0) || 0);
  const query = new URLSearchParams();
  if (locationId) query.set('locationId', locationId);
  for (const k of ['sizeId', 'physicalState', 'safety', 'search']) {
    const v = one(k);
    if (v) query.set(k, v);
  }
  query.set('limit', String(PAGE));
  query.set('offset', String(offset));
  const result = await load<{ total: number; cylinders: CylinderSummary[] } | null>(`/cylinders?${query}`, null);

  const pageLink = (newOffset: number) => {
    const q = new URLSearchParams(query);
    q.delete('limit');
    q.set('offset', String(newOffset));
    return `/cylinders?${q}`;
  };

  return (
    <AppFrame me={me} title={c.title}>
      {canRegister ? (
        <p className="mb-6 flex flex-wrap gap-3">
          <Link href="/cylinders/new" className={buttonClass}>{c.register}</Link>
          <Link href="/cylinders/import" className={secondaryButtonClass}>{c.import}</Link>
        </p>
      ) : null}

      <form method="get" action="/cylinders" aria-labelledby="filters" className="mb-8 rounded-md border-2 border-current p-4">
        <h2 id="filters" className="mb-4 text-2xl font-bold">{c.filters}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Select name="locationId" label={c.location} defaultValue={locationId ?? ''}>
            {view.everywhere ? <option value="">{c.allLocations}</option> : null}
            {view.places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select name="sizeId" label={c.size} defaultValue={one('sizeId') ?? ''}>
            <option value="">{c.anySize}</option>
            {settings.sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select name="physicalState" label={c.state} defaultValue={one('physicalState') ?? ''}>
            <option value="">{c.anyState}</option>
            {PHYSICAL_STATES.map((s) => <option key={s} value={s}>{c.physical[s]}</option>)}
          </Select>
          <Select name="safety" label={c.safety} defaultValue={one('safety') ?? ''}>
            <option value="">{c.anySafety}</option>
            {SAFETY_STATES.map((s) => <option key={s} value={s}>{c.safetyStates[s]}</option>)}
          </Select>
          <Field name="search" label={c.search} hint={c.searchHint} defaultValue={one('search') ?? ''} autoComplete="off" />
        </div>
        <button type="submit" className={`${buttonClass} mt-4`}>{c.apply}</button>
      </form>

      {!result ? (
        <p role="alert">{t.errors.unknown}</p>
      ) : result.cylinders.length === 0 ? (
        <p>{c.none}</p>
      ) : (
        <>
          <p className="mb-3 font-semibold" role="status">
            {c.total(result.total)}
            {result.total > PAGE ? ` · ${c.page(offset + 1, offset + result.cylinders.length, result.total)}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-current">
                  <th scope="col" className="p-2">{c.serial}</th>
                  <th scope="col" className="p-2">{c.size}</th>
                  <th scope="col" className="p-2">{c.state}</th>
                  <th scope="col" className="p-2">{c.safety}</th>
                  <th scope="col" className="p-2">{c.location}</th>
                  <th scope="col" className="p-2">{c.tag}</th>
                </tr>
              </thead>
              <tbody>
                {result.cylinders.map((cyl) => (
                  <tr key={cyl.id} className="border-b border-current">
                    <th scope="row" className="p-2">
                      <Link href={`/cylinders/${cyl.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                        {cyl.serial ?? c.noSerial}
                      </Link>
                    </th>
                    <td className="p-2">{cyl.size.name}</td>
                    <td className="p-2">{c.physical[cyl.physicalState]}</td>
                    <td className="p-2">{c.safetyStates[cyl.safety]}</td>
                    <td className="p-2">
                      {cyl.custody.locationName ??
                        (cyl.custody.trip
                          ? `${c.custody.truck} ${showPlate(cyl.custody.trip.vehicleReg)}`
                          : c.custody[cyl.custody.kind as keyof typeof c.custody])}
                    </td>
                    <td className="p-2 font-mono text-base">{cyl.epc ? groupEpc(cyl.epc) : c.noTag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.total > PAGE ? (
            <nav aria-label={c.title} className="mt-4 flex gap-3">
              {offset > 0 ? <Link href={pageLink(Math.max(0, offset - PAGE))} className={secondaryButtonClass}>{c.previous}</Link> : null}
              {offset + PAGE < result.total ? <Link href={pageLink(offset + PAGE)} className={secondaryButtonClass}>{c.next}</Link> : null}
            </nav>
          ) : null}
        </>
      )}
    </AppFrame>
  );
}
