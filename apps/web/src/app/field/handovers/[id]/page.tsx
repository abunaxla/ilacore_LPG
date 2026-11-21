import Link from 'next/link';
import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { buttonClass, Field, secondaryButtonClass } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { errorText, getMessages } from '@/i18n';
import { api } from '@/lib/api';
import { requireFieldMe } from '@/lib/field-session';
import type { HandoverSummary } from '../../../trips/data';
import {
  askOwedAction,
  cancelHandoverAction,
  confirmCodeAction,
  disputeAction,
  removeLineAction,
  resendCodeAction,
  scanAction,
  sendCodeAction,
  setBoughtAction,
} from '../../actions';
import { FieldFrame } from '../../field-frame';
import { ScanForm } from './scan-form';
import { SendCodeForm } from './send-code-form';

interface HandoverDetail extends HandoverSummary {
  trip: { id: string; vehicleReg: string; depotId: string };
  code: { expiresAt: string; freshCodeLeft: boolean } | null;
  foreignTags: number;
  lines: { itemId: string; epc: string; direction: 'out' | 'in'; soldOutright: boolean; cylinder: { serial: string | null; size: string } }[];
}

type Params = Promise<{ id: string }>;

/** Shows Kenyan time as 14:05, for the code's deadline. */
const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' }).format(new Date(iso));

/** Today in Kenya plus `days`, as yyyy-mm-dd for a date field. */
const kenyaDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(Date.now() + days * 86_400_000));

export default function FieldHandoverPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Loading />}>
      <FieldHandover params={params} />
    </Suspense>
  );
}

