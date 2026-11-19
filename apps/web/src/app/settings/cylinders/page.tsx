import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { Field } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { load } from '../../admin/data';
import { addSizeAction, retireSizeAction, setRetestIntervalAction } from '../../cylinders/actions';
import type { CylinderSettings } from '../../cylinders/data';

export default function CylinderSettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const me = await requireMe();
  const t = getMessages();
  const s = t.cylinderSettings;
  if (!hasAny(me, ['settings.manage'])) return <AppFrame me={me} title={s.title}><NoAccess /></AppFrame>;
  const settings = await load<CylinderSettings | null>('/cylinder-settings', null);
  if (!settings) return <AppFrame me={me} title={s.title}><p role="alert">{t.errors.unknown}</p></AppFrame>;

  return (
    <AppFrame me={me} title={s.title}>
      <section aria-labelledby="sizes" className="mb-10">
        <h2 id="sizes" className="mb-2 text-2xl font-bold">{s.sizes}</h2>
        <p className="mb-4">{s.sizesIntro}</p>
        <ul className="mb-6 flex flex-col gap-3">
          {settings.sizes.map((size) => (
            <li key={size.id} className="flex flex-wrap items-center gap-4 rounded-md border-2 border-current p-3">
              <span className="flex-1 text-lg">
                <strong>{size.name}</strong> · {size.nominalFillKg} kg
              </span>
              {size.retired ? (
                <span className="font-semibold">⛔ {s.retired}</span>
              ) : (
                <ActionForm action={retireSizeAction.bind(null, size.id)} label={s.retire} working={t.admin.working} secondary />
              )}
            </li>
          ))}
        </ul>
        <div className="rounded-md border-2 border-current p-4">
          <h3 className="mb-4 text-xl font-bold">{s.addSize}</h3>
          <ActionForm action={addSizeAction} label={s.add} working={t.admin.working} className="grid gap-4 md:grid-cols-2">
            <Field name="name" label={s.sizeName} hint={s.sizeNameHint} required maxLength={30} autoComplete="off" />
            <Field name="nominalFillKg" label={s.fillKg} required inputMode="decimal" autoComplete="off" />
          </ActionForm>
        </div>
      </section>

      <section aria-labelledby="interval" className="rounded-md border-2 border-current p-4">
        <h2 id="interval" className="mb-2 text-2xl font-bold">{s.interval}</h2>
        <p className="mb-2">{s.intervalIntro}</p>
        {settings.retestIntervalMonths === null ? <p className="mb-4 font-semibold">{s.intervalNotSet}</p> : null}
        <ActionForm action={setRetestIntervalAction} label={s.saveInterval} working={t.admin.working}>
          <Field
            name="months"
            label={s.months}
            hint={s.monthsHint}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            defaultValue={settings.retestIntervalMonths ?? ''}
            autoComplete="off"
          />
        </ActionForm>
      </section>
    </AppFrame>
  );
}
