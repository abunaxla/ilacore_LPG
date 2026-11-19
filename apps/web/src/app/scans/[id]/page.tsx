import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { errorText, getMessages } from '@/i18n';
import { requireMe } from '@/lib/auth';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';
import { groupEpc, showTime } from '../../cylinders/data';
import type { ScanSessionDetail } from '../data';

type Params = Promise<{ id: string }>;

export default function ScanSessionPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Loading />}>
      <ScanSession params={params} />
    </Suspense>
  );
}

async function ScanSession({ params }: { params: Params }) {
  const me = await requireMe();
  const t = getMessages();
  const s = t.scans;
  const { id } = await params;
  const reply = await api<ScanSessionDetail>(`/scan-sessions/${encodeURIComponent(id)}`, { token: await getToken() });
  if (!reply.ok) {
    return (
      <AppFrame me={me} title={s.title}>
        <p role="alert" className="mb-6 rounded-md border-2 border-current p-4">{errorText(reply.error)}</p>
        <Link href="/scans" className="underline underline-offset-4">{s.back}</Link>
      </AppFrame>
    );
  }
  const x = reply.data;
  // Problems first: retired tags, then unknown tags, then the registered cylinders.
  const order = { retired: 0, unknown: 1, active: 2 } as const;
  const lines = [...x.seen].sort((a, b) => order[a.tag] - order[b.tag]);

  return (
    <AppFrame me={me} title={`${s.purposes[x.purpose]} · ${x.location.name}`}>
      <p className="mb-6">
        <Link href="/scans" className="underline underline-offset-4">{s.back}</Link>
      </p>
      <p className="mb-2">
        {showTime(x.openedAt)} · {s.by} {x.openedBy} · {x.device ? `${s.reader}: ${x.device.name}` : s.web}
      </p>
      <p className="mb-6">
        {x.closedAt ? `${s.closed} ${showTime(x.closedAt)}` : `● ${s.open}`} · {s.rawReads(x.rawReads)}
      </p>

      <section aria-labelledby="counts" className="mb-8">
        <h2 id="counts" className="mb-3 text-2xl font-bold">{s.counts}</h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {(['active', 'retired', 'unknown'] as const).map((k) => (
            <div key={k} className="rounded-md border-2 border-current p-3">
              <dt>{s[k]}</dt>
              <dd className="text-3xl font-bold">{x.counts[k]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-current">
              <th scope="col" className="p-2">{s.epc}</th>
              <th scope="col" className="p-2">{s.statusHeading}</th>
              <th scope="col" className="p-2">{s.cylinder}</th>
              <th scope="col" className="p-2">{s.reads}</th>
              <th scope="col" className="p-2">{s.signal}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.epc} className="border-b border-current">
                <th scope="row" className="p-2 font-mono text-base font-normal">{groupEpc(l.epc)}</th>
                <td className="p-2 font-semibold">{s.status[l.tag]}</td>
                <td className="p-2">
                  {l.cylinder ? (
                    <Link href={`/cylinders/${l.cylinder.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                      {l.cylinder.serial ?? t.cylinders.noSerial} · {l.cylinder.size}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-2">{l.reads}</td>
                <td className="p-2">{l.strongestRssi !== null ? `${l.strongestRssi} dBm` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppFrame>
  );
}