async function FieldHandover({ params }: { params: Params }) {
  const { me, token } = await requireFieldMe();
  const f = getMessages().field;
  const { id } = await params;
  const reply = await api<HandoverDetail>(`/handovers/${encodeURIComponent(id)}`, { token });
  if (!reply.ok) {
    return (
      <FieldFrame name={me.displayName} title={f.handOver}>
        <p role="alert" className="mb-5 rounded-md border-2 border-current p-3">{errorText(reply.error)}</p>
        <Link href="/field" className="underline underline-offset-4">{f.back}</Link>
      </FieldFrame>
    );
  }
  const h = reply.data;
  const b = h.balance;
  const out = h.lines.filter((l) => l.direction === 'out');
  const ins = h.lines.filter((l) => l.direction === 'in');
  const approvedOwed = h.owed?.approvedBy ? h.owed.count : 0;
  const stillUncovered = Math.max(0, b.uncovered - approvedOwed);

  return (
    <FieldFrame name={me.displayName} title={h.customer.name}>
      <p className="mb-2">
        <Link href={`/field/trips/${h.trip.id}`} className="underline underline-offset-4">{f.backToTrip}</Link>
      </p>
      <p className="mb-5 text-lg">
        {f.statuses[h.status]} · {f.ref} <span className="font-mono">{h.ref}</span>
      </p>

      <section aria-labelledby="balance" className="mb-6 rounded-md border-2 border-current p-4">
        <h2 id="balance" className="mb-2 text-xl font-bold">{f.balance}</h2>
        <dl className="grid grid-cols-2 gap-2">
          {[
            [f.fullOut, b.fullOut],
            [f.bought, b.soldOutright],
            [f.emptyIn, b.emptyIn],
            [f.uncovered, stillUncovered],
          ].map(([label, n]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd className={`text-3xl font-bold ${label === f.uncovered && Number(n) > 0 ? 'underline' : ''}`}>{n}</dd>
            </div>
          ))}
        </dl>
        {h.owed ? (
          <p className={`mt-3 ${h.owed.approvedBy ? '' : 'font-semibold'}`}>
            {h.owed.approvedBy ? f.owedApproved(h.owed.count, h.owed.dueOn, h.owed.approvedBy) : f.owedWaiting(h.owed.count, h.owed.dueOn)}
          </p>
        ) : null}
      </section>

      {h.status === 'open' ? (
        <>
          <section aria-label={f.scanTitle} className="mb-6">
            <ScanForm action={scanAction.bind(null, h.id)} />
          </section>

          <section aria-labelledby="lines" className="mb-6">
            <h2 id="lines" className="mb-2 text-xl font-bold">{f.goingOut}</h2>
            {out.length === 0 ? <p className="mb-4">{f.nothingYet}</p> : null}
            <ul className="mb-5 flex flex-col gap-2">
              {out.map((l) => (
                <li key={l.itemId} className="rounded-md border-2 border-current p-3">
                  <p className="mb-2">
                    {l.cylinder.serial ?? '—'} · {l.cylinder.size}
                    {l.soldOutright ? <span className="font-semibold"> · {f.bought}</span> : null}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <ActionForm
                      action={setBoughtAction.bind(null, h.id, l.itemId, !l.soldOutright)}
                      label={l.soldOutright ? f.unmarkBought : f.markBought}
                      working="…"
                      secondary
                    />
                    <ActionForm action={removeLineAction.bind(null, h.id, l.itemId)} label={f.remove} working="…" secondary />
                  </div>
                </li>
              ))}
            </ul>
            <h2 className="mb-2 text-xl font-bold">{f.comingIn}</h2>
            {ins.length === 0 ? <p>{f.nothingYet}</p> : null}
            <ul className="flex flex-col gap-2">
              {ins.map((l) => (
                <li key={l.itemId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-current p-3">
                  <span>{l.cylinder.serial ?? '—'} · {l.cylinder.size}</span>
                  <ActionForm action={removeLineAction.bind(null, h.id, l.itemId)} label={f.remove} working="…" secondary />
                </li>
              ))}
            </ul>
          </section>

          {b.uncovered > 0 && !h.owed?.approvedBy ? (
            <section aria-labelledby="owed" className="mb-6 rounded-md border-2 border-current p-4">
              <h2 id="owed" className="mb-2 text-xl font-bold">{f.owedTitle}</h2>
              <p className="mb-3">{f.owedIntro(b.uncovered)}</p>
              {h.owed ? (
                <Link href={`/field/handovers/${h.id}`} className={secondaryButtonClass}>{f.refresh}</Link>
              ) : (
                <ActionForm action={askOwedAction.bind(null, h.id)} label={f.askOwed} working={f.askingOwed}>
                  <Field name="dueOn" label={f.dueOn} type="date" required min={kenyaDate(0)} max={kenyaDate(60)} defaultValue={kenyaDate(7)} />
                </ActionForm>
              )}
            </section>
          ) : null}

          {b.fullOut + b.emptyIn > 0 ? (
            <section aria-label={f.sendCode} className="mb-6 rounded-md border-2 border-current p-4">
              <SendCodeForm action={sendCodeAction.bind(null, h.id)} uncovered={stillUncovered} />
            </section>
          ) : null}

          <ActionForm action={cancelHandoverAction.bind(null, h.id)} label={f.cancel} working={f.cancelling} secondary />
        </>
      ) : null}

      {h.status === 'awaiting_confirmation' && h.code ? (
        <>
          <section aria-labelledby="code" className="mb-6 rounded-md border-2 border-current p-4">
            <h2 id="code" className="mb-2 text-xl font-bold">{f.codeTitle}</h2>
            <p className="mb-3">{f.codeIntro(h.ref, clock(h.code.expiresAt))}</p>
            {h.shortfall ? <p className="mb-3 font-semibold">{f.shortfall(h.shortfall)}</p> : null}
            <ActionForm action={confirmCodeAction.bind(null, h.id)} label={f.confirm} working={f.confirming}>
              <Field name="code" label={f.code} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" autoFocus />
            </ActionForm>
            {h.code.freshCodeLeft ? (
              <div className="mt-4">
                <ActionForm action={resendCodeAction.bind(null, h.id)} label={f.resend} working={f.resending} secondary />
              </div>
            ) : null}
          </section>
          <section aria-labelledby="dispute" className="mb-6 rounded-md border-2 border-current p-4">
            <h2 id="dispute" className="mb-2 text-xl font-bold">{f.disputeTitle}</h2>
            <ActionForm action={disputeAction.bind(null, h.id)} label={f.dispute} working={f.disputing} secondary>
              <Field name="note" label={f.disputeNote} required maxLength={300} autoComplete="off" />
            </ActionForm>
          </section>
        </>
      ) : null}

      {h.status === 'confirmed' ? (
        <section role="status" className="mb-6 rounded-md border-2 border-current p-4">
          <h2 className="mb-2 text-xl font-bold">{f.doneTitle}</h2>
          <p>{f.done(b.fullOut - b.soldOutright, b.soldOutright, b.emptyIn)}</p>
        </section>
      ) : null}
      {h.status === 'unconfirmed' ? <p role="status" className="mb-6 font-semibold">{f.endedUnconfirmed}</p> : null}
      {h.status === 'disputed' ? <p role="status" className="mb-6 font-semibold">{f.endedDisputed}</p> : null}
      {h.status === 'cancelled' ? <p role="status" className="mb-6">{f.endedCancelled}</p> : null}
      {h.status !== 'open' && h.status !== 'awaiting_confirmation' ? (
        <Link href={`/field/trips/${h.trip.id}`} className={buttonClass}>{f.backToTrip}</Link>
      ) : null}
    </FieldFrame>
  );
}
