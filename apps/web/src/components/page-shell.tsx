import type { ReactNode } from 'react';
import { getMessages } from '@/i18n';

/** Page frame: product name on top, one main landmark for the skip link, readable width. */
export function PageShell({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  const t = getMessages();
  return (
    <>
      <header className="border-b-2 border-current">
        <div className={`mx-auto flex w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} items-center px-4 py-3`}>
          <span className="text-xl font-bold tracking-wide">{t.app.name}</span>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={`mx-auto w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} flex-1 px-4 py-8`}>
        <h1 className="mb-6 text-3xl font-bold">{title}</h1>
        {children}
      </main>
    </>
  );
}

export function Loading() {
  return <p role="status">{getMessages().app.loading}</p>;
}