import Link from 'next/link';
import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { buttonClass } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { errorText, getMessages } from '@/i18n';
import { api } from '@/lib/api';
import { requireFieldMe } from '@/lib/field-session';
import { showPlate, type TripDetail, type TripLine } from '../../../trips/data';
import { signLoadAction } from '../../actions';
import { FieldFrame } from '../../field-frame';
import { ShopFinder } from './shop-finder';

type Params = Promise<{ id: string }>;

export default function FieldTripPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Loading />}>
      <FieldTrip params={params} />
    </Suspense>
  );
}

async function FieldTrip({ params }: { params: Params }) {
  const { me, token } = await requireFieldMe();
  const f = getMessages().field;
  const { id } = await params;
  const reply = await api<TripDetail>(`/trips/${encodeURIComponent(id)}`, { token });
  if (!reply.ok) {
    return (
      <FieldFrame name={me.displayName} title={f.trips}>
        <p role="alert" className="mb-5 rounded-md border-2 border-current p-3">{errorText(reply.error)}</p>
        <Link href="/field" className="underline underline-offset-4">{f.back}</Link>
      </FieldFrame>
    );
  }
  const trip = reply.data;
  const live = trip.handovers.find((h) => h.status === 'open' || h.status === 'awaiting_confirmation');
  const earlier = trip.handovers.filter((h) => h !== live);

  const lineState = (l: TripLine) => {
    if (l.collected) return f.lineCollected;
    if (l.returnedAt) return f.lineReturned;
    if (l.deliveredAt) return f.lineDelivered;
    return l.physicalState === 'full' ? f.lineFull : f.lineEmpty;
  };
  const lines = trip.lines.filter((l) => !l.removedAt);

  return (
    <FieldFrame name={me.displayName} title={showPlate(trip.vehicleReg)}>
      <p className="mb-2">
        <Link href="/field" className="underline underline-offset-4">{f.back}</Link>
      </p>
      <p className="mb-5 text-lg">{f.tripStatuses[trip.status]} · {trip.depot.name}</p>

      {trip.status === 'loading' ? (
        <section aria-labelledby="sign" className="mb-6 rounded-md border-2 border-current p-4">
          <h2 id="sign" className="mb-2 text-xl font-bold">{f.loadTitle}</h2>
          {trip.counts.needsApproval > 0 ? (
            <p className="font-semibold">{f.waitingApproval(trip.counts.needsApproval)}</p>
          ) : (
            <>
              <p className="mb-3">{f.signHint}</p>
              <ActionForm action={signLoadAction.bind(null, trip.id)} label={f.signLoad(trip.counts.loaded)} working={f.signingLoad} />
            </>
          )}
        </section>
      ) : null}

      {trip.status === 'out' && live ? (
        <section aria-labelledby="live" className="mb-6 rounded-md border-2 border-current p-4">
          <h2 id="live" className="mb-2 text-xl font-bold">{f.inProgress}</h2>
          <p className="mb-3">{live.customer.name} · {f.statuses[live.status]}</p>
          <Link href={`/field/handovers/${live.id}`} className={buttonClass}>{f.continue}</Link>
        </section>
      ) : null}

      {trip.status === 'out' && !live ? (
        <section aria-labelledby="handover" className="mb-6 rounded-md border-2 border-current p-4">
          <h2 id="handover" className="mb-3 text-xl font-bold">{f.handOver}</h2>
          <ShopFinder tripId={trip.id} />
        </section>
      ) : null}

      <section aria-labelledby="load" className="mb-6">
        <h2 id="load" className="mb-2 text-xl font-bold">{f.cylinders}</h2>
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={`${l.itemId}-${l.addedAt}`} className="rounded-md border-2 border-current p-2">
              {l.cylinder.serial ?? '—'} · {l.cylinder.size} · {lineState(l)}
            </li>
          ))}
        </ul>
      </section>

      {earlier.length > 0 ? (
        <section aria-labelledby="earlier">
          <h2 id="earlier" className="mb-2 text-xl font-bold">{f.earlier}</h2>
          <ul className="flex flex-col gap-2">
            {earlier.map((h) => (
              <li key={h.id}>
                <Link href={`/field/handovers/${h.id}`} className="block rounded-md border-2 border-current p-2">
                  {h.customer.name} · {f.statuses[h.status]} · {f.ref} {h.ref}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </FieldFrame>
  );
}
