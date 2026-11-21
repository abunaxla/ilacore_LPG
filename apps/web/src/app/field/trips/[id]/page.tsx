import Link from 'next/link';
import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { buttonClass, Field } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { errorText, getMessages } from '@/i18n';
import { api } from '@/lib/api';
import { requireFieldMe } from '@/lib/field-session';
import type { CustomerSummary } from '../../../customers/data';
import { showPlate, type TripDetail, type TripLine } from '../../../trips/data';
import { signLoadAction, startHandoverAction } from '../../actions';
import { FieldFrame } from '../../field-frame';

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default function FieldTripPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading />}>
      <FieldTrip params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function FieldTrip({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { me, token } = await requireFieldMe();
  const f = getMessages().field;
  const { id } = await params;
  const sp = await searchParams;
  const q = typeof sp['q'] === 'string' ? sp['q'].trim() : '';
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
  const shops = trip.status === 'out' && !live && q ? await api<CustomerSummary[]>(`/customers?search=${encodeURIComponent(q)}`, { token }) : null;

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
          <form method="get" action={`/field/trips/${trip.id}`} className="mb-4 flex flex-col gap-3">
            <Field name="q" label={f.findShop} defaultValue={q} autoComplete="off" required />
            <div>
              <button type="submit" className={buttonClass}>{f.find}</button>
            </div>
          </form>
          {shops && !shops.ok ? <p role="alert">{errorText(shops.error)}</p> : null}
          {shops?.ok && shops.data.length === 0 ? <p role="status">{f.noShops}</p> : null}
          {shops?.ok && shops.data.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {shops.data.map((s) => (
                <li key={s.id} className="rounded-md border-2 border-current p-3">
                  <p className="font-semibold">{s.name}</p>
                  <p className="mb-2">
                    {s.area ? `${s.area} · ` : ''}<span className="font-mono">{s.labelCode}</span>
                    {s.phoneVerified ? '' : ` · ${f.notChecked}`}
                  </p>
                  {s.phoneVerified ? (
                    <ActionForm action={startHandoverAction.bind(null, trip.id, s.id)} label={f.start} working={f.starting} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
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
