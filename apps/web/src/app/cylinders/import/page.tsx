import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { requireMe } from '@/lib/auth';
import { load, type Location } from '../../admin/data';
import { placesFor, type CylinderSettings } from '../data';
import { ImportForm } from './import-form';

export default function ImportCylindersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ImportCylinders />
    </Suspense>
  );
}

async function ImportCylinders() {
  const me = await requireMe();
  const t = getMessages();
  const m = t.importCylinders;
  const [locations, settings] = await Promise.all([
    load<Location[]>('/locations', []),
    load<CylinderSettings>('/cylinder-settings', { retestIntervalMonths: null, sizes: [] }),
  ]);
  const { places } = placesFor(me, ['item.register'], locations);
  if (places.length === 0) return <AppFrame me={me} title={m.title}><NoAccess /></AppFrame>;

  return (
    <AppFrame me={me} title={m.title}>
      <p className="mb-6">
        <Link href="/cylinders" className="underline underline-offset-4">{t.cylinder.back}</Link>
      </p>
      <p className="mb-4">{m.intro}</p>
      <h2 className="text-xl font-bold">{m.columns}</h2>
      <p className="mb-2">{m.columnsList}</p>
      <p className="mb-6">
        {t.cylinders.size}: {settings.sizes.filter((s) => !s.retired).map((s) => s.name).join(', ')}
      </p>
      <ImportForm places={places.map((p) => ({ id: p.id, name: p.name }))} />
    </AppFrame>
  );
}
