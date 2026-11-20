import { can } from '@ilacore/domain';
import Link from 'next/link';
import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { AppFrame } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { errorText, getMessages } from '@/i18n';
import { requireMe } from '@/lib/auth';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';
import { groupEpc, showTime } from '../../cylinders/data';
import { approveLineAction, cancelTripAction } from '../actions';
import { showPlate, type TripDetail, type TripLine } from '../data';

type Params = Promise<{ id: string }>;

export default function TripPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Loading />}>
      <Trip params={params} />
    </Suspense>
  );
}

async function Trip({ params }: { params: Params }) {
  const me = await requireMe();
  const t = getMessages();
  const s = t.trips;
  const { id } = await params;
  const reply = await api<TripDetail>(`/trips/${encodeURIComponent(id)}`, { token: await getToken() });
  if (!reply.ok) {
    return (
      <AppFrame me={me} title={s.title}>
        <p role="alert" className="mb-6 rounded-md border-2 border-current p-4">{errorText(reply.error)}</p>
        <Link href="/trips" className="underline underline-offset-4">{s.back}</Link>
      </AppFrame>
    );
  }
  const trip = reply.data;
  const loading = trip.status === 'loading';
  // Menus only; the API decides (including separation of duties).
  const canApprove = loading && can(me.roles, 'dispatch.approve_exception', trip.depot.id);
  const canCancel = loading && (canApprove || can(me.roles, 'dispatch.scan', trip.depot.id));
  const live = trip.lines.filter((l) => !l.removedAt);
  const removed = trip.lines.filter((l) => l.removedAt);

  const check = (l: TripLine) => {
    if (!l.exception) return s.ok;
    return l.approvedBy ? `${s.exceptions[l.exception]} · ${s.approvedBy(l.approvedBy)}` : s.exceptions[l.exception];
  };
  const where = (l: TripLine) => {
    if (l.returnedAt) return `${s.returned(t.cylinders.physical[l.returnedState ?? 'empty'])} · ${showTime(l.returnedAt)}`;
    return trip.status === 'out' ? s.onTruck : s.notSigned;
  };

  return (
    <AppFrame me={me} title={`${showPlate(trip.vehicleReg)} · ${trip.driver.name}`}>
      <p className="mb-6">
        <Link href="/trips" className="underline underline-offset-4">{s.back}</Link>
      </p>
      <p className="mb-2">
        {s.statuses[trip.status]} · {trip.depot.name} · {s.opened} {showTime(trip.openedAt)} {s.openedBy} {trip.openedBy}
      </p>
      <p className="mb-6">{trip.signedAt ? `${s.signed}: ${showTime(trip.signedAt)}` : s.notSigned}</p>
      {trip.note ? <p className="mb-6 italic">{trip.note}</p> : null}

      <section aria-labelledby="counts" className="mb-8">
        <h2 id="counts" className="mb-3 text-2xl font-bold">{s.counts}</h2>
        <dl className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {[
            [s.countLoaded, trip.counts.loaded],
            [s.countWaiting, trip.counts.needsApproval],
            [s.countBack, trip.counts.back],
            [s.countOut, trip.counts.stillOut],
          ].map(([label, n]) => (
            <div key={String(label)} className="rounded-md border-2 border-current p-3">
              <dt>{label}</dt>
              <dd className="text-3xl font-bold">{n}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="lines" className="mb-8">
        <h2 id="lines" className="mb-3 text-2xl font-bold">{s.lines}</h2>
        {live.length === 0 ? (
          <p>{s.none}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {live.map((l) => (
              <li key={l.itemId} className="rounded-md border-2 border-current p-3">
                <p className="flex flex-wrap gap-x-4">
                  <Link href={`/cylinders/${l.itemId}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                    {l.cylinder.serial ?? s.noSerial} · {l.cylinder.size}
                  </Link>
                  <span className="inline-flex items-center font-mono">{groupEpc(l.epc)}</span>
                </p>
                <p>
                  {t.cylinders.physical[l.physicalState]} · <span className={l.exception && !l.approvedBy ? 'font-semibold' : ''}>{check(l)}</span> · {where(l)}
                </p>
                {canApprove && l.exception && !l.approvedBy ? (
                  <div className="mt-2">
                    <ActionForm action={approveLineAction.bind(null, trip.id, l.itemId)} label={s.approve} working={s.approving} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {removed.length > 0 ? (
        <section aria-labelledby="removed" className="mb-8">
          <h2 id="removed" className="mb-3 text-2xl font-bold">{s.removedLines}</h2>
          <ul className="list-disc pl-6">
            {removed.map((l) => (
              <li key={`${l.itemId}-${l.removedAt}`}>
                {l.cylinder.serial ?? s.noSerial} · {l.cylinder.size} · <span className="font-mono">{groupEpc(l.epc)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canCancel ? (
        <section aria-labelledby="cancel" className="rounded-md border-2 border-current p-4">
          <h2 id="cancel" className="mb-2 text-xl font-bold">{s.cancel}</h2>
          <p className="mb-3">{s.cancelHint}</p>
          <ActionForm action={cancelTripAction.bind(null, trip.id)} label={s.cancel} working={s.cancelling} secondary />
        </section>
      ) : null}
    </AppFrame>
  );
}
