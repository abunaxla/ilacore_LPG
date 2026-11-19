import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame, NoAccess } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { load } from '../admin/data';
import { showTime } from '../cylinders/data';
import { SCAN_VIEWERS, type ScanSessionSummary } from './data';

export default function ScansPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Scans />
    </Suspense>
  );
}

async function Scans() {
  const me = await requireMe();
  const t = getMessages();
  const s = t.scans;
  if (!hasAny(me, SCAN_VIEWERS)) return <AppFrame me={me} title={s.title}><NoAccess /></AppFrame>;
  const sessions = await load<ScanSessionSummary[]>('/scan-sessions', []);

  return (
    <AppFrame me={me} title={s.title}>
      <p className="mb-6">{s.intro}</p>
      {sessions.length === 0 ? (
        <p>{s.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((x) => (
            <li key={x.id} className="rounded-md border-2 border-current p-4">
              <h2 className="text-xl font-bold">
                <Link href={`/scans/${x.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                  {s.purposes[x.purpose]} · {x.location.name}
                </Link>
              </h2>
              <p>
                {showTime(x.openedAt)} · {s.by} {x.openedBy} · {x.device ? `${s.reader}: ${x.device.name}` : s.web}
              </p>
              <p>
                {x.closedAt ? `${s.closed} ${showTime(x.closedAt)}` : `● ${s.open}`} · {s.tagsSeen(x.tags)} · {s.rawReads(x.rawReads)}
              </p>
              {x.note ? <p className="italic">{x.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </AppFrame>
  );
}
