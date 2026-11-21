import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame } from '@/components/app-frame';
import { buttonClass, Field, secondaryButtonClass, Select } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { load } from '../admin/data';
import { showPhone, type CustomerSummary } from './data';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function CustomersPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<Loading />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({ searchParams }: { searchParams: Search }) {
  const me = await requireMe();
  const t = getMessages();
  const c = t.customers;
  if (!hasAny(me, ['customer.manage'])) {
    return <AppFrame me={me} title={c.title}><p>{c.noAccess}</p></AppFrame>;
  }
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' && sp[k] ? (sp[k] as string) : undefined);
  const query = new URLSearchParams();
  for (const k of ['search', 'kind']) {
    const v = one(k);
    if (v) query.set(k, v);
  }
  const shops = await load<CustomerSummary[] | null>(`/customers?${query}`, null);

  return (
    <AppFrame me={me} title={c.title}>
      <p className="mb-6 max-w-3xl">{c.intro}</p>
      <p className="mb-6 flex flex-wrap gap-3">
        <Link href="/customers/new" className={buttonClass}>{c.add}</Link>
        <Link href="/customers/messages" className={secondaryButtonClass}>{c.messages}</Link>
      </p>

      <form method="get" action="/customers" className="mb-8 grid gap-4 rounded-md border-2 border-current p-4 md:grid-cols-3 md:items-end">
        <Field name="search" label={c.search} defaultValue={one('search') ?? ''} autoComplete="off" />
        <Select name="kind" label={c.kind} defaultValue={one('kind') ?? ''}>
          <option value="">{c.anyKind}</option>
          <option value="retailer">{c.kinds.retailer}</option>
          <option value="wholesaler">{c.kinds.wholesaler}</option>
        </Select>
        <div>
          <button type="submit" className={buttonClass}>{c.show}</button>
        </div>
      </form>

      {!shops ? (
        <p role="alert">{t.errors.unknown}</p>
      ) : shops.length === 0 ? (
        <p>{c.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shops.map((s) => (
            <li key={s.id} className="rounded-md border-2 border-current p-3">
              <p className="flex flex-wrap gap-x-4">
                <Link href={`/customers/${s.id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                  {s.name}
                </Link>
                <span className="inline-flex items-center">{c.kinds[s.kind]}{s.area ? ` · ${s.area}` : ''}</span>
              </p>
              <p>
                {s.phone ? `${showPhone(s.phone)} · ` : ''}
                <span className={s.phoneVerified ? '' : 'font-semibold'}>{s.phoneVerified ? c.verified : c.notVerified}</span>
                {' · '}{c.label} <span className="font-mono">{s.labelCode}</span>
                {s.emptiesOwed > 0 ? ` · ${c.emptiesOwed}: ${s.emptiesOwed}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </AppFrame>
  );
}
