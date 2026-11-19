import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { requireMe } from '@/lib/auth';
import { load, type Location } from '../../admin/data';
import { placesFor, type CylinderSettings } from '../data';
import { RegisterForm } from './register-form';

export default function RegisterCylinderPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RegisterCylinder />
    </Suspense>
  );
}

async function RegisterCylinder() {
  const me = await requireMe();
  const t = getMessages();
  const r = t.registerCylinder;
  const [locations, settings] = await Promise.all([
    load<Location[]>('/locations', []),
    load<CylinderSettings>('/cylinder-settings', { retestIntervalMonths: null, sizes: [] }),
  ]);
  const { places } = placesFor(me, ['item.register'], locations);
  if (places.length === 0) return <AppFrame me={me} title={r.title}><NoAccess /></AppFrame>;

  return (
    <AppFrame me={me} title={r.title}>
      <p className="mb-6">
        <Link href="/cylinders" className="underline underline-offset-4">{t.cylinder.back}</Link>
      </p>
      <p className="mb-6">{r.intro}</p>
      <RegisterForm
        places={places.map((p) => ({ id: p.id, name: p.name }))}
        sizes={settings.sizes.filter((s) => !s.retired).map((s) => ({ id: s.id, name: s.name }))}
        intervalSet={settings.retestIntervalMonths !== null}
      />
    </AppFrame>
  );
}
