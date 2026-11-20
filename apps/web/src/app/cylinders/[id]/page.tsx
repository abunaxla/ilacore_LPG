import { can, TAG_RETIRE_REASONS } from '@ilacore/domain';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { ActionForm } from '@/components/action-form';
import { AppFrame } from '@/components/app-frame';
import { Field, Select } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { errorText, getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';
import { replaceTagAction } from '../actions';
import { showPlate } from '../../trips/data';
import { groupEpc, showDate, showTime, type CylinderDetail } from '../data';

type Params = Promise<{ id: string }>;

export default function CylinderPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Loading />}>
      <Cylinder params={params} />
    </Suspense>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col border-b border-current py-2 sm:flex-row sm:gap-4">
      <dt className="font-semibold sm:w-56">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

async function Cylinder({ params }: { params: Params }) {
  const me = await requireMe();
  const t = getMessages();
  const c = t.cylinder;
  const cs = t.cylinders;
  const { id } = await params;
  const reply = await api<CylinderDetail>(`/cylinders/${encodeURIComponent(id)}`, { token: await getToken() });
  if (!reply.ok) {
    return (
      <AppFrame me={me} title={c.title}>
        <p role="alert" className="mb-6 rounded-md border-2 border-current p-4">{errorText(reply.error)}</p>
        <Link href="/cylinders" className="underline underline-offset-4">{c.back}</Link>
      </AppFrame>
    );
  }
  const cyl = reply.data;
  const canReplace = hasAny(me, ['item.replace_tag']) && can(me.roles, 'item.replace_tag', cyl.custody.locationId ?? undefined);

  return (
    <AppFrame me={me} title={cyl.serial ? c.titleWithSerial(cyl.serial) : c.title}>
      <p className="mb-6">
        <Link href="/cylinders" className="underline underline-offset-4">{c.back}</Link>
      </p>

      <section aria-labelledby="now" className="mb-8">
        <h2 id="now" className="mb-3 text-2xl font-bold">{c.now}</h2>
        <dl>
          <Row label={c.fill}>{cs.physical[cyl.physicalState]}</Row>
          <Row label={c.where}>
            {cs.custody[cyl.custody.kind as keyof typeof cs.custody]}
            {cyl.custody.locationName ? `: ${cyl.custody.locationName}` : ''}
            {cyl.custody.trip ? (
              <>
                {': '}
                <Link href={`/trips/${cyl.custody.trip.id}`} className="underline underline-offset-4">
                  {showPlate(cyl.custody.trip.vehicleReg)}
                </Link>
              </>
            ) : null}
          </Row>
          <Row label={c.safety}>{cs.safetyStates[cyl.safety]}</Row>
          {cyl.security !== undefined ? <Row label={c.security}>{cyl.security}</Row> : null}
        </dl>
      </section>

      <section aria-labelledby="details" className="mb-8">
        <h2 id="details" className="mb-3 text-2xl font-bold">{c.details}</h2>
        <dl>
          <Row label={c.size}>{cyl.size.name}</Row>
          <Row label={c.serial}>{cyl.serial ?? cs.noSerial}</Row>
          <Row label={c.manufacturer}>{cyl.manufacturer ?? cs.unknownDate}</Row>
          <Row label={c.manufacturedOn}>{cyl.manufacturedOn ? showDate(cyl.manufacturedOn) : cs.unknownDate}</Row>
          <Row label={c.tare}>{cyl.tareKg !== null ? `${cyl.tareKg} kg` : cs.unknownDate}</Row>
          <Row label={c.registered}>{showTime(cyl.registeredAt)}</Row>
        </dl>
      </section>

      <section aria-labelledby="tags" className="mb-8">
        <h2 id="tags" className="mb-3 text-2xl font-bold">{c.tags}</h2>
        <ul className="flex flex-col gap-2">
          {cyl.tags.map((tag) => (
            <li key={tag.epc} className="rounded-md border-2 border-current p-3">
              <span className="font-mono">{groupEpc(tag.epc)}</span>
              {' · '}
              {tag.retiredAt
                ? `⛔ ${c.tagRetired(c.retireReasons[tag.retireReason as keyof typeof c.retireReasons] ?? tag.retireReason ?? '')}, ${showTime(tag.retiredAt)}`
                : `✓ ${c.tagActive}`}
            </li>
          ))}
        </ul>
        {canReplace ? (
          <details className="mt-4 rounded-md border-2 border-current p-4">
            <summary className="min-h-11 cursor-pointer text-lg font-semibold">{c.replaceTag}</summary>
            <p className="my-3">{c.replaceIntro}</p>
            <ActionForm action={replaceTagAction.bind(null, cyl.id)} label={c.replaceSubmit} working={c.replacing} className="grid gap-4 md:grid-cols-2">
              <Field name="epc" label={c.newEpc} hint={t.registerCylinder.epcHint} required autoComplete="off" spellCheck={false} />
              <Select name="reason" label={c.reason} required defaultValue="damaged">
                {TAG_RETIRE_REASONS.map((r) => <option key={r} value={r}>{c.retireReasonOptions[r]}</option>)}
              </Select>
            </ActionForm>
          </details>
        ) : null}
      </section>

      <section aria-labelledby="history">
        <h2 id="history" className="mb-3 text-2xl font-bold">{c.history}</h2>
        <ol className="flex flex-col gap-2">
          {cyl.history.map((h, i) => (
            <li key={`${h.type}-${i}`} className="border-l-4 border-current pl-3">
              <p className="font-semibold">{c.events[h.type] ?? h.type}</p>
              <p>
                {showTime(h.occurredAt)}
                {h.actor ? ` · ${c.by} ${h.actor}` : ''}
                {h.type === 'item.tag_replaced' && typeof h.payload['newEpc'] === 'string' ? ` · ${groupEpc(h.payload['newEpc'])}` : ''}
                {(h.type === 'item.dispatched' || h.type === 'item.returned') && typeof h.payload['vehicleReg'] === 'string'
                  ? ` · ${showPlate(h.payload['vehicleReg'])}`
                  : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </AppFrame>
  );
}
