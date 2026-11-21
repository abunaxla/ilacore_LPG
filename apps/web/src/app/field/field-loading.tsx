'use client';

import { useEffect, useState } from 'react';
import { getMessages } from '@/i18n';
import { Connection } from './connection';

/**
 * The handheld's loading screen: the same header and outbox status as every handheld screen (so "waiting to send"
 * and "sending" stay visible while a page loads), placeholder blocks where the page will be, and after a few
 * seconds a plain word that the signal is weak and nothing scanned is lost.
 */
export function FieldLoading() {
  const f = getMessages().field;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <>
      <header className="border-b-2 border-current">
        <div className="mx-auto flex w-full max-w-md items-center px-4 py-3">
          <span className="flex-1 text-lg font-bold tracking-wide">{f.appName}</span>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 px-4 py-6" aria-busy="true">
        <Connection />
        <div role="status" className="mb-5">
          <p className="text-lg font-semibold">{f.loading}</p>
          {slow ? <p className="mt-1">{f.loadingSlow}</p> : null}
        </div>
        <div aria-hidden="true" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-md border-2 border-dashed border-current opacity-40 motion-reduce:animate-none" />
          ))}
        </div>
      </main>
    </>
  );
}
