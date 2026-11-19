import { ROLES } from '@ilacore/domain';
import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { load, type Location } from './admin/data';

export default function HomePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const me = await requireMe();
  const t = getMessages();
  const locations = hasAny(me, ['settings.manage', 'user.manage', 'device.manage'])
    ? await load<Location[]>('/locations', [])
    : [];
  const placeName = (id: string | null) =>
    id === null ? t.home.everywhere : (locations.find((l) => l.id === id)?.name ?? id);

  return (
    <AppFrame me={me} title={`${t.home.heading}, ${me.displayName}`}>
      <section aria-labelledby="roles" className="mb-8">
        <h2 id="roles" className="mb-2 text-2xl font-bold">{t.home.roles}</h2>
        {me.roles.length === 0 ? (
          <p>{t.home.noRoles}</p>
        ) : (
          <ul className="list-disc pl-6">
            {me.roles.map((r) => (
              <li key={`${r.role}:${r.locationId ?? 'all'}`}>
                {ROLES[r.role].label} ({placeName(r.locationId)})
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mb-6">{t.home.comingSoon}</p>
      <p>
        <Link href="/change-password" className="underline underline-offset-4">{t.password.link}</Link>
      </p>
    </AppFrame>
  );
}