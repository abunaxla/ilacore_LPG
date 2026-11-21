import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { load } from '../../admin/data';
import { showTime } from '../../cylinders/data';
import { showPhone, type StandInMessage } from '../data';

/** The SMS stand-in: messages kept instead of sent until an SMS provider is connected. */
export default function StandInPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StandIn />
    </Suspense>
  );
}

async function StandIn() {
  const me = await requireMe();
  const c = getMessages().customers;
  if (!hasAny(me, ['customer.manage', 'settings.manage'])) {
    return <AppFrame me={me} title={c.standInTitle}><p>{c.noAccess}</p></AppFrame>;
  }
  const messages = await load<StandInMessage[]>('/sms/stand-in', []);
  return (
    <AppFrame me={me} title={c.standInTitle}>
      <p className="mb-6">
        <Link href="/customers" className="underline underline-offset-4">{c.back}</Link>
      </p>
      <p role="note" className="mb-6 max-w-3xl rounded-md border-2 border-dashed border-current p-3">{c.standInIntro}</p>
      {messages.length === 0 ? (
        <p>{c.standInNone}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="rounded-md border-2 border-current p-3">
              <p className="font-semibold">
                {c.purposes[m.purpose] ?? m.purpose} · {c.to} {m.customer} ({showPhone(m.to)}) · {showTime(m.createdAt)}
              </p>
              <p className="font-mono">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </AppFrame>
  );
}
