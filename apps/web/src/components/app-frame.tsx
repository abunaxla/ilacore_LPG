import Link from 'next/link';
import type { ReactNode } from 'react';
import { getMessages } from '@/i18n';
import { hasAny, type Me } from '@/lib/auth';
import { signOutAction } from '@/app/sign-in/actions';
import { secondaryButtonClass } from './fields';

/** Header and navigation for signed-in pages. Links follow the person's permissions; the API still checks every call. */
export function AppFrame({ me, title, children }: { me: Me; title: string; children: ReactNode }) {
  const t = getMessages();
  const links = [
    { href: '/', label: t.app.home, show: true },
    { href: '/admin/users', label: t.admin.users, show: hasAny(me, ['user.manage']) },
    { href: '/admin/devices', label: t.admin.devices, show: hasAny(me, ['device.manage']) },
    { href: '/admin/locations', label: t.admin.locations, show: hasAny(me, ['settings.manage', 'user.manage', 'device.manage']) },
  ].filter((l) => l.show);
  return (
    <>
      <header className="border-b-2 border-current">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-xl font-bold tracking-wide">{t.app.name}</span>
          <nav aria-label="Main" className="flex flex-1 flex-wrap gap-x-4">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center underline underline-offset-4">
                {l.label}
              </Link>
            ))}
          </nav>
          <span className="text-base">{me.displayName}</span>
          <form action={signOutAction}>
            <button type="submit" className={secondaryButtonClass}>{t.app.signOut}</button>
          </form>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-3xl font-bold">{title}</h1>
        {children}
      </main>
    </>
  );
}

export function NoAccess() {
  return <p role="alert" className="rounded-md border-2 border-current p-4">{getMessages().app.noAccess}</p>;
}